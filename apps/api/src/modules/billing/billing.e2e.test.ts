import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { billingOverviewResponse, checkoutRedirectResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { FakeRecurringGateway } from "@impulza/payments";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { BillingService } from "./billing.service.js";
import { MERCHANT_GATEWAY } from "./merchant-gateway.token.js";

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@billing-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const CHECKOUT = { planCode: "profesional", cycle: "MONTHLY", gateway: "WEBPAY_ONECLICK", acceptTerms: true, acceptWithdrawalNotice: true };

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Cobro de suscripciones con Webpay Oneclick (e2e) — F4.6a", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let gateway: FakeRecurringGateway;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    gateway = new FakeRecurringGateway();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(MERCHANT_GATEWAY)
      .useValue(gateway)
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    httpServer = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
  });

  afterAll(async () => {
    const orgs = { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } };
    // Los pagos no se borran en cascada (registro contable, ADR-012): primero ellos.
    await prisma.payment.deleteMany({ where: { organization: orgs } });
    await prisma.organization.deleteMany({ where: orgs });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    gateway.nextCharges = [];
    gateway.nextEnrollment = "approved";
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  async function registerUser() {
    const email = `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
    const password = "password1234";
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);
    return { agent, email };
  }

  async function createOrg() {
    const owner = await registerUser();
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Estudio Aurora", slug: uniqueSlug("org") }).expect(201);
    return { ...owner, organizationId: org.body.id as string };
  }

  /** Contrata y vuelve de la pasarela. Devuelve la ubicación a la que se redirige al navegador. */
  async function checkoutAndReturn(agent: ReturnType<typeof request.agent>, organizationId: string) {
    const started = await agent.post(`/api/v1/organizations/${organizationId}/billing/checkout`).set(CSRF_HEADERS).send(CHECKOUT).expect(201);
    const redirect = checkoutRedirectResponse.parse(started.body);
    const token = new URL(redirect.url).searchParams.get("TBK_TOKEN")!;
    // Transbank vuelve con un POST de formulario, sin sesión ni cabecera anti-CSRF.
    const back = await request(httpServer).post("/api/v1/billing/webpay/return").type("form").send({ TBK_TOKEN: token }).expect(303);
    return { token, location: back.headers.location as string };
  }

  it("un miembro ve el estado: sin suscripción, Webpay disponible y los días de retracto", async () => {
    const { agent, organizationId } = await createOrg();
    const res = await agent.get(`/api/v1/organizations/${organizationId}/billing`).expect(200);
    const body = billingOverviewResponse.parse(res.body);
    expect(body).toMatchObject({ subscription: null, gateways: ["WEBPAY_ONECLICK"], payments: [], legal: { withdrawalDays: 10 } });
  });

  it("contratar exige aceptar Términos y retracto, y no se contrata el plan Gratis", async () => {
    const { agent, organizationId } = await createOrg();
    const url = `/api/v1/organizations/${organizationId}/billing/checkout`;
    await agent.post(url).set(CSRF_HEADERS).send({ ...CHECKOUT, acceptTerms: false }).expect(400);
    await agent.post(url).set(CSRF_HEADERS).send({ ...CHECKOUT, acceptWithdrawalNotice: undefined }).expect(400);
    const free = await agent.post(url).set(CSRF_HEADERS).send({ ...CHECKOUT, planCode: "free" }).expect(422);
    expect(free.body.code).toBe("PLAN_NOT_PURCHASABLE");
    await agent.post(url).set(CSRF_HEADERS).send({ ...CHECKOUT, planCode: "no-existe" }).expect(404);
    const mp = await agent.post(url).set(CSRF_HEADERS).send({ ...CHECKOUT, gateway: "MERCADO_PAGO" }).expect(422);
    expect(mp.body.code).toBe("GATEWAY_UNAVAILABLE");
    expect(await prisma.billingCheckout.count({ where: { organizationId } })).toBe(0);
  });

  it("solo el dueño contrata: un ADMIN recibe 403", async () => {
    const { organizationId } = await createOrg();
    const admin = await registerUser();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: admin.email } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "ADMIN" } });
    await prisma.membership.create({ data: { userId: user.id, organizationId, roleId: role.id, status: "ACTIVE", acceptedAt: new Date() } });

    await admin.agent.get(`/api/v1/organizations/${organizationId}/billing`).expect(200);
    await admin.agent.post(`/api/v1/organizations/${organizationId}/billing/checkout`).set(CSRF_HEADERS).send(CHECKOUT).expect(403);
  });

  it("de punta a punta: inscribe, cobra con IVA, activa el plan, guarda la prueba legal y envía el comprobante", async () => {
    const { agent, organizationId, email } = await createOrg();
    const chargesBefore = gateway.charges.size;
    const { location } = await checkoutAndReturn(agent, organizationId);
    expect(location).toMatch(/\/plan\?pago=exito$/);

    const plan = await agent.get(`/api/v1/organizations/${organizationId}/plan`).expect(200);
    expect(plan.body).toMatchObject({ plan: { code: "profesional" }, source: "subscription" });

    const overview = billingOverviewResponse.parse((await agent.get(`/api/v1/organizations/${organizationId}/billing`).expect(200)).body);
    expect(overview.subscription).toMatchObject({ planCode: "profesional", status: "ACTIVE", cycle: "MONTHLY", amount: 7_990, cancelAtPeriodEnd: false, card: { brand: "Visa", last4: "6623" } });
    expect(overview.subscription!.withdrawalUntil).not.toBeNull();
    expect(overview.payments).toHaveLength(1);
    expect(overview.payments[0]).toMatchObject({ status: "APPROVED", amount: 7_990, netAmount: 6_714, vatAmount: 1_276 });
    expect(gateway.charges.size).toBe(chargesBefore + 1);

    // La referencia de la tarjeta se guarda cifrada, nunca en claro, y nada de la tarjeta sale en la respuesta.
    const subscription = await prisma.subscription.findFirstOrThrow({ where: { organizationId } });
    expect(subscription.paymentMethodRefEncrypted).toBeTruthy();
    expect(subscription.paymentMethodRefEncrypted).not.toContain("tbk-user");
    expect(JSON.stringify(overview)).not.toContain("tbk-user");

    const acceptances = await prisma.legalAcceptance.findMany({ where: { organizationId } });
    expect(acceptances.map((a) => a.document).sort()).toEqual(["terms", "withdrawal_notice"]);

    const receipt = emailAdapter.messages.find((m) => m.to === email && m.subject.startsWith("Tu plan"));
    expect(receipt?.subject).toBe("Tu plan Profesional está activo");
    expect(receipt?.text).toContain("IVA (19 %)");
    expect(receipt?.text).toContain("Derecho a retracto");

    const audit = await prisma.auditLog.findMany({ where: { organizationId, action: { startsWith: "billing." } } });
    expect(audit.map((a) => a.action).sort()).toEqual(["billing.checkout_started", "billing.subscription_started"]);
  });

  it("un retorno repetido no cobra de nuevo", async () => {
    const { agent, organizationId } = await createOrg();
    const { token } = await checkoutAndReturn(agent, organizationId);
    const charges = gateway.charges.size;

    const again = await request(httpServer).post("/api/v1/billing/webpay/return").type("form").send({ TBK_TOKEN: token }).expect(303);
    expect(again.headers.location).toMatch(/pago=exito$/);
    expect(gateway.charges.size).toBe(charges);
    expect(await prisma.payment.count({ where: { organizationId } })).toBe(1);
  });

  it("con un plan activo no se puede contratar otro", async () => {
    const { agent, organizationId } = await createOrg();
    await checkoutAndReturn(agent, organizationId);
    const res = await agent.post(`/api/v1/organizations/${organizationId}/billing/checkout`).set(CSRF_HEADERS).send(CHECKOUT).expect(409);
    expect(res.body.code).toBe("SUBSCRIPTION_ACTIVE");
  });

  it("cobro rechazado: sigue en Gratis, sin suscripción con derecho, y se borra la inscripción", async () => {
    const { agent, organizationId } = await createOrg();
    gateway.nextCharges = ["rejected"];
    const removedBefore = gateway.removed.length;
    const { location } = await checkoutAndReturn(agent, organizationId);
    expect(location).toMatch(/pago=rechazado$/);

    const plan = await agent.get(`/api/v1/organizations/${organizationId}/plan`).expect(200);
    expect(plan.body.plan.code).toBe("free");
    expect(await prisma.payment.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ status: "REJECTED", paidAt: null });
    expect(gateway.removed.length).toBe(removedBefore + 1);
  });

  it("inscripción rechazada por el banco: no crea suscripción ni cobra", async () => {
    const { agent, organizationId } = await createOrg();
    gateway.nextEnrollment = "rejected";
    const charges = gateway.charges.size;
    const { location } = await checkoutAndReturn(agent, organizationId);
    expect(location).toMatch(/pago=rechazado$/);
    expect(await prisma.subscription.count({ where: { organizationId } })).toBe(0);
    expect(gateway.charges.size).toBe(charges);
  });

  it("cobro sin respuesta: queda pendiente de conciliar y todavía no da el plan", async () => {
    const { agent, organizationId } = await createOrg();
    gateway.nextCharges = ["network"];
    const { location } = await checkoutAndReturn(agent, organizationId);
    expect(location).toMatch(/pago=pendiente$/);

    expect(await prisma.payment.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ status: "PENDING" });
    expect(await prisma.subscription.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ status: "INCOMPLETE" });
    const plan = await agent.get(`/api/v1/organizations/${organizationId}/plan`).expect(200);
    expect(plan.body.plan.code).toBe("free");
  });

  it("un retorno vencido o con token desconocido no inscribe nada", async () => {
    const { agent, organizationId } = await createOrg();
    const started = await agent.post(`/api/v1/organizations/${organizationId}/billing/checkout`).set(CSRF_HEADERS).send(CHECKOUT).expect(201);
    const token = new URL(started.body.url).searchParams.get("TBK_TOKEN")!;
    await prisma.billingCheckout.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const expired = await request(httpServer).post("/api/v1/billing/webpay/return").type("form").send({ TBK_TOKEN: token }).expect(303);
    expect(expired.headers.location).toMatch(/pago=vencido$/);
    const unknown = await request(httpServer).post("/api/v1/billing/webpay/return").type("form").send({ TBK_TOKEN: "no-existe" }).expect(303);
    expect(unknown.headers.location).toMatch(/pago=error$/);
    const missing = await request(httpServer).get("/api/v1/billing/webpay/return").expect(303);
    expect(missing.headers.location).toMatch(/pago=error$/);
    expect(await prisma.subscription.count({ where: { organizationId } })).toBe(0);
  });

  describe("Cancelar, reanudar y retracto (F4.6c)", () => {
    const base = (organizationId: string) => `/api/v1/organizations/${organizationId}/billing`;

    it("canManage lo decide el servidor: el dueño sí, un ADMIN no", async () => {
      const { agent, organizationId } = await createOrg();
      expect((await agent.get(base(organizationId)).expect(200)).body.canManage).toBe(true);

      const admin = await registerUser();
      const user = await prisma.user.findUniqueOrThrow({ where: { email: admin.email } });
      const role = await prisma.role.findUniqueOrThrow({ where: { name: "ADMIN" } });
      await prisma.membership.create({ data: { userId: user.id, organizationId, roleId: role.id, status: "ACTIVE", acceptedAt: new Date() } });
      expect((await admin.agent.get(base(organizationId)).expect(200)).body.canManage).toBe(false);
      await admin.agent.post(`${base(organizationId)}/cancel`).set(CSRF_HEADERS).expect(403);
      await admin.agent.post(`${base(organizationId)}/withdraw`).set(CSRF_HEADERS).expect(403);
    });

    it("cancelar: sigue vigente hasta el fin del período, sin próximo cobro, con correo; y se puede reanudar", async () => {
      const { agent, organizationId, email } = await createOrg();
      await checkoutAndReturn(agent, organizationId);

      const canceled = (await agent.post(`${base(organizationId)}/cancel`).set(CSRF_HEADERS).expect(200)).body;
      expect(canceled).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: true, nextChargeAt: null });
      expect((await agent.get(`/api/v1/organizations/${organizationId}/plan`).expect(200)).body.plan.code).toBe("profesional");
      expect(emailAdapter.messages.some((m) => m.to === email && m.subject === "Cancelaste tu plan Profesional")).toBe(true);
      expect((await agent.post(`${base(organizationId)}/cancel`).set(CSRF_HEADERS).expect(409)).body.code).toBe("ALREADY_CANCELED");

      const resumed = (await agent.post(`${base(organizationId)}/resume`).set(CSRF_HEADERS).expect(200)).body;
      expect(resumed).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: false });
      expect(resumed.nextChargeAt).not.toBeNull();
      expect((await agent.post(`${base(organizationId)}/resume`).set(CSRF_HEADERS).expect(409)).body.code).toBe("NOT_RESUMABLE");

      const actions = (await prisma.auditLog.findMany({ where: { organizationId, action: { in: ["billing.subscription_canceled", "billing.subscription_resumed"] } } })).map((a) => a.action);
      expect(actions.sort()).toEqual(["billing.subscription_canceled", "billing.subscription_resumed"]);
    });

    it("sin plan de pago, cancelar o pedir retracto responde 404", async () => {
      const { agent, organizationId } = await createOrg();
      expect((await agent.post(`${base(organizationId)}/cancel`).set(CSRF_HEADERS).expect(404)).body.code).toBe("NO_SUBSCRIPTION");
      await agent.post(`${base(organizationId)}/withdraw`).set(CSRF_HEADERS).expect(404);
    });

    it("retracto: reembolsa el 100 %, vuelve a Gratis de inmediato, borra la tarjeta y la boleta ya no hace falta", async () => {
      const { agent, organizationId, email } = await createOrg();
      await checkoutAndReturn(agent, organizationId);
      const refundsBefore = gateway.refunds.length;
      const removedBefore = gateway.removed.length;

      const res = await agent.post(`${base(organizationId)}/withdraw`).set(CSRF_HEADERS).expect(200);
      expect(res.body).toEqual({ refundedAmount: 7_990 });
      expect(gateway.refunds.length).toBe(refundsBefore + 1);
      expect(gateway.removed.length).toBe(removedBefore + 1);

      expect((await agent.get(`/api/v1/organizations/${organizationId}/plan`).expect(200)).body.plan.code).toBe("free");
      const payment = await prisma.payment.findFirstOrThrow({ where: { organizationId } });
      expect(payment).toMatchObject({ status: "REFUNDED", refundedAmount: 7_990, taxDocumentStatus: "NOT_REQUIRED" });
      expect(await prisma.subscription.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ status: "CANCELED", paymentMethodRefEncrypted: null });
      expect(emailAdapter.messages.some((m) => m.to === email && m.subject === "Reembolsamos tu plan Profesional")).toBe(true);

      // Un segundo clic no reembolsa de nuevo.
      await agent.post(`${base(organizationId)}/withdraw`).set(CSRF_HEADERS).expect(404);
      expect(gateway.refunds.length).toBe(refundsBefore + 1);
    });

    it("dos pedidos de retracto simultáneos reembolsan una sola vez", async () => {
      const { agent, organizationId, email } = await createOrg();
      await checkoutAndReturn(agent, organizationId);
      const refundsBefore = gateway.refunds.length;
      // Directo al servicio: por HTTP, el agente de supertest reutiliza una conexión y las
      // peticiones llegan en fila, así que nunca se cruzarían de verdad. Así sí se intercalan.
      const billing = app.get(BillingService);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      // Peor caso, forzado con una barrera: los tres leen la suscripción viva y recién entonces
      // siguen. Sin el reclamo condicional, los tres reembolsarían.
      type Internals = { liveSubscriptionOrThrow: (organizationId: string) => Promise<unknown> };
      const internals = billing as unknown as Internals;
      const read = internals.liveSubscriptionOrThrow.bind(billing);
      let arrived = 0;
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => (release = resolve));
      internals.liveSubscriptionOrThrow = async (id: string) => {
        const live = await read(id);
        arrived += 1;
        if (arrived === 3) release();
        await barrier;
        return live;
      };
      try {
        const results = await Promise.allSettled([1, 2, 3].map(() => billing.withdraw(organizationId, { id: user.id, email })));
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.response?.code)).toEqual(["ALREADY_CANCELED", "ALREADY_CANCELED"]);
      } finally {
        internals.liveSubscriptionOrThrow = read;
      }
      expect(gateway.refunds.length).toBe(refundsBefore + 1);
    });

    it("pasados los 10 días, el retracto se rechaza y el plan sigue igual", async () => {
      const { agent, organizationId } = await createOrg();
      await checkoutAndReturn(agent, organizationId);
      await prisma.subscription.updateMany({ where: { organizationId }, data: { firstPaidAt: new Date(Date.now() - 11 * 24 * 3_600_000) } });

      const res = await agent.post(`${base(organizationId)}/withdraw`).set(CSRF_HEADERS).expect(422);
      expect(res.body.code).toBe("WITHDRAWAL_EXPIRED");
      expect((await agent.get(`/api/v1/organizations/${organizationId}/plan`).expect(200)).body.plan.code).toBe("profesional");
      expect((await agent.get(base(organizationId)).expect(200)).body.subscription.withdrawalUntil).toBeNull();
    });

    it("si la pasarela no reembolsa, el plan queda como estaba y se puede reintentar", async () => {
      const { agent, organizationId } = await createOrg();
      await checkoutAndReturn(agent, organizationId);
      const original = gateway.refund.bind(gateway);
      gateway.refund = async () => {
        throw new Error("Transbank caído");
      };
      try {
        expect((await agent.post(`${base(organizationId)}/withdraw`).set(CSRF_HEADERS).expect(502)).body.code).toBe("REFUND_FAILED");
      } finally {
        gateway.refund = original;
      }
      expect(await prisma.subscription.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: false });
      expect(await prisma.payment.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ status: "APPROVED", refundedAmount: 0 });
      await agent.post(`${base(organizationId)}/withdraw`).set(CSRF_HEADERS).expect(200);
    });
  });
});
