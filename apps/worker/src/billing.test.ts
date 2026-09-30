import "./load-dotenv.js";
import { encryptSecret, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { PrismaClient, type Subscription } from "@impulza/database";
import { buyOrderFor, FakeMercadoPagoGateway, FakeRecurringGateway, mercadoPagoBuyOrder, periodEnd } from "@impulza/payments";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runBillingCycle } from "./billing.js";

// F4.6a — renovación de suscripciones contra la base real, con la pasarela simulada: cobro de cada
// período, morosidad con gracia y reintentos, vuelta a Gratis sin borrar nada, conciliación de
// cobros sin respuesta y nunca un doble cobro.

class RecordingEmail implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("renovación de suscripciones (F4.6a)", () => {
  const prisma = new PrismaClient();
  const email = new RecordingEmail();
  const gateway = new FakeRecurringGateway();
  const mercadoPago = new FakeMercadoPagoGateway();
  const encryptionKey = process.env.AUTH_ENCRYPTION_KEY!;
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ownerEmail = `owner-${suffix}@billing-worker.test`;
  const organizationIds: string[] = [];
  let ownerId: string;
  let ownerRoleId: string;
  let planId: string;

  function run(now: Date) {
    // Solo las organizaciones de esta suite: el reloj adelantado no debe tocar datos de otras suites.
    return runBillingCycle(prisma, { gateway, mercadoPago, email, encryptionKey, dashboardBaseUrl: "http://panel.test", now, scope: { organizationIds } });
  }

  /** Organización con una suscripción mensual del plan Profesional que vence en `dueAt`. */
  async function subscribed(dueAt: Date, extra: Partial<Subscription> = {}) {
    const organization = await prisma.organization.create({ data: { name: "Estudio Renueva", slug: `renueva-${suffix}-${organizationIds.length}` } });
    organizationIds.push(organization.id);
    await prisma.membership.create({ data: { organizationId: organization.id, userId: ownerId, roleId: ownerRoleId, status: "ACTIVE" } });
    return prisma.subscription.create({
      data: {
        organizationId: organization.id,
        planId,
        status: "ACTIVE",
        gateway: "WEBPAY_ONECLICK",
        billingCycle: "MONTHLY",
        currentPeriodStart: new Date(dueAt.getTime() - 30 * DAY),
        currentPeriodEnd: dueAt,
        nextChargeAt: dueAt,
        firstPaidAt: new Date(dueAt.getTime() - 30 * DAY),
        paymentMethodRefEncrypted: encryptSecret(`tbk-user-${organization.id}`, encryptionKey),
        cardBrand: "Visa",
        cardLast4: "6623",
        ...extra,
      },
    });
  }

  beforeAll(async () => {
    const owner = await prisma.user.create({ data: { email: ownerEmail, passwordHash: "x", emailVerifiedAt: new Date() } });
    ownerId = owner.id;
    ownerRoleId = (await prisma.role.findUniqueOrThrow({ where: { name: "OWNER" } })).id;
    planId = (await prisma.plan.findUniqueOrThrow({ where: { code: "profesional" } })).id;
  });

  afterAll(async () => {
    // Los pagos no se borran en cascada (registro contable): primero ellos.
    await prisma.payment.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { email: ownerEmail } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    email.messages = [];
    gateway.nextCharges = [];
  });

  it("cobra el período vencido con IVA, avanza un mes, avisa al dueño y no vuelve a cobrar", async () => {
    const dueAt = new Date(Date.now() - HOUR);
    const subscription = await subscribed(dueAt);

    await run(new Date());
    const payments = await prisma.payment.findMany({ where: { subscriptionId: subscription.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: "APPROVED", amount: 7_990, netAmount: 6_714, vatAmount: 1_276, periodStart: dueAt, attempt: 1 });
    expect(payments[0]!.buyOrder).toBe(buyOrderFor(subscription.id, dueAt, 1));

    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(after).toMatchObject({ status: "ACTIVE", currentPeriodStart: dueAt, currentPeriodEnd: periodEnd(dueAt, "MONTHLY"), failedAttempts: 0 });
    expect(after.nextChargeAt).toEqual(periodEnd(dueAt, "MONTHLY"));
    expect(email.messages.find((m) => m.to === ownerEmail)?.subject).toBe("Renovamos tu plan Profesional");

    await run(new Date());
    expect(await prisma.payment.count({ where: { subscriptionId: subscription.id } })).toBe(1);
  });

  it("cobro rechazado: gracia con el plan vigente, reintento el día 1 y 3, y al cobrar el período parte del vencimiento original", async () => {
    const dueAt = new Date(Date.now() - HOUR);
    const subscription = await subscribed(dueAt);

    gateway.nextCharges = ["rejected"];
    await run(new Date());
    let after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(after).toMatchObject({ status: "PAST_DUE", failedAttempts: 1, pastDueSince: dueAt });
    expect(after.nextChargeAt).toEqual(new Date(dueAt.getTime() + DAY));
    // Sigue con derecho al plan durante la gracia (7 días).
    expect(after.currentPeriodEnd).toEqual(new Date(dueAt.getTime() + 7 * DAY));
    expect(email.messages.find((m) => m.to === ownerEmail)?.subject).toBe("No pudimos cobrar tu plan Profesional");

    gateway.nextCharges = ["rejected"];
    await run(new Date(dueAt.getTime() + DAY + 60_000));
    after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(after).toMatchObject({ status: "PAST_DUE", failedAttempts: 2 });
    expect(after.nextChargeAt).toEqual(new Date(dueAt.getTime() + 3 * DAY));

    await run(new Date(dueAt.getTime() + 3 * DAY + 60_000));
    after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(after).toMatchObject({ status: "ACTIVE", failedAttempts: 0, pastDueSince: null, currentPeriodStart: dueAt, currentPeriodEnd: periodEnd(dueAt, "MONTHLY") });

    const payments = await prisma.payment.findMany({ where: { subscriptionId: subscription.id }, orderBy: { attempt: "asc" } });
    expect(payments.map((p) => [p.attempt, p.status])).toEqual([[1, "REJECTED"], [2, "REJECTED"], [3, "APPROVED"]]);
    expect(new Set(payments.map((p) => p.buyOrder)).size).toBe(3);
  });

  it("agotados los reintentos vuelve a Gratis: cancela, borra la inscripción y avisa — sin tocar el contenido", async () => {
    const dueAt = new Date(Date.now() - HOUR);
    const subscription = await subscribed(dueAt);
    const site = await prisma.site.create({ data: { organizationId: subscription.organizationId, name: "Sitio", slug: `sitio-${suffix}` } });
    const removedBefore = gateway.removed.length;

    for (const day of [0, 1, 3, 6]) {
      gateway.nextCharges = ["rejected"];
      await run(new Date(dueAt.getTime() + day * DAY + 60_000));
    }

    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(after).toMatchObject({ status: "CANCELED", failedAttempts: 4, nextChargeAt: null, paymentMethodRefEncrypted: null });
    expect(gateway.removed.length).toBe(removedBefore + 1);
    expect(email.messages.some((m) => m.to === ownerEmail && m.subject === "Tu cuenta pasó al plan Gratis")).toBe(true);
    expect(await prisma.site.findUnique({ where: { id: site.id } })).not.toBeNull();
    expect(await prisma.payment.count({ where: { subscriptionId: subscription.id } })).toBe(4);
  });

  it("cobro sin respuesta: queda PENDING y la conciliación lo resuelve sin volver a cobrar", async () => {
    const dueAt = new Date(Date.now() - HOUR);
    const subscription = await subscribed(dueAt);
    const chargesBefore = gateway.charges.size;

    gateway.nextCharges = ["network"];
    await run(new Date());
    expect(await prisma.payment.findFirstOrThrow({ where: { subscriptionId: subscription.id } })).toMatchObject({ status: "PENDING" });
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).nextChargeAt).toBeNull();

    await run(new Date(Date.now() + 3 * 60_000));
    const payments = await prisma.payment.findMany({ where: { subscriptionId: subscription.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]!.status).toBe("APPROVED");
    expect(gateway.charges.size).toBe(chargesBefore + 1);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).toMatchObject({ status: "ACTIVE", currentPeriodStart: dueAt });
  });

  it("dos ciclos a la vez cobran una sola vez", async () => {
    const dueAt = new Date(Date.now() - HOUR);
    const subscription = await subscribed(dueAt);
    await Promise.all([run(new Date()), run(new Date()), run(new Date())]);
    expect(await prisma.payment.count({ where: { subscriptionId: subscription.id } })).toBe(1);
  });

  it("cancelada por el cliente: al fin del período termina sin cobrar", async () => {
    const dueAt = new Date(Date.now() - HOUR);
    const subscription = await subscribed(dueAt, { cancelAtPeriodEnd: true, canceledAt: new Date(dueAt.getTime() - DAY) });
    await run(new Date());
    expect(await prisma.payment.count({ where: { subscriptionId: subscription.id } })).toBe(0);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).toMatchObject({ status: "CANCELED" });
    expect(email.messages.some((m) => m.to === ownerEmail && m.text.includes("como pediste"))).toBe(true);
  });

  it("primer cobro sin respuesta en la contratación: la conciliación activa el plan", async () => {
    const start = new Date(Date.now() - 10 * 60_000);
    const subscription = await subscribed(periodEnd(start, "MONTHLY"), { status: "INCOMPLETE", currentPeriodStart: start, nextChargeAt: null, firstPaidAt: null });
    const buyOrder = buyOrderFor(subscription.id, start, 1);
    await prisma.payment.create({
      data: {
        organizationId: subscription.organizationId,
        subscriptionId: subscription.id,
        gateway: "WEBPAY_ONECLICK",
        buyOrder,
        amount: 7_990,
        netAmount: 6_714,
        vatAmount: 1_276,
        currency: "CLP",
        periodStart: start,
        periodEnd: periodEnd(start, "MONTHLY"),
        createdAt: start,
      },
    });
    // Transbank sí lo cobró, pero la respuesta nunca llegó.
    gateway.nextCharges = ["network"];
    await gateway.charge({ customerRef: "x", paymentMethodRef: "y", buyOrder, amount: 7_990 }).catch(() => undefined);

    await run(new Date());
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.firstPaidAt).not.toBeNull();
    expect(after.nextChargeAt).toEqual(periodEnd(start, "MONTHLY"));
    expect(email.messages.find((m) => m.to === ownerEmail)?.subject).toBe("Tu plan Profesional está activo");
  });

  it("no cobra a una organización bloqueada", async () => {
    const dueAt = new Date(Date.now() - HOUR);
    const subscription = await subscribed(dueAt);
    await prisma.organization.update({ where: { id: subscription.organizationId }, data: { status: "BLOCKED", blockedAt: new Date(), blockedReason: "prueba" } });
    await run(new Date());
    expect(await prisma.payment.count({ where: { subscriptionId: subscription.id } })).toBe(0);
  });

  it("con alcance, el ciclo no toca organizaciones de fuera aunque adelante el reloj", async () => {
    const outsider = await prisma.organization.create({ data: { name: "Fuera del alcance", slug: `fuera-${suffix}` } });
    const checkout = await prisma.billingCheckout.create({
      data: { organizationId: outsider.id, userId: ownerId, planId, billingCycle: "MONTHLY", gateway: "WEBPAY_ONECLICK", token: `tok-fuera-${suffix}`, expiresAt: new Date(Date.now() + HOUR) },
    });
    try {
      await run(new Date(Date.now() + 6 * DAY));
      expect((await prisma.billingCheckout.findUniqueOrThrow({ where: { id: checkout.id } })).status).toBe("OPEN");
    } finally {
      await prisma.organization.delete({ where: { id: outsider.id } });
    }
  });

  describe("Mercado Pago: conciliación (F4.6b)", () => {
    /** Organización con dueño y una contratación de Mercado Pago cuya suscripción allá es `preapprovalId`. */
    async function mpCheckout() {
      const organization = await prisma.organization.create({ data: { name: "Tienda MP", slug: `mp-${suffix}-${organizationIds.length}` } });
      organizationIds.push(organization.id);
      await prisma.membership.create({ data: { organizationId: organization.id, userId: ownerId, roleId: ownerRoleId, status: "ACTIVE" } });
      const checkoutId = crypto.randomUUID();
      const preapproval = await mercadoPago.createSubscription({ externalReference: checkoutId, payerEmail: ownerEmail, amount: 7_990 });
      await prisma.billingCheckout.create({
        data: { id: checkoutId, organizationId: organization.id, userId: ownerId, planId, billingCycle: "MONTHLY", gateway: "MERCADO_PAGO", token: preapproval.id, expiresAt: new Date(Date.now() - 60_000) },
      });
      return { organizationId: organization.id, preapprovalId: preapproval.id };
    }

    it("si el aviso de autorización se perdió, la conciliación activa el plan", async () => {
      const { organizationId, preapprovalId } = await mpCheckout();
      mercadoPago.authorize(preapprovalId);
      await run(new Date());
      expect(await prisma.subscription.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ gateway: "MERCADO_PAGO", status: "ACTIVE", externalProviderRef: preapprovalId });
    });

    it("una cuota que quedó en confirmación se concilia con lo que dice Mercado Pago", async () => {
      const { organizationId, preapprovalId } = await mpCheckout();
      mercadoPago.authorize(preapprovalId);
      await run(new Date());
      const subscription = await prisma.subscription.findFirstOrThrow({ where: { organizationId } });
      const chargeId = mercadoPago.charge(preapprovalId, "approved");
      await prisma.payment.create({
        data: {
          organizationId,
          subscriptionId: subscription.id,
          gateway: "MERCADO_PAGO",
          buyOrder: mercadoPagoBuyOrder(chargeId),
          amount: 7_990,
          netAmount: 6_714,
          vatAmount: 1_276,
          currency: "CLP",
          periodStart: new Date(),
          periodEnd: periodEnd(new Date(), "MONTHLY"),
          createdAt: new Date(Date.now() - 2 * HOUR),
        },
      });
      await run(new Date());
      expect(await prisma.payment.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ status: "APPROVED" });
      expect((await prisma.subscription.findFirstOrThrow({ where: { organizationId } })).firstPaidAt).not.toBeNull();
    });

    it("si el cliente la canceló en Mercado Pago, se respeta el período y no se renueva", async () => {
      const { organizationId, preapprovalId } = await mpCheckout();
      mercadoPago.authorize(preapprovalId);
      await run(new Date());
      mercadoPago.subscriptions.get(preapprovalId)!.status = "cancelled";
      await run(new Date());
      expect(await prisma.subscription.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: true });
    });

    it("al cerrar una morosa de Mercado Pago (gracia vencida) se cancela también allá", async () => {
      const { organizationId, preapprovalId } = await mpCheckout();
      mercadoPago.authorize(preapprovalId);
      await run(new Date());
      await prisma.subscription.updateMany({ where: { organizationId }, data: { status: "PAST_DUE", pastDueSince: new Date(Date.now() - 11 * DAY), currentPeriodStart: new Date(Date.now() - 41 * DAY), currentPeriodEnd: new Date(Date.now() - HOUR) } });
      await run(new Date());
      expect(await prisma.subscription.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ status: "CANCELED" });
      expect(mercadoPago.canceled).toContain(preapprovalId);
      expect(email.messages.some((m) => m.to === ownerEmail && m.subject === "Tu cuenta pasó al plan Gratis")).toBe(true);
    });
  });
});
