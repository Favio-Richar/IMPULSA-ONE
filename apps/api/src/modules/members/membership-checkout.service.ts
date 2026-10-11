import { createHash, randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { EmailAdapter } from "@impulza/auth";
import type { PublicMembershipPlansResponse, PublicMembershipStatusResponse } from "@impulza/contracts";
import { MembershipPlanStatus, MembershipPurchaseStatus, SiteMemberSource, SiteMemberStatus, type MembershipPurchase, type PrismaClient } from "@impulza/database";
import { type CheckoutPayment, checkoutPaymentMismatches, checkoutSupportsCurrency, PaymentGatewayError, verifyMercadoPagoSignature } from "@impulza/payments";
import {
  MEMBERSHIP_PERIOD_DAYS,
  MEMBERS_PER_SITE_MAX,
  nextPeriodStart,
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
import { MERCADO_PAGO_CHECKOUT, type CheckoutConfig } from "../payment-accounts/checkout.tokens.js";
import { PaymentAccountsService } from "../payment-accounts/payment-accounts.service.js";
import { MembersService } from "./members.service.js";

export const MEMBERSHIP_STATUS_NOT_FOUND = "El enlace no es válido o la compra ya no existe.";
const SITE_NOT_FOUND = "Sitio no encontrado.";
const PAYMENT_ID = /^\d{1,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Plazo para pagar en Mercado Pago. */
const CHECKOUT_TTL_MS = 48 * 3_600_000;

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const PERIOD_FOR_ACCESS = { status: true, paymentStatus: true, amount: true, refundedAmount: true, periodEnd: true } as const;

export type MembershipSyncResult = "paid" | "updated" | "dispute" | "unchanged" | "mismatch" | "unavailable";

/**
 * Compra de membresías con Checkout Pro **en la cuenta del propio negocio** (F10.2, ADR-029 / ADR-013). Mismo criterio que los
 * pedidos: el precio sale del plan guardado (nunca del visitante), la confirmación nunca se toma del aviso ni del regreso del
 * comprador — se consulta el pago con el token del negocio y solo se aplica si cuenta, referencia, monto y moneda coinciden — y
 * asignar el pago es condicional, así que repetir un aviso no tiene efecto. Impulza no custodia ni cobra comisión sobre ese dinero.
 */
@Injectable()
export class MembershipCheckoutService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(MERCADO_PAGO_CHECKOUT) private readonly config: CheckoutConfig | null,
    @Inject(PaymentAccountsService) private readonly accounts: PaymentAccountsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    @Inject(BrandProfileService) private readonly brandProfile: BrandProfileService,
    @Inject(MembersService) private readonly members: MembersService,
  ) {}

  private configured(): boolean {
    return Boolean(this.config && env.API_PUBLIC_URL && env.PUBLIC_SITE_BASE_URL);
  }

  /** ¿Puede este negocio cobrar en línea ahora? Cuenta conectada y vigente, plataforma configurada. */
  async checkoutAvailable(organizationId: string): Promise<boolean> {
    if (!this.configured()) return false;
    return (await this.accounts.chargingAccountFor(organizationId)) !== null;
  }

  private async servedSite(siteSlug: string) {
    const site = await this.prisma.site.findFirst({ where: { slug: siteSlug, ...SERVED_SITE }, select: { id: true, name: true, slug: true, organizationId: true } });
    if (!site) throw new NotFoundException(SITE_NOT_FOUND);
    return site;
  }

  /** Planes que el visitante puede comprar. Sin cuenta de cobro conectada se muestran vacíos: no se ofrece lo que no se puede cobrar. */
  async publicPlans(siteSlug: string): Promise<PublicMembershipPlansResponse> {
    const site = await this.servedSite(siteSlug);
    const available = await this.checkoutAvailable(site.organizationId);
    if (!available) return { checkoutAvailable: false, plans: [] };
    const plans = await this.prisma.membershipPlan.findMany({
      where: { siteId: site.id, status: MembershipPlanStatus.ACTIVE },
      orderBy: [{ priceAmount: "asc" }, { createdAt: "asc" }],
    });
    return {
      checkoutAvailable: true,
      plans: plans
        .filter((plan) => checkoutSupportsCurrency(plan.priceCurrency))
        .map((plan) => ({ id: plan.id, name: plan.name, description: plan.description, priceAmount: plan.priceAmount, priceCurrency: plan.priceCurrency, period: plan.period })),
    };
  }

  /**
   * Empieza la compra de un periodo. Crea (o reutiliza) al miembro, registra la compra con copia del plan y crea la preferencia a
   * nombre del negocio. Un miembro revocado no puede comprar. Si Mercado Pago falla, la compra queda vencida: nunca se pierde nada.
   */
  async start(siteSlug: string, planId: string, dto: StartMembershipCheckoutDto): Promise<{ checkoutUrl: string; statusUrl: string }> {
    if (!UUID.test(planId)) throw new NotFoundException("Plan no encontrado.");
    const site = await this.servedSite(siteSlug);
    const plan = await this.prisma.membershipPlan.findFirst({ where: { id: planId, siteId: site.id, status: MembershipPlanStatus.ACTIVE } });
    if (!plan || !checkoutSupportsCurrency(plan.priceCurrency)) throw new NotFoundException("Plan no encontrado.");
    const account = this.configured() ? await this.accounts.chargingAccountFor(site.organizationId) : null;
    if (!account || !this.config) throw new ServiceUnavailableException("El pago en línea no está disponible ahora. Escríbele al negocio.");

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
        checkoutExpiresAt: expiresAt,
        statusTokenHash: hashToken(statusToken),
      },
    });

    let preference;
    try {
      preference = await this.config.checkout.createPreference(
        account.accessToken,
        {
          externalReference: purchase.id,
          title: `${plan.name} — ${site.name}`,
          quantity: 1,
          unitPrice: plan.priceAmount,
          currency: plan.priceCurrency,
          payerEmail: dto.email,
          payerName: dto.name ?? "Miembro",
          notificationUrl: `${env.API_PUBLIC_URL!.replace(/\/+$/, "")}/api/v1/payments/mercadopago/memberships/${purchase.id}/webhook`,
          backUrl: statusUrl,
          expiresAt,
        },
        account.liveMode,
      );
    } catch (error) {
      await this.prisma.membershipPurchase.update({ where: { id: purchase.id }, data: { status: MembershipPurchaseStatus.EXPIRED } });
      logger.warn("membresías: no se pudo crear el cobro en Mercado Pago", {
        organizationId: site.organizationId,
        purchaseId: purchase.id,
        code: error instanceof PaymentGatewayError ? error.code : "unknown",
      });
      throw new ServiceUnavailableException("No pudimos iniciar el pago ahora. Intenta de nuevo en un momento.");
    }

    await this.prisma.membershipPurchase.update({
      where: { id: purchase.id },
      data: { checkoutPreferenceId: preference.id, checkoutUrl: preference.checkoutUrl },
    });
    logger.info("membresías: cobro creado en Mercado Pago", { organizationId: site.organizationId, purchaseId: purchase.id, liveMode: account.liveMode });
    return { checkoutUrl: preference.checkoutUrl, statusUrl };
  }

  /** Aviso firmado de Mercado Pago. Siempre 200 a un aviso válido (aunque no aplique) para que no reintente sin fin. */
  async handleWebhook(input: { purchaseId: string; signature: string | undefined; requestId: string | undefined; dataId: string | undefined; type: string | undefined }): Promise<{ result: MembershipSyncResult | "ignored" }> {
    if (!this.config) throw new NotFoundException();
    if (!verifyMercadoPagoSignature({ signature: input.signature, requestId: input.requestId, dataId: input.dataId, secret: this.config.webhookSecret })) {
      logger.warn("membresías: aviso de Mercado Pago con firma inválida", { type: input.type });
      throw new UnauthorizedException("Firma inválida.");
    }
    if (input.type !== "payment" || !input.dataId || !PAYMENT_ID.test(input.dataId) || !UUID.test(input.purchaseId)) return { result: "ignored" };
    const purchase = await this.prisma.membershipPurchase.findUnique({ where: { id: input.purchaseId } });
    if (!purchase || !purchase.checkoutPreferenceId) return { result: "ignored" };
    return { result: await this.syncPayment(purchase, input.dataId) };
  }

  /** Consulta el pago con el token del negocio y lo aplica solo si corresponde a esta compra. Idempotente. */
  async syncPayment(purchase: MembershipPurchase, paymentId: string): Promise<MembershipSyncResult> {
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

    // Aprobado. Un pago que llega con el cobro ya vencido igual se aplica: el dinero entró a la cuenta del negocio.
    const paidBefore = await this.prisma.membershipPurchase.findMany({
      where: { memberId: purchase.memberId, status: MembershipPurchaseStatus.PAID },
      select: PERIOD_FOR_ACCESS,
    });
    const now = new Date();
    const periodStart = nextPeriodStart(paidBefore, now);
    const periodEnd = new Date(periodStart.getTime() + purchase.periodDays * 86_400_000);
    const paidAt = payment.approvedAt ?? now;

    let claimed;
    try {
      claimed = await this.prisma.membershipPurchase.updateMany({
        where: { id: purchase.id, providerPaymentId: null, status: { in: [MembershipPurchaseStatus.PENDING, MembershipPurchaseStatus.EXPIRED] } },
        data: { status: MembershipPurchaseStatus.PAID, providerPaymentId: payment.id, paymentStatus: "approved", paidAt, periodStart, periodEnd },
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
      metadata: { provider: "MERCADO_PAGO", paymentId: payment.id, planId: purchase.planId, siteId: purchase.siteId },
    });
    await this.notifyPaid(purchase, periodEnd);
    logger.info("membresías: pago confirmado por Mercado Pago", { organizationId: purchase.organizationId, purchaseId: purchase.id });
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

  /** «Tu membresía»: con el enlace del correo o al volver de Mercado Pago. El `payment_id` de la URL nunca es verdad: se consulta. */
  async publicStatus(token: string, returnedPaymentId?: string): Promise<PublicMembershipStatusResponse> {
    if (!token || token.length > 100) throw new NotFoundException(MEMBERSHIP_STATUS_NOT_FOUND);
    let purchase = await this.prisma.membershipPurchase.findFirst({ where: { statusTokenHash: hashToken(token), member: { site: SERVED_SITE } } });
    if (!purchase) throw new NotFoundException(MEMBERSHIP_STATUS_NOT_FOUND);

    if (returnedPaymentId && PAYMENT_ID.test(returnedPaymentId) && purchase.providerPaymentId === null) {
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
    const canPay = purchase.status === MembershipPurchaseStatus.PENDING && !expired && purchase.checkoutUrl !== null;
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
