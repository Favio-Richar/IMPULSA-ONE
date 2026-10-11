import { createHash, randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { EmailAdapter } from "@impulza/auth";
import type { MembershipCheckoutResponse, PublicMembershipPlansResponse, PublicMembershipStatusResponse } from "@impulza/contracts";
import {
  MembershipPlanStatus,
  MembershipPurchaseStatus,
  PaymentGateway,
  SiteMemberSource,
  SiteMemberStatus,
  type MembershipPurchase,
  type PrismaClient,
} from "@impulza/database";
import {
  type CheckoutPayment,
  checkoutPaymentMismatches,
  checkoutSupportsCurrency,
  newWebpayPlusBuyOrder,
  PaymentGatewayError,
  verifyMercadoPagoSignature,
  type WebpayPlusLike,
  webpayPlusMismatches,
} from "@impulza/payments";
import {
  MEMBERSHIP_PERIOD_DAYS,
  MEMBERS_PER_SITE_MAX,
  nextPeriodStart,
  type MembershipCheckoutProvider,
  type StartMembershipCheckoutDto,
} from "@impulza/validation";
import { SERVED_SITE } from "../../common/active-organization.js";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { BrandProfileService } from "../brand-profile/brand-profile.service.js";
import { DISPUTE_STATUSES } from "../payment-accounts/checkout-refunds.service.js";
import { MERCADO_PAGO_CHECKOUT, WEBPAY_PLUS_GATEWAY, type CheckoutConfig } from "../payment-accounts/checkout.tokens.js";
import { PaymentAccountsService } from "../payment-accounts/payment-accounts.service.js";
import { MembersService } from "./members.service.js";

export const MEMBERSHIP_STATUS_NOT_FOUND = "El enlace no es válido o la compra ya no existe.";
const SITE_NOT_FOUND = "Sitio no encontrado.";
const PAYMENT_ID = /^\d{1,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Plazo para pagar. */
const CHECKOUT_TTL_MS = 48 * 3_600_000;
/** Los tokens de Webpay Plus son hexadecimales largos; cualquier otra forma ni se consulta. */
const WEBPAY_TOKEN = /^[A-Za-z0-9]{20,100}$/;

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const PERIOD_FOR_ACCESS = { status: true, paymentStatus: true, amount: true, refundedAmount: true, periodEnd: true } as const;

export type MembershipSyncResult = "paid" | "updated" | "dispute" | "unchanged" | "mismatch" | "unavailable" | "rejected";

/**
 * Compra de membresías **con la cuenta del propio negocio** (F10.2, ADR-029 / ADR-013 / ADR-030): Mercado Pago (Checkout Pro) y/o
 * Webpay Plus. Mismo criterio para ambos: el precio sale del plan guardado (nunca del visitante); la confirmación nunca se toma del aviso
 * ni del regreso del comprador — se consulta el pago con las credenciales del negocio y solo se aplica si cuenta, referencia, monto y
 * moneda coinciden; asignar el pago es condicional, así que repetir un aviso o recargar la URL de regreso no tiene efecto. Impulza no
 * custodia ni cobra comisión sobre ese dinero.
 */
@Injectable()
export class MembershipCheckoutService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(MERCADO_PAGO_CHECKOUT) private readonly config: CheckoutConfig | null,
    @Inject(WEBPAY_PLUS_GATEWAY) private readonly webpay: WebpayPlusLike,
    @Inject(PaymentAccountsService) private readonly accounts: PaymentAccountsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    @Inject(BrandProfileService) private readonly brandProfile: BrandProfileService,
    @Inject(MembersService) private readonly members: MembersService,
  ) {}

  private urlsConfigured(): boolean {
    return Boolean(env.API_PUBLIC_URL && env.PUBLIC_SITE_BASE_URL);
  }

  /** Medios con los que este negocio puede cobrar ahora: cuenta conectada y vigente, y la plataforma con sus URL públicas. */
  async availableProviders(organizationId: string): Promise<MembershipCheckoutProvider[]> {
    if (!this.urlsConfigured()) return [];
    const providers: MembershipCheckoutProvider[] = [];
    if (this.config && (await this.accounts.chargingAccountFor(organizationId))) providers.push("MERCADO_PAGO");
    if (await this.accounts.webpayPlusFor(organizationId)) providers.push("WEBPAY_PLUS");
    return providers;
  }

  async checkoutAvailable(organizationId: string): Promise<boolean> {
    return (await this.availableProviders(organizationId)).length > 0;
  }

  private async servedSite(siteSlug: string) {
    const site = await this.prisma.site.findFirst({ where: { slug: siteSlug, ...SERVED_SITE }, select: { id: true, name: true, slug: true, organizationId: true } });
    if (!site) throw new NotFoundException(SITE_NOT_FOUND);
    return site;
  }

  /** Planes que el visitante puede comprar. Sin cuenta de cobro conectada se muestran vacíos: no se ofrece lo que no se puede cobrar. */
  async publicPlans(siteSlug: string): Promise<PublicMembershipPlansResponse> {
    const site = await this.servedSite(siteSlug);
    const providers = await this.availableProviders(site.organizationId);
    if (providers.length === 0) return { checkoutAvailable: false, providers: [], plans: [] };
    const plans = await this.prisma.membershipPlan.findMany({
      where: { siteId: site.id, status: MembershipPlanStatus.ACTIVE },
      orderBy: [{ priceAmount: "asc" }, { createdAt: "asc" }],
    });
    return {
      checkoutAvailable: true,
      providers,
      plans: plans
        .filter((plan) => checkoutSupportsCurrency(plan.priceCurrency))
        .map((plan) => ({ id: plan.id, name: plan.name, description: plan.description, priceAmount: plan.priceAmount, priceCurrency: plan.priceCurrency, period: plan.period })),
    };
  }

  /**
   * Empieza la compra de un periodo. Crea (o reutiliza) al miembro, registra la compra con copia del plan y crea el cobro a nombre del
   * negocio en el medio elegido. Un miembro revocado no puede comprar. Si la pasarela falla, la compra queda vencida: nunca se pierde nada.
   */
  async start(siteSlug: string, planId: string, dto: StartMembershipCheckoutDto): Promise<MembershipCheckoutResponse> {
    if (!UUID.test(planId)) throw new NotFoundException("Plan no encontrado.");
    const site = await this.servedSite(siteSlug);
    const plan = await this.prisma.membershipPlan.findFirst({ where: { id: planId, siteId: site.id, status: MembershipPlanStatus.ACTIVE } });
    if (!plan || !checkoutSupportsCurrency(plan.priceCurrency)) throw new NotFoundException("Plan no encontrado.");

    const providers = await this.availableProviders(site.organizationId);
    const provider = dto.provider ?? providers[0];
    if (!provider || !providers.includes(provider)) {
      throw new ServiceUnavailableException("El pago en línea no está disponible ahora. Escríbele al negocio.");
    }

    let member = await this.prisma.siteMember.findUnique({ where: { siteId_email: { siteId: site.id, email: dto.email } } });
    if (member?.status === SiteMemberStatus.REVOKED) {
      throw new ConflictException("No pudimos iniciar la compra con este correo. Escríbele al negocio.");
    }
    if (!member) {
      if ((await this.prisma.siteMember.count({ where: { siteId: site.id } })) >= MEMBERS_PER_SITE_MAX) {
        throw new ConflictException("Este sitio no admite más miembros por ahora.");
      }
      try {
        member = await this.prisma.siteMember.create({
          data: { organizationId: site.organizationId, siteId: site.id, email: dto.email, name: dto.name ?? null, source: SiteMemberSource.PURCHASED },
        });
      } catch (error) {
        // Dos compras simultáneas con el mismo correo: gana la primera fila.
        if (!isUniqueViolation(error)) throw error;
        member = await this.prisma.siteMember.findUniqueOrThrow({ where: { siteId_email: { siteId: site.id, email: dto.email } } });
        if (member.status === SiteMemberStatus.REVOKED) throw new ConflictException("No pudimos iniciar la compra con este correo. Escríbele al negocio.");
      }
    }

    const statusToken = randomBytes(32).toString("base64url");
    const statusUrl = `${env.PUBLIC_SITE_BASE_URL!.replace(/\/+$/, "")}/membresia/${statusToken}`;
    const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MS);
    const purchase = await this.prisma.membershipPurchase.create({
      data: {
        organizationId: site.organizationId,
        siteId: site.id,
        planId: plan.id,
        memberId: member.id,
        planName: plan.name,
        amount: plan.priceAmount,
        currency: plan.priceCurrency,
        periodDays: MEMBERSHIP_PERIOD_DAYS[plan.period],
        paymentProvider: provider === "WEBPAY_PLUS" ? PaymentGateway.WEBPAY_PLUS : PaymentGateway.MERCADO_PAGO,
        checkoutExpiresAt: expiresAt,
        statusTokenHash: hashToken(statusToken),
      },
    });

    try {
      if (provider === "WEBPAY_PLUS") {
        return await this.startWebpay(purchase, plan.priceAmount, statusToken, statusUrl);
      }
      return await this.startMercadoPago(purchase, { siteName: site.name, planName: plan.name, amount: plan.priceAmount, currency: plan.priceCurrency, email: dto.email, name: dto.name, expiresAt, statusUrl });
    } catch (error) {
      await this.prisma.membershipPurchase.update({ where: { id: purchase.id }, data: { status: MembershipPurchaseStatus.EXPIRED } });
      logger.warn("membresías: no se pudo crear el cobro", {
        organizationId: site.organizationId,
        purchaseId: purchase.id,
        provider,
        code: error instanceof PaymentGatewayError ? error.code : "unknown",
      });
      throw new ServiceUnavailableException("No pudimos iniciar el pago ahora. Intenta de nuevo en un momento.");
    }
  }

  private async startMercadoPago(
    purchase: MembershipPurchase,
    input: { siteName: string; planName: string; amount: number; currency: string; email: string; name: string | undefined; expiresAt: Date; statusUrl: string },
  ): Promise<MembershipCheckoutResponse> {
    const account = await this.accounts.chargingAccountFor(purchase.organizationId);
    if (!account || !this.config) throw new PaymentGatewayError("unavailable", true, "Sin cuenta de Mercado Pago.");
    const preference = await this.config.checkout.createPreference(
      account.accessToken,
      {
        externalReference: purchase.id,
        title: `${input.planName} — ${input.siteName}`,
        quantity: 1,
        unitPrice: input.amount,
        currency: input.currency,
        payerEmail: input.email,
        payerName: input.name ?? "Miembro",
        notificationUrl: `${env.API_PUBLIC_URL!.replace(/\/+$/, "")}/api/v1/payments/mercadopago/memberships/${purchase.id}/webhook`,
        backUrl: input.statusUrl,
        expiresAt: input.expiresAt,
      },
      account.liveMode,
    );
    await this.prisma.membershipPurchase.update({ where: { id: purchase.id }, data: { checkoutPreferenceId: preference.id, checkoutUrl: preference.checkoutUrl } });
    logger.info("membresías: cobro creado en Mercado Pago", { organizationId: purchase.organizationId, purchaseId: purchase.id, liveMode: account.liveMode });
    return { checkoutUrl: preference.checkoutUrl, statusUrl: input.statusUrl, provider: "MERCADO_PAGO", method: "GET", fields: {} };
  }

  private async startWebpay(purchase: MembershipPurchase, amount: number, statusToken: string, statusUrl: string): Promise<MembershipCheckoutResponse> {
    const credentials = await this.accounts.webpayPlusFor(purchase.organizationId);
    if (!credentials) throw new PaymentGatewayError("unavailable", true, "Sin cuenta de Webpay Plus.");
    const buyOrder = newWebpayPlusBuyOrder();
    // El comprador vuelve a esta URL (con el token de Transbank). El enlace «Tu membresía» viaja en `t`: es del propio comprador.
    const returnUrl = `${env.API_PUBLIC_URL!.replace(/\/+$/, "")}/api/v1/payments/webpay/memberships/${purchase.id}/return?t=${encodeURIComponent(statusToken)}`;
    const transaction = await this.webpay.create(credentials, { buyOrder, sessionId: purchase.id, amount, returnUrl });
    await this.prisma.membershipPurchase.update({
      where: { id: purchase.id },
      data: { checkoutPreferenceId: transaction.token, providerOrderRef: buyOrder, checkoutUrl: transaction.url },
    });
    logger.info("membresías: cobro creado en Webpay Plus", { organizationId: purchase.organizationId, purchaseId: purchase.id, liveMode: credentials.environment === "production" });
    return { checkoutUrl: transaction.url, statusUrl, provider: "WEBPAY_PLUS", method: "POST", fields: { token_ws: transaction.token } };
  }

  // ───────────────────────────── Mercado Pago: aviso firmado ─────────────────────────────

  /** Aviso firmado de Mercado Pago. Siempre 200 a un aviso válido (aunque no aplique) para que no reintente sin fin. */
  async handleWebhook(input: { purchaseId: string; signature: string | undefined; requestId: string | undefined; dataId: string | undefined; type: string | undefined }): Promise<{ result: MembershipSyncResult | "ignored" }> {
    if (!this.config) throw new NotFoundException();
    if (!verifyMercadoPagoSignature({ signature: input.signature, requestId: input.requestId, dataId: input.dataId, secret: this.config.webhookSecret })) {
      logger.warn("membresías: aviso de Mercado Pago con firma inválida", { type: input.type });
      throw new UnauthorizedException("Firma inválida.");
    }
    if (input.type !== "payment" || !input.dataId || !PAYMENT_ID.test(input.dataId) || !UUID.test(input.purchaseId)) return { result: "ignored" };
    const purchase = await this.prisma.membershipPurchase.findUnique({ where: { id: input.purchaseId } });
    if (!purchase || !purchase.checkoutPreferenceId || purchase.paymentProvider !== PaymentGateway.MERCADO_PAGO) return { result: "ignored" };
    return { result: await this.syncPayment(purchase, input.dataId) };
  }

  /** Consulta el pago con el token del negocio y lo aplica solo si corresponde a esta compra. Idempotente. */
  async syncPayment(purchase: MembershipPurchase, paymentId: string): Promise<MembershipSyncResult> {
    if (purchase.paymentProvider !== PaymentGateway.MERCADO_PAGO) return "mismatch";
    const account = await this.accounts.chargingAccountFor(purchase.organizationId);
    if (!account || !this.config) return "unavailable";
    let payment;
    try {
      payment = await this.config.checkout.getPayment(account.accessToken, paymentId);
    } catch (error) {
      const code = error instanceof PaymentGatewayError ? error.code : "unknown";
      logger.warn("membresías: no se pudo consultar el pago en Mercado Pago", { organizationId: purchase.organizationId, purchaseId: purchase.id, code });
      // Un pago que el token del negocio no ve es de otra cuenta: no aplica a esta compra.
      if (code === "not_found") return "mismatch";
      throw error;
    }

    const mismatches = checkoutPaymentMismatches(payment, {
      externalReference: purchase.id,
      collectorId: account.providerUserId,
      amount: purchase.amount,
      currency: purchase.currency,
    });
    if (mismatches.length > 0) {
      logger.warn("membresías: el pago de Mercado Pago no corresponde a la compra; no se aplica", { organizationId: purchase.organizationId, purchaseId: purchase.id, mismatches });
      return "mismatch";
    }

    if (purchase.providerPaymentId !== null && purchase.providerPaymentId !== payment.id) return "unchanged";
    if (purchase.providerPaymentId === payment.id) return this.applyPaymentChange(purchase, payment);

    if (payment.status !== "approved") {
      if (purchase.paymentStatus === payment.status) return "unchanged";
      await this.prisma.membershipPurchase.updateMany({ where: { id: purchase.id, providerPaymentId: null }, data: { paymentStatus: payment.status } });
      return "updated";
    }
    return this.activate(purchase, payment.id, payment.approvedAt ?? new Date(), "MERCADO_PAGO");
  }

  // ───────────────────────────── Webpay Plus: regreso del comprador ─────────────────────────────

  /**
   * El comprador vuelve de Webpay a nuestra URL con `token_ws` (pagó o intentó) o `TBK_TOKEN` (abandonó). Webpay no avisa por webhook:
   * acá el SERVIDOR confirma la transacción. Nada de lo que traiga la URL se toma como verdad: el token tiene que ser el que se creó
   * para ESTA compra, y la transacción confirmada debe estar autorizada y coincidir en orden de compra y monto. Devuelve a dónde
   * mandar al comprador (siempre «Tu membresía»), o `null` si el enlace no corresponde a ninguna compra.
   */
  async handleWebpayReturn(input: { purchaseId: string; statusToken: string | undefined; tokenWs: string | undefined; tbkToken: string | undefined }): Promise<string | null> {
    if (!UUID.test(input.purchaseId) || !input.statusToken || input.statusToken.length > 100) return null;
    const purchase = await this.prisma.membershipPurchase.findFirst({
      where: { id: input.purchaseId, statusTokenHash: hashToken(input.statusToken), paymentProvider: PaymentGateway.WEBPAY_PLUS },
    });
    if (!purchase) return null;
    const statusUrl = `${env.PUBLIC_SITE_BASE_URL!.replace(/\/+$/, "")}/membresia/${encodeURIComponent(input.statusToken)}`;

    // Abandonó o la sesión venció en Webpay: no hay nada que confirmar, la compra sigue pendiente (y Transbank la anula sola).
    if (!input.tokenWs) return statusUrl;
    // Nota de diseño: abajo se confirma el token que GUARDAMOS (`purchase.checkoutPreferenceId`), nunca el de la URL; esta comprobación
    // solo descarta temprano un regreso que no es de esta compra. Aunque alguien mande el token de otra transacción, esta no se toca.
    if (!WEBPAY_TOKEN.test(input.tokenWs) || input.tokenWs !== purchase.checkoutPreferenceId) {
      logger.warn("membresías: el token de Webpay no corresponde a la compra", { organizationId: purchase.organizationId, purchaseId: purchase.id });
      return statusUrl;
    }
    // Ya confirmada (recargaron la URL de regreso): sin efecto.
    if (purchase.providerPaymentId !== null) return statusUrl;

    try {
      await this.settleWebpay(purchase);
    } catch (error) {
      logger.error("membresías: no se pudo confirmar la transacción de Webpay", { purchaseId: purchase.id, code: error instanceof PaymentGatewayError ? error.code : "unknown" });
    }
    return statusUrl;
  }

  private async settleWebpay(purchase: MembershipPurchase): Promise<MembershipSyncResult> {
    const credentials = await this.accounts.webpayPlusFor(purchase.organizationId);
    if (!credentials || !purchase.checkoutPreferenceId || !purchase.providerOrderRef) return "unavailable";

    let result;
    try {
      result = await this.webpay.commit(credentials, purchase.checkoutPreferenceId);
    } catch (error) {
      // Transbank solo admite confirmar una vez: si otra pasada ya la confirmó, se lee su estado en vez de fallar.
      if (error instanceof PaymentGatewayError && error.code === "rejected") {
        result = await this.webpay.status(credentials, purchase.checkoutPreferenceId);
      } else {
        throw error;
      }
    }

    const mismatches = webpayPlusMismatches(result, { buyOrder: purchase.providerOrderRef, amount: purchase.amount });
    if (mismatches.length > 0) {
      // Tarjeta rechazada: se deja constancia y el comprador puede reintentar desde el sitio. Cualquier otra diferencia no se aplica.
      if (result.status !== "AUTHORIZED" && mismatches.every((reason) => reason === "status" || reason === "response_code")) {
        await this.prisma.membershipPurchase.updateMany({ where: { id: purchase.id, providerPaymentId: null }, data: { paymentStatus: "rejected" } });
        return "rejected";
      }
      logger.warn("membresías: la transacción de Webpay no corresponde a la compra; no se aplica", { organizationId: purchase.organizationId, purchaseId: purchase.id, mismatches });
      return "mismatch";
    }
    // El identificador del pago es único por transacción confirmada: la orden de compra ya es única y aleatoria.
    return this.activate(purchase, `webpay:${result.buyOrder}`, result.transactionDate ?? new Date(), "WEBPAY_PLUS");
  }

  // ───────────────────────────── Común ─────────────────────────────

  /** Asigna el pago aprobado a la compra y activa el periodo, una sola vez. Aplica igual a Mercado Pago y a Webpay Plus. */
  private async activate(purchase: MembershipPurchase, providerPaymentId: string, paidAt: Date, provider: "MERCADO_PAGO" | "WEBPAY_PLUS"): Promise<MembershipSyncResult> {
    // Un pago aprobado que llega con el cobro ya vencido igual se aplica: el dinero entró a la cuenta del negocio.
    const paidBefore = await this.prisma.membershipPurchase.findMany({
      where: { memberId: purchase.memberId, status: MembershipPurchaseStatus.PAID },
      select: PERIOD_FOR_ACCESS,
    });
    const now = new Date();
    const periodStart = nextPeriodStart(paidBefore, now);
    const periodEnd = new Date(periodStart.getTime() + purchase.periodDays * 86_400_000);

    let claimed;
    try {
      claimed = await this.prisma.membershipPurchase.updateMany({
        where: { id: purchase.id, providerPaymentId: null, status: { in: [MembershipPurchaseStatus.PENDING, MembershipPurchaseStatus.EXPIRED] } },
        data: { status: MembershipPurchaseStatus.PAID, providerPaymentId, paymentStatus: "approved", paidAt, periodStart, periodEnd },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return "unchanged";
      throw error;
    }
    if (claimed.count === 0) return "unchanged";

    await this.audit.record({
      organizationId: purchase.organizationId,
      actorId: null,
      action: "membership.purchase_paid",
      targetType: "MembershipPurchase",
      targetId: purchase.id,
      metadata: { provider, paymentId: providerPaymentId, planId: purchase.planId, siteId: purchase.siteId },
    });
    await this.notifyPaid(purchase, periodEnd);
    logger.info("membresías: pago confirmado", { organizationId: purchase.organizationId, purchaseId: purchase.id, provider });
    return "paid";
  }

  /** Cambios posteriores de un pago ya asignado (devolución, contracargo, reclamo): se registra lo que dice Mercado Pago. */
  private async applyPaymentChange(purchase: MembershipPurchase, payment: CheckoutPayment): Promise<MembershipSyncResult> {
    if (purchase.paymentStatus === payment.status && purchase.refundedAmount === payment.refundedAmount) return "unchanged";
    const changed = await this.prisma.membershipPurchase.updateMany({
      where: { id: purchase.id, providerPaymentId: payment.id, paymentStatus: purchase.paymentStatus, refundedAmount: purchase.refundedAmount },
      data: { paymentStatus: payment.status, refundedAmount: Math.min(payment.refundedAmount, purchase.amount) },
    });
    if (changed.count === 0) return "unchanged";
    if (DISPUTE_STATUSES.has(payment.status) && purchase.paymentStatus !== payment.status) {
      await this.audit.record({
        organizationId: purchase.organizationId,
        actorId: null,
        action: "membership.payment_disputed",
        targetType: "MembershipPurchase",
        targetId: purchase.id,
        metadata: { paymentId: payment.id, status: payment.status },
      });
      logger.warn("membresías: contracargo o reclamo en Mercado Pago", { organizationId: purchase.organizationId, purchaseId: purchase.id, status: payment.status });
      return "dispute";
    }
    return "updated";
  }

  /** Correo de confirmación: recibo, vigencia y el enlace de acceso. Un fallo no deshace el pago (ya está guardado y auditado). */
  private async notifyPaid(purchase: MembershipPurchase, periodEnd: Date): Promise<void> {
    try {
      const [member, site] = await Promise.all([
        this.prisma.siteMember.findUniqueOrThrow({ where: { id: purchase.memberId }, select: { id: true, email: true } }),
        this.prisma.site.findUniqueOrThrow({ where: { id: purchase.siteId }, select: { id: true, name: true } }),
      ]);
      const link = await this.members.createLoginLink(site.id, member.id);
      const until = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(periodEnd);
      const lines = [
        "Hola:",
        "",
        `Recibimos el pago de tu membresía «${purchase.planName}» en ${site.name}. Tu acceso está vigente hasta el ${until}.`,
        "",
        link ? `Entra al contenido para miembros con este enlace (sirve una sola vez y vence en 15 minutos):\n${link}` : "Pídele al negocio tu enlace de acceso.",
        "",
        "Cuando quieras seguir, puedes renovar antes de que venza: los periodos se suman y no pierdes ningún día.",
      ];
      await this.email.send(await this.brandProfile.brandEmail(purchase.organizationId, { to: member.email, subject: `Tu membresía en ${site.name}`, text: lines.join("\n") }));
    } catch (error) {
      logger.error("membresías: no se pudo enviar la confirmación de la compra", { purchaseId: purchase.id, error });
    }
  }

  /** «Tu membresía»: con el enlace del correo o al volver de la pasarela. El `payment_id` de la URL nunca es verdad: se consulta. */
  async publicStatus(token: string, returnedPaymentId?: string): Promise<PublicMembershipStatusResponse> {
    if (!token || token.length > 100) throw new NotFoundException(MEMBERSHIP_STATUS_NOT_FOUND);
    let purchase = await this.prisma.membershipPurchase.findFirst({ where: { statusTokenHash: hashToken(token), member: { site: SERVED_SITE } } });
    if (!purchase) throw new NotFoundException(MEMBERSHIP_STATUS_NOT_FOUND);

    if (returnedPaymentId && PAYMENT_ID.test(returnedPaymentId) && purchase.providerPaymentId === null && purchase.paymentProvider === PaymentGateway.MERCADO_PAGO) {
      try {
        const result = await this.syncPayment(purchase, returnedPaymentId);
        if (result !== "unchanged" && result !== "mismatch" && result !== "unavailable") {
          purchase = await this.prisma.membershipPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
        }
      } catch {
        // Mercado Pago no respondió: se muestra el último estado conocido; el aviso llegará igual.
      }
    }
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: purchase.siteId }, select: { slug: true, name: true } });
    const expired = purchase.status === MembershipPurchaseStatus.PENDING && (purchase.checkoutExpiresAt?.getTime() ?? 0) <= Date.now();
    // Solo Mercado Pago se retoma con un enlace (GET). Webpay exige un POST con el token: el comprador vuelve al sitio y elige de nuevo.
    const canPay =
      purchase.status === MembershipPurchaseStatus.PENDING && !expired && purchase.checkoutUrl !== null && purchase.paymentProvider === PaymentGateway.MERCADO_PAGO;
    return {
      siteSlug: site.slug,
      siteName: site.name,
      planName: purchase.planName,
      amount: purchase.amount,
      currency: purchase.currency,
      status: expired ? "EXPIRED" : purchase.status,
      paymentStatus: purchase.paymentStatus,
      checkoutUrl: canPay ? purchase.checkoutUrl : null,
      periodEnd: purchase.status === MembershipPurchaseStatus.PAID ? (purchase.periodEnd?.toISOString() ?? null) : null,
    };
  }
}
