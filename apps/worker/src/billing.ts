import { decryptSecret, type EmailAdapter } from "@impulza/auth";
import { BillingCheckoutStatus, PaymentStatus, type Payment, type Plan, type PrismaClient, type Subscription, SubscriptionStatus } from "@impulza/database";
import {
  buyOrderFor,
  chargeFailedEmail,
  type ChargeResult,
  customerRefFor,
  graceEndsAt,
  type MercadoPagoLike,
  type MerchantRecurringGateway,
  nextRetryAt,
  PaymentGatewayError,
  periodEnd,
  priceFor,
  renewalChargedEmail,
  splitVat,
  subscriptionEndedEmail,
  subscriptionStartedEmail,
  syncAuthorizedPayment,
  syncPreapproval,
  WITHDRAWAL_DAYS,
} from "@impulza/payments";
import { type ConnectionOptions, Queue, Worker } from "bullmq";
import { logger } from "./observability/logger.js";

// Motor de renovación (F4.6a, ADR-012). Webpay Oneclick no cobra solo: cada período lo cobra este
// trabajo. Reglas no negociables:
//  - Cada cobro tiene una `Payment` con `buyOrder` único y determinista ANTES de llamar a la
//    pasarela: un trabajo repetido choca con el índice único y nunca cobra dos veces.
//  - Un cobro sin respuesta queda PENDING y se concilia consultando a la pasarela; jamás se
//    reintenta a ciegas.
//  - Un pago fallido nunca borra contenido: la organización vuelve a Gratis y los límites de F4.2
//    solo impiden crear más.

export const BILLING_QUEUE = "billing-renewals";
const BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Un PENDING más nuevo que esto puede seguir en vuelo en otro proceso: no se concilia todavía. */
const PENDING_SETTLE_MS = 2 * 60 * 1000;
const RENEWABLE = [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE];
const LIVE = [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE];

export interface BillingRunOptions {
  /** Webpay Oneclick: la cobra este ciclo. `null` si no está configurado. */
  gateway: MerchantRecurringGateway | null;
  /** Mercado Pago (F4.6b): cobra sola; este ciclo solo concilia. `null`/ausente si no está configurado. */
  mercadoPago?: MercadoPagoLike | null;
  email: EmailAdapter;
  encryptionKey: string;
  /** Origen del panel, para el enlace "Plan y pagos" de los correos. */
  dashboardBaseUrl?: string;
  /**
   * Acota el ciclo a estas organizaciones (sin él, recorre toda la plataforma). Para atender un caso
   * puntual desde operación, y para que las pruebas — que adelantan el reloj — nunca toquen datos de
   * otras suites que corren en paralelo sobre la misma base.
   */
  scope?: { organizationIds: string[] };
  now?: Date;
}

/** Filtro por organización del alcance, o ninguno. */
function inScope(options: Pick<BillingRunOptions, "scope">): { organizationId?: { in: string[] } } {
  return options.scope ? { organizationId: { in: options.scope.organizationIds } } : {};
}

/** Lo que necesita aplicar un resultado o cerrar una suscripción (todo menos el reloj). */
type BillingDeps = Omit<BillingRunOptions, "now">;

export interface BillingRunResult {
  reconciled: number;
  renewed: number;
  failed: number;
  ended: number;
}

type SubscriptionWithPlan = Subscription & { plan: Plan; organization: { name: string; status: string } };

export async function runBillingCycle(prisma: PrismaClient, options: BillingRunOptions): Promise<BillingRunResult> {
  const now = options.now ?? new Date();
  const result: BillingRunResult = { reconciled: 0, renewed: 0, failed: 0, ended: 0 };
  await expireOpenCheckouts(prisma, options, now);
  if (options.gateway) result.reconciled += await reconcilePendingPayments(prisma, options, now);
  if (options.mercadoPago) result.reconciled += await reconcileMercadoPago(prisma, options, now);
  result.ended = await endFinishedSubscriptions(prisma, options, now);
  if (!options.gateway) return result;

  const due = await prisma.subscription.findMany({
    where: { ...inScope(options), status: { in: RENEWABLE }, gateway: "WEBPAY_ONECLICK", cancelAtPeriodEnd: false, nextChargeAt: { lte: now } },
    include: { plan: true, organization: { select: { name: true, status: true } } },
    orderBy: { nextChargeAt: "asc" },
    take: BATCH,
  });
  for (const subscription of due) {
    if (subscription.organization.status !== "ACTIVE") continue;
    const outcome = await renewOne(prisma, subscription, options, now);
    if (outcome === "approved") result.renewed += 1;
    if (outcome === "rejected") result.failed += 1;
  }
  return result;
}

async function expireOpenCheckouts(prisma: PrismaClient, options: BillingDeps, now: Date): Promise<void> {
  await prisma.billingCheckout.updateMany({ where: { ...inScope(options), status: BillingCheckoutStatus.OPEN, expiresAt: { lt: now } }, data: { status: BillingCheckoutStatus.EXPIRED } });
}

/** Fecha a la que corresponde el cobro en curso: el vencimiento original, aunque se esté reintentando. */
function dueDateOf(subscription: Subscription): Date {
  return subscription.pastDueSince ?? subscription.currentPeriodEnd;
}

async function renewOne(prisma: PrismaClient, subscription: SubscriptionWithPlan, options: BillingRunOptions, now: Date): Promise<"approved" | "rejected" | "pending" | "skipped"> {
  const dueAt = dueDateOf(subscription);
  // Reclamo: solo un proceso toma este cobro. `nextChargeAt = null` marca "en vuelo" hasta resolverlo.
  const claimed = await prisma.subscription.updateMany({
    where: { id: subscription.id, nextChargeAt: subscription.nextChargeAt, status: subscription.status },
    data: { nextChargeAt: null },
  });
  if (claimed.count !== 1) return "skipped";

  const attempt = subscription.failedAttempts + 1;
  const amount = priceFor(subscription.plan, subscription.billingCycle);
  const { net, vat } = splitVat(amount);
  let payment: Payment;
  try {
    payment = await prisma.payment.create({
      data: {
        organizationId: subscription.organizationId,
        subscriptionId: subscription.id,
        gateway: "WEBPAY_ONECLICK",
        buyOrder: buyOrderFor(subscription.id, dueAt, attempt),
        amount,
        netAmount: net,
        vatAmount: vat,
        currency: subscription.plan.currency,
        periodStart: dueAt,
        periodEnd: periodEnd(dueAt, subscription.billingCycle),
        attempt,
      },
    });
  } catch (error) {
    // Ya existe el cobro de este período e intento: otro proceso lo hizo. La conciliación lo resuelve.
    logger.warn("billing.renewal.duplicate_attempt", { subscriptionId: subscription.id, attempt, err: error });
    return "skipped";
  }

  const paymentMethodRef = subscription.paymentMethodRefEncrypted ? decryptSecret(subscription.paymentMethodRefEncrypted, options.encryptionKey) : null;
  if (!paymentMethodRef) {
    await applyChargeResult(prisma, payment.id, { status: "rejected", responseCode: -1, authorizationCode: null }, options, now, "no_payment_method");
    return "rejected";
  }

  let charge: ChargeResult;
  try {
    charge = await options.gateway!.charge({ customerRef: customerRefFor(subscription.organizationId), paymentMethodRef, buyOrder: payment.buyOrder, amount });
  } catch (error) {
    logger.warn("billing.renewal.no_response", { paymentId: payment.id, code: error instanceof PaymentGatewayError ? error.code : "unknown" });
    return "pending";
  }
  await applyChargeResult(prisma, payment.id, charge, options, now);
  return charge.status;
}

/**
 * Cobros PENDING (la pasarela no respondió): se pregunta a Transbank qué pasó con esa orden. Si no
 * la conoce, el cobro nunca llegó y se da por rechazado — el próximo intento usa otra orden.
 */
async function reconcilePendingPayments(prisma: PrismaClient, options: BillingRunOptions, now: Date): Promise<number> {
  const pending = await prisma.payment.findMany({
    where: { ...inScope(options), status: PaymentStatus.PENDING, gateway: "WEBPAY_ONECLICK", createdAt: { lt: new Date(now.getTime() - PENDING_SETTLE_MS) } },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
  let settled = 0;
  for (const payment of pending) {
    let status: ChargeResult | null;
    try {
      status = await options.gateway!.chargeStatus(payment.buyOrder);
    } catch (error) {
      logger.warn("billing.reconcile.unavailable", { paymentId: payment.id, code: error instanceof PaymentGatewayError ? error.code : "unknown" });
      continue;
    }
    await applyChargeResult(prisma, payment.id, status ?? { status: "rejected", responseCode: -1, authorizationCode: null }, options, now, status ? undefined : "not_found_at_gateway");
    settled += 1;
  }
  return settled;
}

/**
 * Aplica el resultado de un cobro a su pago y a su suscripción. Sirve para el primer cobro
 * (suscripción INCOMPLETE, conciliado) y para las renovaciones. Solo actúa sobre un pago PENDING:
 * aplicado una vez, un segundo resultado no cambia nada.
 */
export async function applyChargeResult(
  prisma: PrismaClient,
  paymentId: string,
  charge: ChargeResult,
  options: BillingDeps,
  now: Date,
  reason?: string,
): Promise<void> {
  const approved = charge.status === "approved";
  const settled = await prisma.payment.updateMany({
    where: { id: paymentId, status: PaymentStatus.PENDING },
    data: approved
      ? { status: PaymentStatus.APPROVED, paidAt: now, responseCode: charge.responseCode, authorizationCode: charge.authorizationCode }
      : { status: PaymentStatus.REJECTED, responseCode: charge.responseCode, failureReason: reason ?? `rejected:${charge.responseCode}` },
  });
  if (settled.count !== 1) return;

  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { subscription: { include: { plan: true, organization: { select: { name: true, status: true } } } } },
  });
  const subscription = payment.subscription;
  const planUrl = options.dashboardBaseUrl ? `${options.dashboardBaseUrl.replace(/\/+$/, "")}/plan` : null;
  const recipients = await ownerEmails(prisma, subscription.organizationId);
  const base = { organizationName: subscription.organization.name, planName: subscription.plan.name, cycle: subscription.billingCycle, amount: payment.amount, planUrl };

  if (subscription.status === SubscriptionStatus.INCOMPLETE) {
    // Primer cobro que había quedado sin respuesta.
    if (approved) {
      await prisma.$transaction([
        prisma.subscription.update({ where: { id: subscription.id }, data: { status: SubscriptionStatus.ACTIVE, firstPaidAt: now, nextChargeAt: subscription.currentPeriodEnd } }),
        prisma.billingCheckout.updateMany({ where: { subscriptionId: subscription.id }, data: { status: BillingCheckoutStatus.COMPLETED, completedAt: now } }),
      ]);
      await sendAll(options.email, recipients, subscriptionStartedEmail({
        ...base,
        periodEnd: subscription.currentPeriodEnd,
        cardBrand: subscription.cardBrand,
        cardLast4: subscription.cardLast4,
        withdrawalUntil: new Date(now.getTime() + WITHDRAWAL_DAYS * DAY_MS),
      }));
    } else {
      await prisma.$transaction([
        prisma.subscription.update({ where: { id: subscription.id }, data: { status: SubscriptionStatus.CANCELED, canceledAt: now } }),
        prisma.billingCheckout.updateMany({ where: { subscriptionId: subscription.id }, data: { status: BillingCheckoutStatus.FAILED, failureReason: "charge_rejected", completedAt: now } }),
      ]);
    }
    logger.info("billing.first_charge.reconciled", { subscriptionId: subscription.id, approved });
    return;
  }

  const dueAt = payment.periodStart;
  if (approved) {
    const end = periodEnd(dueAt, subscription.billingCycle);
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: SubscriptionStatus.ACTIVE, currentPeriodStart: dueAt, currentPeriodEnd: end, nextChargeAt: end, failedAttempts: 0, pastDueSince: null },
    });
    await sendAll(options.email, recipients, renewalChargedEmail({ ...base, periodEnd: end, cardBrand: subscription.cardBrand, cardLast4: subscription.cardLast4 }));
    logger.info("billing.renewal.approved", { subscriptionId: subscription.id, paymentId, amount: payment.amount });
    return;
  }

  const failedAttempts = subscription.failedAttempts + 1;
  const retryAt = nextRetryAt(dueAt, failedAttempts);
  if (retryAt) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      // Durante la gracia el período con derecho se extiende hasta el fin de la gracia (PlansService
      // exige `currentPeriodEnd` futuro); al cobrar, el período nuevo empieza en el vencimiento original.
      data: { status: SubscriptionStatus.PAST_DUE, pastDueSince: dueAt, currentPeriodEnd: graceEndsAt(dueAt), failedAttempts, nextChargeAt: retryAt },
    });
    await sendAll(options.email, recipients, chargeFailedEmail({ ...base, graceEndsAt: graceEndsAt(dueAt), nextRetryAt: retryAt }));
    logger.info("billing.renewal.rejected", { subscriptionId: subscription.id, failedAttempts, retryAt: retryAt.toISOString() });
    return;
  }

  await endSubscription(prisma, subscription, options, now, "payment_failed", recipients, failedAttempts);
}

/** Canceladas por el cliente que llegaron al fin del período pagado, y morosas con la gracia vencida. */
async function endFinishedSubscriptions(prisma: PrismaClient, options: BillingRunOptions, now: Date): Promise<number> {
  const finished = await prisma.subscription.findMany({
    where: {
      ...inScope(options),
      status: { in: LIVE },
      OR: [
        { cancelAtPeriodEnd: true, currentPeriodEnd: { lte: now } },
        { status: SubscriptionStatus.PAST_DUE, currentPeriodEnd: { lte: now } },
      ],
    },
    include: { plan: true, organization: { select: { name: true, status: true } } },
    take: BATCH,
  });
  for (const subscription of finished) {
    const reason = subscription.cancelAtPeriodEnd ? "canceled" : "payment_failed";
    await endSubscription(prisma, subscription, options, now, reason, await ownerEmails(prisma, subscription.organizationId));
  }
  return finished.length;
}

async function endSubscription(
  prisma: PrismaClient,
  subscription: SubscriptionWithPlan,
  options: BillingDeps,
  now: Date,
  reason: "payment_failed" | "canceled",
  recipients: string[],
  failedAttempts?: number,
): Promise<void> {
  const ended = await prisma.subscription.updateMany({
    where: { id: subscription.id, status: { in: LIVE } },
    data: {
      status: SubscriptionStatus.CANCELED,
      canceledAt: subscription.canceledAt ?? now,
      nextChargeAt: null,
      ...(failedAttempts !== undefined ? { failedAttempts } : {}),
      // El período con derecho termina ahora (nunca antes de su inicio).
      currentPeriodEnd: now > subscription.currentPeriodStart ? now : subscription.currentPeriodEnd,
    },
  });
  if (ended.count !== 1) return;
  // Mercado Pago cobra solo: si la cerramos (p. ej. gracia vencida), hay que cancelarla allá o
  // seguiría reintentando cobrar a una cuenta que ya está en Gratis.
  if (subscription.gateway === "MERCADO_PAGO" && subscription.externalProviderRef && options.mercadoPago) {
    await options.mercadoPago
      .cancelSubscription(subscription.externalProviderRef)
      .catch((error: unknown) => logger.error("billing.mercado_pago.cancel_failed", { subscriptionId: subscription.id, err: error }));
  }
  // La tarjeta ya no se usará: se borra la inscripción en la pasarela y nuestra referencia.
  if (subscription.paymentMethodRefEncrypted && options.gateway) {
    const paymentMethodRef = decryptSecret(subscription.paymentMethodRefEncrypted, options.encryptionKey);
    await options.gateway
      .removeEnrollment({ customerRef: customerRefFor(subscription.organizationId), paymentMethodRef })
      .catch((error: unknown) => logger.warn("billing.enrollment.remove_failed", { subscriptionId: subscription.id, err: error }));
    await prisma.subscription.update({ where: { id: subscription.id }, data: { paymentMethodRefEncrypted: null } });
  }
  const planUrl = options.dashboardBaseUrl ? `${options.dashboardBaseUrl.replace(/\/+$/, "")}/plan` : null;
  await sendAll(options.email, recipients, subscriptionEndedEmail({ organizationName: subscription.organization.name, planName: subscription.plan.name, planUrl, reason }));
  logger.info("billing.subscription.ended", { subscriptionId: subscription.id, reason });
}

/**
 * Conciliación con Mercado Pago (F4.6b): el respaldo del webhook. Consulta su API por lo que pudo
 * quedar sin avisar — suscripciones vivas (¿la canceló el cliente allá?), contrataciones recientes
 * sin suscripción (¿la autorizó y el aviso se perdió?) y cuotas en confirmación — con las mismas
 * funciones idempotentes que usa el webhook.
 */
async function reconcileMercadoPago(prisma: PrismaClient, options: BillingDeps, now: Date): Promise<number> {
  const deps = {
    prisma,
    gateway: options.mercadoPago!,
    planUrl: options.dashboardBaseUrl ? `${options.dashboardBaseUrl.replace(/\/+$/, "")}/plan` : null,
    sendEmail: async (to: string, content: { subject: string; text: string }) => {
      await options.email.send({ to, subject: content.subject, text: content.text });
    },
    now,
  };
  let touched = 0;
  const attempt = async (label: string, work: () => Promise<unknown>) => {
    try {
      await work();
      touched += 1;
    } catch (error) {
      logger.warn("billing.mercado_pago.reconcile_failed", { item: label, code: error instanceof PaymentGatewayError ? error.code : "unknown" });
    }
  };

  const live = await prisma.subscription.findMany({
    where: { ...inScope(options), gateway: "MERCADO_PAGO", status: { in: LIVE }, cancelAtPeriodEnd: false, externalProviderRef: { not: null } },
    select: { externalProviderRef: true },
    take: BATCH,
  });
  for (const subscription of live) await attempt("preapproval", () => syncPreapproval(deps, subscription.externalProviderRef!));

  const checkouts = await prisma.billingCheckout.findMany({
    where: { ...inScope(options), gateway: "MERCADO_PAGO", subscriptionId: null, status: { in: ["OPEN", "EXPIRED"] }, createdAt: { gte: new Date(now.getTime() - 2 * DAY_MS) } },
    select: { token: true },
    take: BATCH,
  });
  for (const checkout of checkouts) await attempt("checkout", () => syncPreapproval(deps, checkout.token));

  const pending = await prisma.payment.findMany({
    where: { ...inScope(options), gateway: "MERCADO_PAGO", status: PaymentStatus.PENDING, createdAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) } },
    select: { buyOrder: true },
    take: BATCH,
  });
  for (const payment of pending) await attempt("authorized_payment", () => syncAuthorizedPayment(deps, payment.buyOrder.replace(/^MP/, "")));
  return touched;
}

async function ownerEmails(prisma: PrismaClient, organizationId: string): Promise<string[]> {
  const owners = await prisma.membership.findMany({
    where: { organizationId, status: "ACTIVE", role: { name: "OWNER" } },
    select: { user: { select: { email: true } } },
  });
  return owners.map((owner) => owner.user.email);
}

async function sendAll(email: EmailAdapter, recipients: string[], content: { subject: string; text: string }): Promise<void> {
  for (const to of recipients) {
    try {
      await email.send({ to, subject: content.subject, text: content.text });
    } catch (error) {
      logger.error("billing.email.failed", { subject: content.subject, err: error });
    }
  }
}

export interface BillingWorkers {
  close(): Promise<void>;
}

/** Corre el ciclo cada hora: renovar a tiempo no necesita más, y así los reintentos caen el día que toca. */
export async function startBillingWorkers(options: {
  prisma: PrismaClient;
  connection: ConnectionOptions;
  gateway: MerchantRecurringGateway | null;
  mercadoPago?: MercadoPagoLike | null;
  email: EmailAdapter;
  encryptionKey: string;
  dashboardBaseUrl?: string;
}): Promise<BillingWorkers> {
  const queue = new Queue(BILLING_QUEUE, { connection: options.connection });
  await queue.upsertJobScheduler("billing-cycle-hourly", { pattern: "0 5 * * * *" }, { name: "run-billing-cycle" });
  const worker = new Worker(
    BILLING_QUEUE,
    async () => {
      const result = await runBillingCycle(options.prisma, options);
      if (result.reconciled + result.renewed + result.failed + result.ended > 0) {
        logger.info("billing.cycle.done", { ...result });
      }
      return result;
    },
    // Un solo ciclo a la vez: los reclamos ya evitan dobles cobros, esto además evita trabajo repetido.
    { connection: options.connection, concurrency: 1 },
  );
  worker.on("failed", (job, error) => logger.error("billing.cycle.failed", { jobId: job?.id, err: error }));
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
