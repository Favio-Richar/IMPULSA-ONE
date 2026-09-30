import { randomUUID } from "node:crypto";
import { BadGatewayException, ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { decryptSecret, encryptSecret, type EmailAdapter } from "@impulza/auth";
import type { BillingOverviewResponse, BillingSubscriptionResponse, CheckoutRedirectResponse } from "@impulza/contracts";
import {
  BillingCheckoutStatus,
  PaymentStatus,
  PERMISSIONS,
  type Payment,
  type Plan,
  type PrismaClient,
  type Subscription,
  SubscriptionStatus,
} from "@impulza/database";
import {
  buyOrderFor,
  customerRefFor,
  type MercadoPagoLike,
  type MerchantRecurringGateway,
  PaymentGatewayError,
  periodEnd,
  priceFor,
  splitVat,
  subscriptionCanceledEmail,
  subscriptionStartedEmail,
  syncAuthorizedPayment,
  syncPreapproval,
  withdrawalRefundedEmail,
  WITHDRAWAL_DAYS,
  withinWithdrawalWindow,
} from "@impulza/payments";
import { LEGAL_DOCUMENT_VERSIONS, type StartCheckoutInput } from "@impulza/validation";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { MERCADO_PAGO_GATEWAY, MERCHANT_GATEWAY } from "./merchant-gateway.token.js";

/** Estados con derecho al plan (los mismos que `PlansService`). */
const LIVE_STATUSES = [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE];
/** Tiempo para completar la inscripción en Transbank antes de que el retorno se rechace. */
const CHECKOUT_TTL_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Resultado del retorno de la pasarela, que el panel muestra en "Plan y pagos". */
export type CheckoutOutcome = "exito" | "rechazado" | "pendiente" | "vencido" | "error";

type SubscriptionWithPlan = Subscription & { plan: Plan };

/**
 * Contratación de planes de pago (F4.6a, ADR-012). El plan efectivo lo sigue decidiendo solo
 * `PlansService.resolveEffectivePlan`: este servicio crea y activa la `Subscription` que aquel lee.
 * Las renovaciones y la conciliación de cobros sin respuesta son del worker.
 */
@Injectable()
export class BillingService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(MERCHANT_GATEWAY) private readonly webpay: MerchantRecurringGateway | null,
    @Inject(MERCADO_PAGO_GATEWAY) private readonly mercadoPago: MercadoPagoLike | null,
    @Inject(EMAIL_ADAPTER) private readonly emailAdapter: EmailAdapter,
    private readonly audit: AuditService,
  ) {}

  /** Pasarelas que este ambiente puede ofrecer. Webpay necesita además la URL pública de la API. */
  availableGateways(): Array<"WEBPAY_ONECLICK" | "MERCADO_PAGO"> {
    // Las dos necesitan la URL pública de la API: Webpay vuelve a ella y Mercado Pago avisa a ella.
    if (!env.API_PUBLIC_URL) return [];
    return [...(this.webpay ? (["WEBPAY_ONECLICK"] as const) : []), ...(this.mercadoPago ? (["MERCADO_PAGO"] as const) : [])];
  }

  async overview(organizationId: string, roleId: string): Promise<BillingOverviewResponse> {
    const [live, payments, grant] = await Promise.all([
      this.currentSubscription(organizationId),
      this.prisma.payment.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 24 }),
      this.prisma.rolePermission.findFirst({ where: { roleId, permission: { key: PERMISSIONS.BILLING_MANAGE } } }),
    ]);
    return {
      subscription: live ? this.toSubscriptionResponse(live) : null,
      gateways: this.availableGateways(),
      payments: payments.map((payment) => this.toPaymentResponse(payment)),
      canManage: grant !== null,
      legal: {
        termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
        withdrawalNoticeVersion: LEGAL_DOCUMENT_VERSIONS.withdrawal_notice,
        withdrawalDays: WITHDRAWAL_DAYS,
      },
    };
  }

  /** La suscripción con derecho; si no hay, la última que terminó (para mostrar "terminó el…"). */
  private async currentSubscription(organizationId: string): Promise<SubscriptionWithPlan | null> {
    const live = await this.prisma.subscription.findFirst({
      where: { organizationId, status: { in: LIVE_STATUSES } },
      include: { plan: true },
    });
    if (live) return live;
    return this.prisma.subscription.findFirst({
      where: { organizationId, status: SubscriptionStatus.CANCELED, firstPaidAt: { not: null } },
      orderBy: { updatedAt: "desc" },
      include: { plan: true },
    });
  }

  async startCheckout(organizationId: string, user: { id: string; email: string }, input: StartCheckoutInput): Promise<CheckoutRedirectResponse> {
    if (!this.availableGateways().includes(input.gateway)) {
      throw new UnprocessableEntityException({ code: "GATEWAY_UNAVAILABLE", message: "Ese medio de pago no está disponible por ahora." });
    }
    const plan = await this.prisma.plan.findUnique({ where: { code: input.planCode } });
    if (!plan) throw new NotFoundException("Plan no encontrado.");
    const amount = priceFor(plan, input.cycle);
    if (amount <= 0) {
      throw new UnprocessableEntityException({ code: "PLAN_NOT_PURCHASABLE", message: "Ese plan no se contrata con pago." });
    }

    const live = await this.prisma.subscription.findFirst({ where: { organizationId, status: { in: LIVE_STATUSES } } });
    if (live) {
      throw new ConflictException({ code: "SUBSCRIPTION_ACTIVE", message: "Ya tienes un plan de pago activo." });
    }

    // Prueba de la aceptación (ADR-012 §3), antes de ir a la pasarela: se guarda aunque no termine.
    await this.prisma.legalAcceptance.createMany({
      data: [
        { userId: user.id, organizationId, document: "terms", version: LEGAL_DOCUMENT_VERSIONS.terms, context: "checkout" },
        { userId: user.id, organizationId, document: "withdrawal_notice", version: LEGAL_DOCUMENT_VERSIONS.withdrawal_notice, context: "checkout" },
      ],
    });

    if (input.gateway === "MERCADO_PAGO") {
      return this.startMercadoPagoCheckout(organizationId, user, input, plan, amount);
    }

    const gateway = this.webpay!;
    let redirect;
    try {
      redirect = await gateway.startEnrollment({
        customerRef: customerRefFor(organizationId),
        email: user.email,
        returnUrl: `${env.API_PUBLIC_URL!.replace(/\/+$/, "")}/api/v1/billing/webpay/return`,
      });
    } catch (error) {
      logger.error("billing: no se pudo iniciar la inscripción", { organizationId, error: describe(error) });
      throw new UnprocessableEntityException({ code: "GATEWAY_ERROR", message: "Webpay no respondió. Intenta de nuevo en unos minutos." });
    }

    const checkout = await this.prisma.billingCheckout.create({
      data: {
        organizationId,
        userId: user.id,
        planId: plan.id,
        billingCycle: input.cycle,
        gateway: input.gateway,
        token: redirect.token,
        expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS),
      },
    });
    await this.audit.record({
      organizationId,
      actorId: user.id,
      action: "billing.checkout_started",
      targetType: "billing_checkout",
      targetId: checkout.id,
      metadata: { planCode: plan.code, cycle: input.cycle, gateway: input.gateway, amount },
    });
    logger.info("billing: inscripción iniciada", { organizationId, checkoutId: checkout.id, planCode: plan.code, cycle: input.cycle });
    return { url: redirect.url, method: redirect.method, fields: redirect.fields };
  }

  /**
   * Mercado Pago (F4.6b): se crea la suscripción `pending` en Mercado Pago con nuestra contratación
   * como `external_reference`, y el cliente la autoriza en su sitio. Mercado Pago cobra solo cada
   * período; lo que pase llega por webhook (y por la conciliación del worker).
   */
  private async startMercadoPagoCheckout(
    organizationId: string,
    user: { id: string; email: string },
    input: StartCheckoutInput,
    plan: Plan,
    amount: number,
  ): Promise<CheckoutRedirectResponse> {
    const gateway = this.mercadoPago!;
    const checkoutId = randomUUID();
    let preapproval;
    try {
      preapproval = await gateway.createSubscription({
        reason: `Impulza One — plan ${plan.name} (${input.cycle === "MONTHLY" ? "mensual" : "anual"})`,
        externalReference: checkoutId,
        payerEmail: user.email,
        amount,
        frequencyMonths: input.cycle === "MONTHLY" ? 1 : 12,
        backUrl: `${env.API_PUBLIC_URL!.replace(/\/+$/, "")}/api/v1/billing/mercadopago/return`,
      });
    } catch (error) {
      logger.error("billing: no se pudo crear la suscripción en Mercado Pago", { organizationId, error: describe(error) });
      throw new UnprocessableEntityException({ code: "GATEWAY_ERROR", message: "Mercado Pago no respondió. Intenta de nuevo en unos minutos." });
    }
    const checkout = await this.prisma.billingCheckout.create({
      data: {
        id: checkoutId,
        organizationId,
        userId: user.id,
        planId: plan.id,
        billingCycle: input.cycle,
        gateway: "MERCADO_PAGO",
        token: preapproval.id,
        expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS),
      },
    });
    await this.audit.record({
      organizationId,
      actorId: user.id,
      action: "billing.checkout_started",
      targetType: "billing_checkout",
      targetId: checkout.id,
      metadata: { planCode: plan.code, cycle: input.cycle, gateway: "MERCADO_PAGO", amount },
    });
    logger.info("billing: suscripción de Mercado Pago creada", { organizationId, checkoutId, planCode: plan.code });
    return { url: preapproval.initPoint!, method: "GET", fields: {} };
  }

  private mercadoPagoSyncDeps() {
    return {
      prisma: this.prisma,
      gateway: this.mercadoPago!,
      planUrl: this.planUrl(),
      sendEmail: async (to: string, content: { subject: string; text: string }) => {
        await this.emailAdapter.send({ to, subject: content.subject, text: content.text });
      },
    };
  }

  /** El cliente vuelve de Mercado Pago (`back_url?preapproval_id=…`). Se consulta el estado real. */
  async completeMercadoPagoReturn(preapprovalId: string | undefined): Promise<CheckoutOutcome> {
    if (!this.mercadoPago || !preapprovalId || preapprovalId.length > 128) return "error";
    const checkout = await this.prisma.billingCheckout.findUnique({ where: { token: preapprovalId } });
    if (!checkout || checkout.gateway !== "MERCADO_PAGO") return "error";
    try {
      await syncPreapproval(this.mercadoPagoSyncDeps(), preapprovalId);
    } catch (error) {
      logger.warn("billing: no se pudo consultar Mercado Pago al volver", { checkoutId: checkout.id, error: describe(error) });
      return "pendiente";
    }
    const settled = await this.prisma.billingCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
    if (settled.status === BillingCheckoutStatus.COMPLETED) return "exito";
    if (settled.status === BillingCheckoutStatus.FAILED) return "error";
    // Aún `pending` en Mercado Pago (o autorizando): el webhook lo resolverá.
    return "pendiente";
  }

  /**
   * Notificación de Mercado Pago. La firma se verifica **antes** de leer nada; después se registra
   * el aviso (único por pasarela + id) y se sincroniza consultando la API de Mercado Pago — el
   * cuerpo del aviso nunca se usa como verdad. Un aviso ya procesado responde sin efecto; uno que
   * falló se vuelve a procesar cuando Mercado Pago reintente.
   */
  async handleMercadoPagoWebhook(input: {
    signature: string | undefined;
    requestId: string | undefined;
    dataId: string | undefined;
    type: string | undefined;
    notificationId: string | undefined;
  }): Promise<{ processed: boolean }> {
    if (!this.mercadoPago) throw new NotFoundException();
    if (!this.mercadoPago.verifyWebhookSignature({ signature: input.signature, requestId: input.requestId, dataId: input.dataId })) {
      logger.warn("billing: aviso de Mercado Pago con firma inválida", { type: input.type });
      throw new UnauthorizedException("Firma inválida.");
    }
    const dataId = input.dataId!;
    const topic = input.type ?? "unknown";
    const eventId = (input.notificationId ?? `${topic}:${dataId}:${input.requestId ?? ""}`).slice(0, 200);

    const existing = await this.prisma.paymentWebhookEvent.findUnique({ where: { gateway_eventId: { gateway: "MERCADO_PAGO", eventId } } });
    if (existing?.processedAt) return { processed: false };
    const event =
      existing ??
      (await this.prisma.paymentWebhookEvent
        .create({ data: { gateway: "MERCADO_PAGO", eventId, topic } })
        .catch(async (error: unknown) => {
          if (!isUniqueViolation(error)) throw error;
          return this.prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { gateway_eventId: { gateway: "MERCADO_PAGO", eventId } } });
        }));

    const deps = this.mercadoPagoSyncDeps();
    if (topic === "subscription_preapproval") {
      await syncPreapproval(deps, dataId);
    } else if (topic === "subscription_authorized_payment") {
      await syncAuthorizedPayment(deps, dataId);
    } else {
      logger.info("billing: aviso de Mercado Pago ignorado", { topic });
    }
    await this.prisma.paymentWebhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { processed: true };
  }

  /**
   * Retorno de Transbank tras inscribir la tarjeta. Llega sin sesión (POST entre sitios): solo se
   * confía en el token, que es secreto y se busca en `BillingCheckout`. Idempotente: un segundo
   * retorno con el mismo token no inscribe ni cobra de nuevo.
   */
  async completeWebpayReturn(token: string | undefined): Promise<CheckoutOutcome> {
    if (!token || token.length > 128 || !this.webpay) return "error";
    const gateway = this.webpay;

    const claimed = await this.prisma.billingCheckout.updateMany({
      where: { token, status: BillingCheckoutStatus.OPEN, expiresAt: { gt: new Date() } },
      data: { status: BillingCheckoutStatus.PROCESSING },
    });
    if (claimed.count === 0) return this.outcomeOfSettledCheckout(token);

    const checkout = await this.prisma.billingCheckout.findUniqueOrThrow({
      where: { token },
      include: { plan: true, organization: true, user: { select: { email: true } } },
    });

    let enrollment;
    try {
      enrollment = await gateway.finishEnrollment(token);
    } catch (error) {
      // Rechazo de Transbank (422) = el cliente abandonó o el banco no autorizó la inscripción.
      const rejected = error instanceof PaymentGatewayError && error.code === "rejected";
      await this.failCheckout(checkout.id, rejected ? "enrollment_aborted" : `enrollment_error:${describe(error)}`);
      return rejected ? "rechazado" : "error";
    }
    if (!enrollment.approved || !enrollment.paymentMethodRef) {
      await this.failCheckout(checkout.id, `enrollment_rejected:${enrollment.responseCode}`);
      return "rechazado";
    }

    const start = new Date();
    const end = periodEnd(start, checkout.billingCycle);
    const amount = priceFor(checkout.plan, checkout.billingCycle);
    const { net, vat } = splitVat(amount);

    const { subscription, payment } = await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.create({
        data: {
          organizationId: checkout.organizationId,
          planId: checkout.planId,
          status: SubscriptionStatus.INCOMPLETE,
          currentPeriodStart: start,
          currentPeriodEnd: end,
          gateway: checkout.gateway,
          billingCycle: checkout.billingCycle,
          paymentMethodRefEncrypted: encryptSecret(enrollment.paymentMethodRef!, env.AUTH_ENCRYPTION_KEY),
          cardBrand: enrollment.cardBrand,
          cardLast4: enrollment.cardLast4,
        },
      });
      const payment = await tx.payment.create({
        data: {
          organizationId: checkout.organizationId,
          subscriptionId: subscription.id,
          gateway: checkout.gateway,
          buyOrder: buyOrderFor(subscription.id, start, 1),
          amount,
          netAmount: net,
          vatAmount: vat,
          currency: checkout.plan.currency,
          periodStart: start,
          periodEnd: end,
        },
      });
      await tx.billingCheckout.update({ where: { id: checkout.id }, data: { subscriptionId: subscription.id } });
      return { subscription, payment };
    });

    let charge;
    try {
      charge = await gateway.charge({
        customerRef: customerRefFor(checkout.organizationId),
        paymentMethodRef: enrollment.paymentMethodRef,
        buyOrder: payment.buyOrder,
        amount,
      });
    } catch (error) {
      // Resultado desconocido: el pago queda PENDING y el worker lo concilia con `chargeStatus`.
      // Nunca se reintenta el cobro desde acá.
      logger.warn("billing: primer cobro sin respuesta, queda para conciliar", { paymentId: payment.id, error: describe(error) });
      return "pendiente";
    }

    if (charge.status === "rejected") {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.REJECTED, responseCode: charge.responseCode, failureReason: `rejected:${charge.responseCode}` },
        }),
        this.prisma.subscription.update({ where: { id: subscription.id }, data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() } }),
      ]);
      await this.failCheckout(checkout.id, `charge_rejected:${charge.responseCode}`);
      await gateway
        .removeEnrollment({ customerRef: customerRefFor(checkout.organizationId), paymentMethodRef: enrollment.paymentMethodRef })
        .catch((error: unknown) => logger.warn("billing: no se pudo borrar la inscripción rechazada", { subscriptionId: subscription.id, error: describe(error) }));
      logger.info("billing: primer cobro rechazado", { organizationId: checkout.organizationId, responseCode: charge.responseCode });
      return "rechazado";
    }

    try {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.APPROVED, paidAt: new Date(), responseCode: charge.responseCode, authorizationCode: charge.authorizationCode },
        }),
        this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: SubscriptionStatus.ACTIVE, firstPaidAt: new Date(), nextChargeAt: end },
        }),
        this.prisma.billingCheckout.update({ where: { id: checkout.id }, data: { status: BillingCheckoutStatus.COMPLETED, completedAt: new Date() } }),
      ]);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Otra contratación de la misma organización se activó primero (dos pestañas): esta se
      // devuelve completa. El índice `subscriptions_one_live_per_org` es lo que lo detecta.
      await this.refundDuplicate(checkout.id, subscription.id, payment, gateway);
      return "error";
    }

    await this.audit.record({
      organizationId: checkout.organizationId,
      actorId: checkout.userId,
      action: "billing.subscription_started",
      targetType: "subscription",
      targetId: subscription.id,
      metadata: { planCode: checkout.plan.code, cycle: checkout.billingCycle, amount, gateway: checkout.gateway },
    });
    logger.info("billing: suscripción activada", { organizationId: checkout.organizationId, subscriptionId: subscription.id, planCode: checkout.plan.code, amount });

    const content = subscriptionStartedEmail({
      organizationName: checkout.organization.name,
      planName: checkout.plan.name,
      cycle: checkout.billingCycle,
      amount,
      planUrl: this.planUrl(),
      periodEnd: end,
      cardBrand: enrollment.cardBrand,
      cardLast4: enrollment.cardLast4,
      withdrawalUntil: new Date(Date.now() + WITHDRAWAL_DAYS * DAY_MS),
    });
    await this.emailAdapter
      .send({ to: checkout.user.email, subject: content.subject, text: content.text })
      .catch((error: unknown) => logger.warn("billing: no se pudo enviar el comprobante", { subscriptionId: subscription.id, error: describe(error) }));
    return "exito";
  }

  /**
   * Cancelar por el mismo medio en que se contrató (Ley 19.496, ADR-012 §3): un clic, sin trámites.
   * El plan sigue vigente hasta el fin del período pagado y no se vuelve a cobrar; el worker lo
   * cierra ese día. No borra la tarjeta todavía: así "reanudar" no exige inscribirla de nuevo.
   */
  async cancel(organizationId: string, user: { id: string; email: string }): Promise<BillingSubscriptionResponse> {
    const live = await this.liveSubscriptionOrThrow(organizationId);
    if (live.gateway === "MERCADO_PAGO" && !live.cancelAtPeriodEnd) {
      // Mercado Pago cobra solo: si no se cancela allá, seguiría cobrando. Primero allá, después acá.
      await this.cancelAtMercadoPago(live.externalProviderRef);
    }
    const updated = await this.prisma.subscription.updateMany({
      where: { id: live.id, status: { in: LIVE_STATUSES }, cancelAtPeriodEnd: false },
      data: { cancelAtPeriodEnd: true, canceledAt: new Date() },
    });
    if (updated.count !== 1) {
      throw new ConflictException({ code: "ALREADY_CANCELED", message: "Tu plan ya estaba cancelado." });
    }
    await this.audit.record({
      organizationId,
      actorId: user.id,
      action: "billing.subscription_canceled",
      targetType: "subscription",
      targetId: live.id,
      metadata: { planCode: live.plan.code, activeUntil: live.currentPeriodEnd.toISOString() },
    });
    logger.info("billing: suscripción cancelada al fin del período", { organizationId, subscriptionId: live.id });
    const content = subscriptionCanceledEmail({ organizationName: live.organization.name, planName: live.plan.name, activeUntil: live.currentPeriodEnd, planUrl: this.planUrl() });
    await this.sendQuietly(user.email, content, live.id);
    return this.toSubscriptionResponse(await this.prisma.subscription.findUniqueOrThrow({ where: { id: live.id }, include: { plan: true } }));
  }

  /** Deshacer la cancelación mientras el período pagado siga vigente. */
  async resume(organizationId: string, user: { id: string }): Promise<BillingSubscriptionResponse> {
    const live = await this.liveSubscriptionOrThrow(organizationId);
    if (live.gateway === "MERCADO_PAGO") {
      // Una suscripción cancelada en Mercado Pago no se puede reactivar allá.
      throw new ConflictException({ code: "NOT_RESUMABLE", message: "Con Mercado Pago no se puede reanudar: cuando termine el período, vuelve a contratar tu plan." });
    }
    const updated = await this.prisma.subscription.updateMany({
      where: { id: live.id, status: SubscriptionStatus.ACTIVE, cancelAtPeriodEnd: true, currentPeriodEnd: { gt: new Date() } },
      data: { cancelAtPeriodEnd: false, canceledAt: null },
    });
    if (updated.count !== 1) {
      throw new ConflictException({ code: "NOT_RESUMABLE", message: "Tu plan no está cancelado o ya terminó." });
    }
    await this.audit.record({ organizationId, actorId: user.id, action: "billing.subscription_resumed", targetType: "subscription", targetId: live.id });
    return this.toSubscriptionResponse(await this.prisma.subscription.findUniqueOrThrow({ where: { id: live.id }, include: { plan: true } }));
  }

  /**
   * Derecho a retracto (Ley 19.496 art. 3 bis b, ADR-012 §3): en los 10 días desde el primer cobro,
   * cancela de inmediato y devuelve el 100 % por la misma pasarela. Se **reclama** la suscripción
   * (pasa a CANCELED de forma condicional) antes de reembolsar, así dos clics no reembolsan dos
   * veces; si la pasarela falla antes de devolver nada, se revierte y el cliente puede reintentar.
   */
  async withdraw(organizationId: string, user: { id: string; email: string }): Promise<{ refundedAmount: number }> {
    const live = await this.liveSubscriptionOrThrow(organizationId);
    if (!live.firstPaidAt || !withinWithdrawalWindow(live.firstPaidAt)) {
      throw new UnprocessableEntityException({
        code: "WITHDRAWAL_EXPIRED",
        message: `El plazo de retracto es de ${WITHDRAWAL_DAYS} días desde el primer cobro y ya pasó. Puedes cancelar tu plan: seguirá activo hasta el fin del período pagado.`,
      });
    }
    if (live.gateway === "WEBPAY_ONECLICK" ? !this.webpay : live.gateway === "MERCADO_PAGO" ? !this.mercadoPago : true) {
      throw new UnprocessableEntityException({ code: "GATEWAY_UNAVAILABLE", message: "No podemos procesar el reembolso ahora. Escríbenos desde Soporte." });
    }
    const now = new Date();
    const claimed = await this.prisma.subscription.updateMany({
      where: { id: live.id, status: { in: LIVE_STATUSES } },
      data: {
        status: SubscriptionStatus.CANCELED,
        canceledAt: now,
        nextChargeAt: null,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: now > live.currentPeriodStart ? now : live.currentPeriodEnd,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException({ code: "ALREADY_CANCELED", message: "Tu plan ya estaba cancelado." });
    }

    const payments = await this.prisma.payment.findMany({ where: { subscriptionId: live.id, status: PaymentStatus.APPROVED }, orderBy: { createdAt: "asc" } });
    let refundedAmount = 0;
    for (const payment of payments) {
      const pending = payment.amount - payment.refundedAmount;
      if (pending <= 0) continue;
      try {
        const refund = await this.refundAtGateway(payment, pending);
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.REFUNDED,
            refundedAmount: payment.refundedAmount + refund.refundedAmount,
            refundedAt: new Date(),
            // Sin boleta emitida todavía: ya no hace falta. Si ya se emitió, requiere nota de crédito (F4.6d).
            ...(payment.taxDocumentStatus === "PENDING" ? { taxDocumentStatus: "NOT_REQUIRED" as const } : {}),
          },
        });
        refundedAmount += refund.refundedAmount;
      } catch (error) {
        logger.error("billing: falló el reembolso por retracto", { paymentId: payment.id, error: describe(error) });
        if (refundedAmount === 0) {
          // Nada devuelto: se deshace la cancelación para que el cliente pueda reintentar.
          await this.prisma.subscription.update({
            where: { id: live.id },
            data: {
              status: live.status,
              canceledAt: live.canceledAt,
              nextChargeAt: live.nextChargeAt,
              cancelAtPeriodEnd: live.cancelAtPeriodEnd,
              currentPeriodEnd: live.currentPeriodEnd,
            },
          });
          throw new BadGatewayException({ code: "REFUND_FAILED", message: "Webpay no pudo procesar el reembolso. Tu plan sigue igual: intenta de nuevo en unos minutos." });
        }
        // Parte devuelta: la suscripción queda cancelada y el saldo lo resuelve el equipo (F4.6d).
        await this.prisma.payment.update({ where: { id: payment.id }, data: { failureReason: "withdrawal_refund_failed" } });
      }
    }

    if (live.gateway === "MERCADO_PAGO") {
      await this.cancelAtMercadoPago(live.externalProviderRef).catch((error: unknown) =>
        logger.error("billing: no se pudo cancelar en Mercado Pago tras el retracto", { subscriptionId: live.id, error: describe(error) }),
      );
    } else {
      await this.forgetPaymentMethod(live, this.webpay!);
    }
    await this.audit.record({
      organizationId,
      actorId: user.id,
      action: "billing.withdrawal_refunded",
      targetType: "subscription",
      targetId: live.id,
      metadata: { planCode: live.plan.code, refundedAmount },
    });
    logger.info("billing: retracto con reembolso", { organizationId, subscriptionId: live.id, refundedAmount });
    const content = withdrawalRefundedEmail({ organizationName: live.organization.name, planName: live.plan.name, refundedAmount, planUrl: this.planUrl() });
    await this.sendQuietly(user.email, content, live.id);
    return { refundedAmount };
  }

  /** Si este ambiente puede reembolsar el cobro por su pasarela. */
  canRefund(payment: Pick<Payment, "gateway" | "providerPaymentId">): boolean {
    return payment.gateway === "MERCADO_PAGO" ? Boolean(this.mercadoPago && payment.providerPaymentId) : Boolean(this.webpay);
  }

  /** Reembolso por la pasarela del cobro: Webpay por orden de compra, Mercado Pago por id de pago. */
  async refundAtGateway(payment: Payment, amount: number): Promise<{ refundedAmount: number }> {
    if (payment.gateway === "MERCADO_PAGO") {
      if (!this.mercadoPago || !payment.providerPaymentId) {
        throw new UnprocessableEntityException({ code: "GATEWAY_UNAVAILABLE", message: "Este cobro de Mercado Pago no se puede reembolsar desde acá." });
      }
      const refund = await this.mercadoPago.refundPayment(payment.providerPaymentId, amount);
      return { refundedAmount: refund.refundedAmount || amount };
    }
    if (!this.webpay) throw new UnprocessableEntityException({ code: "GATEWAY_UNAVAILABLE", message: "Webpay no está configurado en este ambiente." });
    return this.webpay.refund({ buyOrder: payment.buyOrder, amount });
  }

  /** Detiene los cobros en Mercado Pago. Si falla, no se toca nada acá: el cliente reintenta. */
  private async cancelAtMercadoPago(preapprovalId: string | null): Promise<void> {
    if (!this.mercadoPago || !preapprovalId) {
      throw new UnprocessableEntityException({ code: "GATEWAY_UNAVAILABLE", message: "No podemos cancelar en Mercado Pago ahora. Escríbenos desde Soporte." });
    }
    try {
      await this.mercadoPago.cancelSubscription(preapprovalId);
    } catch (error) {
      logger.error("billing: Mercado Pago no canceló la suscripción", { preapprovalId, error: describe(error) });
      throw new BadGatewayException({ code: "GATEWAY_ERROR", message: "Mercado Pago no respondió. Tu plan sigue igual: intenta de nuevo en unos minutos." });
    }
  }

  private async liveSubscriptionOrThrow(organizationId: string) {
    const live = await this.prisma.subscription.findFirst({
      where: { organizationId, status: { in: LIVE_STATUSES } },
      include: { plan: true, organization: { select: { name: true } } },
    });
    if (!live) throw new NotFoundException({ code: "NO_SUBSCRIPTION", message: "No tienes un plan de pago activo." });
    return live;
  }

  /** Borra la inscripción en la pasarela y nuestra referencia: la tarjeta ya no se usará. */
  private async forgetPaymentMethod(subscription: Subscription, gateway: MerchantRecurringGateway): Promise<void> {
    if (!subscription.paymentMethodRefEncrypted) return;
    const paymentMethodRef = decryptSecret(subscription.paymentMethodRefEncrypted, env.AUTH_ENCRYPTION_KEY);
    await gateway
      .removeEnrollment({ customerRef: customerRefFor(subscription.organizationId), paymentMethodRef })
      .catch((error: unknown) => logger.warn("billing: no se pudo borrar la inscripción", { subscriptionId: subscription.id, error: describe(error) }));
    await this.prisma.subscription.update({ where: { id: subscription.id }, data: { paymentMethodRefEncrypted: null } });
  }

  private planUrl(): string {
    return `${env.APP_BASE_URL.replace(/\/+$/, "")}/plan`;
  }

  private async sendQuietly(to: string, content: { subject: string; text: string }, subscriptionId: string): Promise<void> {
    await this.emailAdapter
      .send({ to, subject: content.subject, text: content.text })
      .catch((error: unknown) => logger.warn("billing: no se pudo enviar el correo", { subscriptionId, error: describe(error) }));
  }

  /** El token ya no está abierto: repetir el resultado que tuvo, sin tocar nada. */
  private async outcomeOfSettledCheckout(token: string): Promise<CheckoutOutcome> {
    const checkout = await this.prisma.billingCheckout.findUnique({ where: { token } });
    if (!checkout) return "error";
    switch (checkout.status) {
      case BillingCheckoutStatus.COMPLETED:
        return "exito";
      case BillingCheckoutStatus.PROCESSING:
        return "pendiente";
      case BillingCheckoutStatus.FAILED:
        return "rechazado";
      case BillingCheckoutStatus.EXPIRED:
        return "vencido";
      case BillingCheckoutStatus.OPEN:
        await this.prisma.billingCheckout.updateMany({ where: { id: checkout.id, status: BillingCheckoutStatus.OPEN }, data: { status: BillingCheckoutStatus.EXPIRED } });
        return "vencido";
    }
  }

  private async failCheckout(checkoutId: string, reason: string): Promise<void> {
    await this.prisma.billingCheckout.update({
      where: { id: checkoutId },
      data: { status: BillingCheckoutStatus.FAILED, failureReason: reason.slice(0, 200), completedAt: new Date() },
    });
  }

  private async refundDuplicate(checkoutId: string, subscriptionId: string, payment: Payment, gateway: MerchantRecurringGateway): Promise<void> {
    logger.warn("billing: contratación duplicada, se reembolsa", { subscriptionId, paymentId: payment.id });
    try {
      const refund = await gateway.refund({ buyOrder: payment.buyOrder, amount: payment.amount });
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.REFUNDED, paidAt: new Date(), refundedAmount: refund.refundedAmount, refundedAt: new Date(), taxDocumentStatus: "NOT_REQUIRED" },
        }),
        this.prisma.subscription.update({ where: { id: subscriptionId }, data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() } }),
      ]);
    } catch (error) {
      // Queda aprobado y visible en superadministración para devolverlo a mano.
      logger.error("billing: no se pudo reembolsar la contratación duplicada", { paymentId: payment.id, error: describe(error) });
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.APPROVED, paidAt: new Date(), failureReason: "duplicate_refund_failed" } });
      await this.prisma.subscription.update({ where: { id: subscriptionId }, data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() } });
    }
    await this.failCheckout(checkoutId, "duplicate_subscription");
  }

  private toSubscriptionResponse(subscription: SubscriptionWithPlan): BillingSubscriptionResponse {
    const cancelled = subscription.cancelAtPeriodEnd || subscription.status === SubscriptionStatus.CANCELED;
    const withdrawalUntil = subscription.firstPaidAt ? new Date(subscription.firstPaidAt.getTime() + WITHDRAWAL_DAYS * DAY_MS) : null;
    return {
      id: subscription.id,
      planCode: subscription.plan.code,
      planName: subscription.plan.name,
      status: subscription.status,
      gateway: subscription.gateway,
      cycle: subscription.billingCycle,
      amount: priceFor(subscription.plan, subscription.billingCycle),
      currency: subscription.plan.currency,
      currentPeriodStart: subscription.currentPeriodStart.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      nextChargeAt: cancelled ? null : (subscription.nextChargeAt?.toISOString() ?? null),
      card: subscription.cardLast4 || subscription.cardBrand ? { brand: subscription.cardBrand, last4: subscription.cardLast4 } : null,
      withdrawalUntil: withdrawalUntil && subscription.status !== SubscriptionStatus.CANCELED && withdrawalUntil > new Date() ? withdrawalUntil.toISOString() : null,
    };
  }

  private toPaymentResponse(payment: Payment) {
    return {
      id: payment.id,
      amount: payment.amount,
      netAmount: payment.netAmount,
      vatAmount: payment.vatAmount,
      currency: payment.currency,
      status: payment.status,
      periodStart: payment.periodStart.toISOString(),
      periodEnd: payment.periodEnd.toISOString(),
      paidAt: payment.paidAt?.toISOString() ?? null,
      refundedAmount: payment.refundedAmount,
      createdAt: payment.createdAt.toISOString(),
    };
  }
}

function describe(error: unknown): string {
  if (error instanceof PaymentGatewayError) return `${error.code}`;
  return error instanceof Error ? error.name : "unknown";
}
