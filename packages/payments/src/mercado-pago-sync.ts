import { BillingCheckoutStatus, PaymentStatus, type PrismaClient, SubscriptionStatus } from "@impulza/database";
import { periodEnd, splitVat, WITHDRAWAL_DAYS } from "./billing.js";
import { chargeFailedEmail, renewalChargedEmail, subscriptionStartedEmail, type SubscriptionEmail } from "./emails.js";
import type { AuthorizedPayment, MercadoPagoLike } from "./mercado-pago.js";

// Sincronización con Mercado Pago (F4.6b, ADR-012), compartida por el webhook (apps/api) y la
// conciliación periódica (apps/worker): la misma función, el mismo resultado, sin importar quién
// la llame ni cuántas veces. Siempre parte del estado que **Mercado Pago** informa por su API —
// nunca del cuerpo de una notificación — y cada efecto está protegido por una condición en la
// base (idempotencia).

const DAY_MS = 24 * 60 * 60 * 1000;
/** Mercado Pago reintenta una cuota rechazada hasta 4 veces en 10 días; la gracia lo acompaña. */
export const MERCADO_PAGO_GRACE_DAYS = 10;
const LIVE = [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE];

export interface SyncDeps {
  prisma: PrismaClient;
  gateway: MercadoPagoLike;
  sendEmail: (to: string, content: SubscriptionEmail) => Promise<void>;
  /** Enlace a "Plan y pagos" del panel, o `null`. */
  planUrl: string | null;
  now?: Date;
}

export type PreapprovalSyncResult = "activated" | "unchanged" | "canceled_remotely" | "unknown";

/** Orden de compra de una cuota de Mercado Pago: su id, con prefijo. Única en `Payment`. */
export function mercadoPagoBuyOrder(authorizedPaymentId: string): string {
  return `MP${authorizedPaymentId}`;
}

async function ownerEmails(prisma: PrismaClient, organizationId: string): Promise<string[]> {
  const owners = await prisma.membership.findMany({
    where: { organizationId, status: "ACTIVE", role: { name: "OWNER" } },
    select: { user: { select: { email: true } } },
  });
  return owners.map((owner) => owner.user.email);
}

async function notifyOwners(deps: SyncDeps, organizationId: string, content: SubscriptionEmail): Promise<void> {
  for (const to of await ownerEmails(deps.prisma, organizationId)) {
    await deps.sendEmail(to, content).catch(() => undefined);
  }
}

/**
 * Estado de una suscripción de Mercado Pago → nuestra suscripción.
 * - `authorized` y todavía no existe: se crea ACTIVE desde la contratación (`external_reference`).
 * - `cancelled`/`paused` y la nuestra sigue viva: ya no cobrará; se mantiene hasta el fin del
 *   período pagado (`cancelAtPeriodEnd`) y el worker la cierra ese día.
 */
export async function syncPreapproval(deps: SyncDeps, preapprovalId: string): Promise<PreapprovalSyncResult> {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const remote = await deps.gateway.getSubscription(preapprovalId);
  const existing = await prisma.subscription.findFirst({ where: { gateway: "MERCADO_PAGO", externalProviderRef: remote.id } });

  if (remote.status === "authorized" && !existing) {
    if (!remote.externalReference) return "unknown";
    const checkout = await prisma.billingCheckout.findFirst({
      where: { id: remote.externalReference, gateway: "MERCADO_PAGO", token: remote.id },
      include: { plan: true },
    });
    if (!checkout) return "unknown";
    const claimed = await prisma.billingCheckout.updateMany({
      where: { id: checkout.id, status: { in: [BillingCheckoutStatus.OPEN, BillingCheckoutStatus.EXPIRED] } },
      data: { status: BillingCheckoutStatus.PROCESSING },
    });
    if (claimed.count !== 1) return "unchanged";
    try {
      const subscription = await prisma.subscription.create({
        data: {
          organizationId: checkout.organizationId,
          planId: checkout.planId,
          status: SubscriptionStatus.ACTIVE,
          gateway: "MERCADO_PAGO",
          billingCycle: checkout.billingCycle,
          externalProviderRef: remote.id,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd(now, checkout.billingCycle),
          // Mercado Pago programa los cobros: nuestro worker no cobra estas suscripciones.
          nextChargeAt: null,
        },
      });
      await prisma.billingCheckout.update({ where: { id: checkout.id }, data: { status: BillingCheckoutStatus.COMPLETED, completedAt: now, subscriptionId: subscription.id } });
      await prisma.auditLog.create({
        data: {
          organizationId: checkout.organizationId,
          actorId: checkout.userId,
          action: "billing.subscription_started",
          targetType: "subscription",
          targetId: subscription.id,
          metadata: { planCode: checkout.plan.code, cycle: checkout.billingCycle, gateway: "MERCADO_PAGO" },
        },
      });
      return "activated";
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== "P2002") {
        // Falla pasajera: se libera la contratación para reintentar (webhook o conciliación). Jamás
        // se cancela el cobro del cliente por un error nuestro.
        await prisma.billingCheckout.update({ where: { id: checkout.id }, data: { status: BillingCheckoutStatus.OPEN } });
        throw error;
      }
      // Ya hay otra suscripción viva (índice `subscriptions_one_live_per_org`): esta no se activa y
      // se cancela en Mercado Pago para que nunca cobre.
      await prisma.billingCheckout.update({ where: { id: checkout.id }, data: { status: BillingCheckoutStatus.FAILED, failureReason: "duplicate_subscription", completedAt: now } });
      await deps.gateway.cancelSubscription(remote.id).catch(() => undefined);
      return "unchanged";
    }
  }

  if ((remote.status === "cancelled" || remote.status === "paused") && existing && LIVE.includes(existing.status as (typeof LIVE)[number]) && !existing.cancelAtPeriodEnd) {
    await prisma.subscription.updateMany({
      where: { id: existing.id, cancelAtPeriodEnd: false, status: { in: LIVE } },
      data: { cancelAtPeriodEnd: true, canceledAt: existing.canceledAt ?? now },
    });
    return "canceled_remotely";
  }

  return "unchanged";
}

export type AuthorizedPaymentSyncResult = "approved" | "rejected" | "pending" | "refunded" | "unchanged" | "unknown";

function paymentStatusOf(charge: AuthorizedPayment): PaymentStatus {
  const status = charge.payment?.status;
  if (status === "approved") return PaymentStatus.APPROVED;
  if (status === "refunded" || status === "charged_back") return PaymentStatus.REFUNDED;
  if (status === "rejected" || status === "cancelled" || charge.status === "recycling" || charge.status === "cancelled") return PaymentStatus.REJECTED;
  return PaymentStatus.PENDING;
}

/**
 * Una cuota de Mercado Pago → nuestro `Payment` y el estado de la suscripción. El `Payment` se crea
 * una sola vez por cuota (`buyOrder` único) y cada transición (a aprobado, a rechazado) se aplica
 * con una condición sobre el estado anterior: una notificación repetida no manda dos correos ni
 * suma dos fallos.
 */
export async function syncAuthorizedPayment(deps: SyncDeps, authorizedPaymentId: string): Promise<AuthorizedPaymentSyncResult> {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const charge = await deps.gateway.getAuthorizedPayment(authorizedPaymentId);

  let subscription = await prisma.subscription.findFirst({ where: { gateway: "MERCADO_PAGO", externalProviderRef: charge.preapprovalId }, include: { plan: true, organization: { select: { name: true } } } });
  if (!subscription) {
    // La cuota llegó antes que el aviso de la suscripción: se sincroniza primero la suscripción.
    await syncPreapproval(deps, charge.preapprovalId);
    subscription = await prisma.subscription.findFirst({ where: { gateway: "MERCADO_PAGO", externalProviderRef: charge.preapprovalId }, include: { plan: true, organization: { select: { name: true } } } });
    if (!subscription) return "unknown";
  }

  const status = paymentStatusOf(charge);
  const periodStart = charge.debitDate ?? now;
  const { net, vat } = splitVat(charge.amount);
  const buyOrder = mercadoPagoBuyOrder(charge.id);

  let payment = await prisma.payment.findUnique({ where: { buyOrder } });
  if (!payment) {
    try {
      payment = await prisma.payment.create({
        data: {
          organizationId: subscription.organizationId,
          subscriptionId: subscription.id,
          gateway: "MERCADO_PAGO",
          buyOrder,
          providerPaymentId: charge.payment?.id ?? null,
          amount: charge.amount,
          netAmount: net,
          vatAmount: vat,
          currency: charge.currency,
          periodStart,
          periodEnd: periodEnd(periodStart, subscription.billingCycle),
          status: PaymentStatus.PENDING,
        },
      });
    } catch {
      payment = await prisma.payment.findUniqueOrThrow({ where: { buyOrder } });
    }
  }

  const base = {
    organizationName: subscription.organization.name,
    planName: subscription.plan.name,
    cycle: subscription.billingCycle,
    amount: charge.amount,
    planUrl: deps.planUrl,
  };

  if (status === PaymentStatus.APPROVED) {
    const moved = await prisma.payment.updateMany({
      where: { id: payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.REJECTED] } },
      data: { status: PaymentStatus.APPROVED, paidAt: now, providerPaymentId: charge.payment?.id ?? payment.providerPaymentId, failureReason: null },
    });
    if (moved.count !== 1) return "unchanged";
    const first = subscription.firstPaidAt === null;
    const end = periodEnd(periodStart, subscription.billingCycle);
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        ...(LIVE.includes(subscription.status as (typeof LIVE)[number]) ? { status: SubscriptionStatus.ACTIVE } : {}),
        currentPeriodStart: periodStart,
        currentPeriodEnd: end,
        failedAttempts: 0,
        pastDueSince: null,
        ...(first ? { firstPaidAt: now } : {}),
      },
    });
    await notifyOwners(
      deps,
      subscription.organizationId,
      first
        ? subscriptionStartedEmail({ ...base, periodEnd: end, cardBrand: "Mercado Pago", cardLast4: null, withdrawalUntil: new Date(now.getTime() + WITHDRAWAL_DAYS * DAY_MS) })
        : renewalChargedEmail({ ...base, periodEnd: end, cardBrand: "Mercado Pago", cardLast4: null }),
    );
    return "approved";
  }

  if (status === PaymentStatus.REJECTED) {
    const moved = await prisma.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.REJECTED, failureReason: `mercado_pago:${charge.payment?.status ?? charge.status}` },
    });
    if (moved.count !== 1) return "unchanged";
    if (!LIVE.includes(subscription.status as (typeof LIVE)[number])) return "rejected";
    const graceEnd = new Date(periodStart.getTime() + MERCADO_PAGO_GRACE_DAYS * DAY_MS);
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.PAST_DUE,
        failedAttempts: { increment: 1 },
        pastDueSince: subscription.pastDueSince ?? periodStart,
        // Mientras Mercado Pago reintenta, el plan sigue vigente.
        currentPeriodEnd: subscription.currentPeriodEnd > graceEnd ? subscription.currentPeriodEnd : graceEnd,
      },
    });
    await notifyOwners(deps, subscription.organizationId, chargeFailedEmail({ ...base, graceEndsAt: graceEnd, nextRetryAt: charge.nextRetryDate }));
    return "rejected";
  }

  if (status === PaymentStatus.REFUNDED) {
    const moved = await prisma.payment.updateMany({
      where: { id: payment.id, status: { not: PaymentStatus.REFUNDED } },
      data: { status: PaymentStatus.REFUNDED, refundedAmount: payment.amount, refundedAt: now, paidAt: payment.paidAt ?? now },
    });
    return moved.count === 1 ? "refunded" : "unchanged";
  }

  return "pending";
}
