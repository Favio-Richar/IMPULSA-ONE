import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { encryptSecret, type EmailAdapter } from "@impulza/auth";
import type { BillingOverviewResponse, BillingSubscriptionResponse, CheckoutRedirectResponse } from "@impulza/contracts";
import {
  BillingCheckoutStatus,
  PaymentStatus,
  type Payment,
  type Plan,
  type PrismaClient,
  type Subscription,
  SubscriptionStatus,
} from "@impulza/database";
import {
  buyOrderFor,
  customerRefFor,
  type MerchantRecurringGateway,
  PaymentGatewayError,
  periodEnd,
  priceFor,
  splitVat,
  subscriptionStartedEmail,
  WITHDRAWAL_DAYS,
} from "@impulza/payments";
import { LEGAL_DOCUMENT_VERSIONS, type StartCheckoutInput } from "@impulza/validation";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { MERCHANT_GATEWAY } from "./merchant-gateway.token.js";

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
    @Inject(EMAIL_ADAPTER) private readonly emailAdapter: EmailAdapter,
    private readonly audit: AuditService,
  ) {}

  /** Pasarelas que este ambiente puede ofrecer. Webpay necesita además la URL pública de la API. */
  availableGateways(): Array<"WEBPAY_ONECLICK" | "MERCADO_PAGO"> {
    return this.webpay && env.API_PUBLIC_URL ? ["WEBPAY_ONECLICK"] : [];
  }

  async overview(organizationId: string): Promise<BillingOverviewResponse> {
    const [live, payments] = await Promise.all([
      this.currentSubscription(organizationId),
      this.prisma.payment.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 24 }),
    ]);
    return {
      subscription: live ? this.toSubscriptionResponse(live) : null,
      gateways: this.availableGateways(),
      payments: payments.map((payment) => this.toPaymentResponse(payment)),
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
    const gateway = this.webpay!;

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
      planUrl: `${env.APP_BASE_URL.replace(/\/+$/, "")}/plan`,
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
