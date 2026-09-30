import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { adminBillingSummaryResponse, adminPaymentListResponse, adminRefundResponse, billingOverviewResponse, checkoutRedirectResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { FakeMercadoPagoGateway, FakeRecurringGateway } from "@impulza/payments";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import { generate } from "otplib";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { grantSuperAdmin } from "../admin/superadmin-grants.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { AdminBillingService } from "./admin-billing.service.js";
import { BillingService } from "./billing.service.js";
import { MERCADO_PAGO_GATEWAY, MERCHANT_GATEWAY } from "./merchant-gateway.token.js";

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
  let mercadoPago: FakeMercadoPagoGateway;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    gateway = new FakeRecurringGateway();
    mercadoPago = new FakeMercadoPagoGateway();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(MERCHANT_GATEWAY)
      .useValue(gateway)
      .overrideProvider(MERCADO_PAGO_GATEWAY)
      .useValue(mercadoPago)
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
    const keys = [...(await redis.keys("ratelimit:*")), ...(await redis.keys("admin-totp-used:*"))];
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
    expect(body).toMatchObject({ subscription: null, gateways: ["WEBPAY_ONECLICK", "MERCADO_PAGO"], payments: [], legal: { withdrawalDays: 10 } });
  });

  it("contratar exige aceptar Términos y retracto, y no se contrata el plan Gratis", async () => {
    const { agent, organizationId } = await createOrg();
    const url = `/api/v1/organizations/${organizationId}/billing/checkout`;
    await agent.post(url).set(CSRF_HEADERS).send({ ...CHECKOUT, acceptTerms: false }).expect(400);
    await agent.post(url).set(CSRF_HEADERS).send({ ...CHECKOUT, acceptWithdrawalNotice: undefined }).expect(400);
    const free = await agent.post(url).set(CSRF_HEADERS).send({ ...CHECKOUT, planCode: "free" }).expect(422);
    expect(free.body.code).toBe("PLAN_NOT_PURCHASABLE");
    await agent.post(url).set(CSRF_HEADERS).send({ ...CHECKOUT, planCode: "no-existe" }).expect(404);
    await agent.post(url).set(CSRF_HEADERS).send({ ...CHECKOUT, gateway: "PAYPAL" }).expect(400);
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

  describe("Ingresos en la superadministración (F4.6d)", () => {
    const admin = "/api/v1/admin/billing";

    // Una sola sesión de administración para todo el bloque: el inicio de sesión admite 5 intentos
    // cada 5 minutos por IP, y otras suites que corren en paralelo también inician sesión.
    let adminAgent: ReturnType<typeof request.agent> | null = null;
    async function loggedInAdmin() {
      adminAgent ??= await openAdminSession();
      return adminAgent;
    }

    async function openAdminSession() {
      const { email } = await registerUser();
      const grant = await grantSuperAdmin(prisma, email, env.AUTH_ENCRYPTION_KEY);
      const agent = request.agent(httpServer);
      const code = await generate({ secret: grant.twoFactorEnrollment!.secret });
      await agent.post("/api/v1/admin/auth/login").set(CSRF_HEADERS).send({ email, password: "password1234", code }).expect(201);
      return agent;
    }

    /** Organización con un plan Profesional pagado; devuelve su pago. */
    async function paidOrganization(name = "Estudio Aurora") {
      const org = await createOrg();
      await prisma.organization.update({ where: { id: org.organizationId }, data: { name } });
      await checkoutAndReturn(org.agent, org.organizationId);
      const payment = await prisma.payment.findFirstOrThrow({ where: { organizationId: org.organizationId } });
      return { ...org, payment };
    }

    it("una sesión del panel nunca alcanza los ingresos de la plataforma", async () => {
      const { agent } = await createOrg();
      await agent.get(`${admin}/summary`).expect(401);
      await agent.get(`${admin}/payments`).expect(401);
      await request(httpServer).get(`${admin}/summary`).expect(401);
    });

    it("el resumen suma MRR (anual / 12), cobrado con neto e IVA y boletas pendientes", async () => {
      const agent = await loggedInAdmin();
      const before = adminBillingSummaryResponse.parse((await agent.get(`${admin}/summary`).expect(200)).body);

      await paidOrganization();
      const yearly = await createOrg();
      const started = await yearly.agent.post(`/api/v1/organizations/${yearly.organizationId}/billing/checkout`).set(CSRF_HEADERS).send({ ...CHECKOUT, cycle: "YEARLY" }).expect(201);
      const token = new URL(started.body.url).searchParams.get("TBK_TOKEN")!;
      await request(httpServer).post("/api/v1/billing/webpay/return").type("form").send({ TBK_TOKEN: token }).expect(303);

      const after = adminBillingSummaryResponse.parse((await agent.get(`${admin}/summary`).expect(200)).body);
      expect(after.mrr - before.mrr).toBe(7_990 + Math.round(79_900 / 12));
      expect(after.arr).toBe(after.mrr * 12);
      expect(after.collected.total - before.collected.total).toBe(7_990 + 79_900);
      expect(after.collected.net + after.collected.vat).toBe(after.collected.total);
      expect(after.taxDocumentsPending.count - before.taxDocumentsPending.count).toBe(2);
      expect(after.movement.newSubscriptions - before.movement.newSubscriptions).toBe(2);
      expect(after.byPlan.find((row) => row.planCode === "profesional")?.subscriptions).toBeGreaterThanOrEqual(2);
      expect(after.month).toMatch(/^\d{4}-\d{2}$/);
      await agent.get(`${admin}/summary?month=2026-13`).expect(400);
    });

    it("marcar la boleta: solo una vez, con folio numérico, y queda auditado", async () => {
      const agent = await loggedInAdmin();
      const { payment, organizationId } = await paidOrganization();

      const pending = adminPaymentListResponse.parse((await agent.get(`${admin}/payments?taxDocument=PENDING&pageSize=100`).expect(200)).body);
      expect(pending.items.map((item) => item.id)).toContain(payment.id);

      await agent.post(`${admin}/payments/${payment.id}/tax-document`).set(CSRF_HEADERS).send({ documentNumber: "abc" }).expect(400);
      const issued = (await agent.post(`${admin}/payments/${payment.id}/tax-document`).set(CSRF_HEADERS).send({ documentNumber: "104233" }).expect(200)).body;
      expect(issued).toMatchObject({ taxDocumentStatus: "ISSUED", taxDocumentNumber: "104233" });
      expect((await agent.post(`${admin}/payments/${payment.id}/tax-document`).set(CSRF_HEADERS).send({ documentNumber: "104234" }).expect(409)).body.code).toBe("TAX_DOCUMENT_NOT_PENDING");
      await agent.post(`${admin}/payments/00000000-0000-4000-8000-000000000000/tax-document`).set(CSRF_HEADERS).send({ documentNumber: "1" }).expect(404);

      const audit = await prisma.auditLog.findFirst({ where: { organizationId, action: "admin.billing.tax_document_issued" } });
      expect(audit?.metadata).toMatchObject({ documentNumber: "104233" });
    });

    it("reembolso manual: devuelve, avisa al dueño, pide nota de crédito si la boleta ya se emitió, y no dos veces", async () => {
      const agent = await loggedInAdmin();
      const { payment, email, organizationId } = await paidOrganization();
      await agent.post(`${admin}/payments/${payment.id}/tax-document`).set(CSRF_HEADERS).send({ documentNumber: "555" }).expect(200);
      const refundsBefore = gateway.refunds.length;

      await agent.post(`${admin}/payments/${payment.id}/refund`).set(CSRF_HEADERS).send({ reason: "corto" }).expect(400);
      const res = adminRefundResponse.parse(
        (await agent.post(`${admin}/payments/${payment.id}/refund`).set(CSRF_HEADERS).send({ reason: "Cobro duplicado reportado por soporte" }).expect(200)).body,
      );
      expect(res).toMatchObject({ creditNoteRequired: true, payment: { status: "REFUNDED", refundedAmount: 7_990, taxDocumentStatus: "ISSUED" } });
      expect(gateway.refunds.length).toBe(refundsBefore + 1);
      expect(emailAdapter.messages.some((m) => m.to === email && m.subject === "Te devolvimos $7.990")).toBe(true);
      expect((await agent.post(`${admin}/payments/${payment.id}/refund`).set(CSRF_HEADERS).send({ reason: "Otra vez por las dudas" }).expect(409)).body.code).toBe("NOT_REFUNDABLE");

      const audit = await prisma.auditLog.findFirst({ where: { organizationId, action: "admin.billing.payment_refunded" } });
      expect(audit?.metadata).toMatchObject({ refundedAmount: 7_990, reason: "Cobro duplicado reportado por soporte", creditNoteRequired: true });
      // El reembolso manual no cancela la suscripción: eso lo decide el cliente.
      expect((await prisma.subscription.findFirstOrThrow({ where: { organizationId } })).status).toBe("ACTIVE");
    });

    it("dos reembolsos manuales simultáneos devuelven una sola vez", async () => {
      // Directo al servicio (sin HTTP) con un superadministrador real: la auditoría lo referencia.
      const { email: adminEmail } = await registerUser();
      const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
      const { payment } = await paidOrganization();
      const service = app.get(AdminBillingService);
      const refundsBefore = gateway.refunds.length;
      // Peor caso forzado: los tres leen el pago antes de que ninguno lo reclame.
      const original = prisma.payment.findUnique.bind(prisma.payment);
      let arrived = 0;
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => (release = resolve));
      (prisma.payment as { findUnique: unknown }).findUnique = async (args: Parameters<typeof original>[0]) => {
        const row = await original(args);
        arrived += 1;
        if (arrived === 3) release();
        await barrier;
        return row;
      };
      try {
        const results = await Promise.allSettled([1, 2, 3].map(() => service.refund(adminUser.id, payment.id, { reason: "Prueba de concurrencia" })));
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      } finally {
        (prisma.payment as { findUnique: unknown }).findUnique = original;
      }
      expect(gateway.refunds.length).toBe(refundsBefore + 1);
    });

    it("si Transbank no reembolsa, el cobro queda exactamente como estaba", async () => {
      const agent = await loggedInAdmin();
      const { payment } = await paidOrganization();
      const original = gateway.refund.bind(gateway);
      gateway.refund = async () => {
        throw new Error("Transbank caído");
      };
      try {
        expect((await agent.post(`${admin}/payments/${payment.id}/refund`).set(CSRF_HEADERS).send({ reason: "Cobro por error del sistema" }).expect(502)).body.code).toBe("REFUND_FAILED");
      } finally {
        gateway.refund = original;
      }
      expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "APPROVED", refundedAmount: 0, refundedAt: null, taxDocumentStatus: "PENDING" });
    });

    it("la planilla del mes lleva neto, IVA y folio, y neutraliza fórmulas en los nombres", async () => {
      const agent = await loggedInAdmin();
      const { payment } = await paidOrganization("=HYPERLINK(\"http://malo.test\")");
      const month = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
      const res = await agent.get(`${admin}/payments.csv?month=${month}`).buffer(true).parse((response, callback) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (data += chunk));
        response.on("end", () => callback(null, data));
      }).expect(200);
      const csv = res.body as string;
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain('"Fecha","Organización","Plan","Neto","IVA","Total"');
      const line = csv.split("\r\n").find((row) => row.includes(payment.buyOrder))!;
      expect(line).toContain(`"'=HYPERLINK(""http://malo.test"")"`);
      expect(line).toContain("6714,1276,7990");
      await agent.get(`${admin}/payments.csv`).expect(400);
    });
  });

  describe("Mercado Pago (F4.6b)", () => {
    const MP_CHECKOUT = { ...CHECKOUT, gateway: "MERCADO_PAGO" };
    let requestSeq = 0;

    /** Aviso de Mercado Pago firmado como lo firma Mercado Pago. */
    function notify(type: string, dataId: string, options: { signature?: string; notificationId?: string } = {}) {
      requestSeq += 1;
      const requestId = `req-${Date.now()}-${requestSeq}`;
      return request(httpServer)
        .post(`/api/v1/billing/mercadopago/webhook?data.id=${dataId}&type=${type}`)
        .set("x-request-id", requestId)
        .set("x-signature", options.signature ?? mercadoPago.sign(dataId, requestId))
        .send({ id: options.notificationId ?? `${type}-${dataId}-${requestId}`, type, action: "updated", data: { id: dataId } });
    }

    /** Contrata con Mercado Pago: devuelve el id de la suscripción allá. */
    async function startMp(agent: ReturnType<typeof request.agent>, organizationId: string) {
      const res = await agent.post(`/api/v1/organizations/${organizationId}/billing/checkout`).set(CSRF_HEADERS).send(MP_CHECKOUT).expect(201);
      expect(res.body.method).toBe("GET");
      const preapprovalId = new URL(res.body.url).searchParams.get("preapproval_id")!;
      return preapprovalId;
    }

    async function activeMp() {
      const org = await createOrg();
      const preapprovalId = await startMp(org.agent, org.organizationId);
      mercadoPago.authorize(preapprovalId);
      await request(httpServer).get(`/api/v1/billing/mercadopago/return?preapproval_id=${preapprovalId}`).expect(303);
      return { ...org, preapprovalId };
    }

    it("contratar crea la suscripción pendiente allá, ligada a nuestra contratación, y vuelve según su estado real", async () => {
      const { agent, organizationId } = await createOrg();
      const preapprovalId = await startMp(agent, organizationId);
      const checkout = await prisma.billingCheckout.findFirstOrThrow({ where: { organizationId } });
      expect(checkout).toMatchObject({ gateway: "MERCADO_PAGO", token: preapprovalId, status: "OPEN" });
      expect(mercadoPago.subscriptions.get(preapprovalId)).toMatchObject({ externalReference: checkout.id, amount: 7_990 });

      // Volvió sin autorizar: sigue pendiente y no da el plan.
      const early = await request(httpServer).get(`/api/v1/billing/mercadopago/return?preapproval_id=${preapprovalId}`).expect(303);
      expect(early.headers.location).toMatch(/pago=pendiente$/);
      expect((await agent.get(`/api/v1/organizations/${organizationId}/plan`).expect(200)).body.plan.code).toBe("free");

      mercadoPago.authorize(preapprovalId);
      const back = await request(httpServer).get(`/api/v1/billing/mercadopago/return?preapproval_id=${preapprovalId}`).expect(303);
      expect(back.headers.location).toMatch(/pago=exito$/);
      expect((await agent.get(`/api/v1/organizations/${organizationId}/plan`).expect(200)).body).toMatchObject({ plan: { code: "profesional" }, source: "subscription" });
      const subscription = await prisma.subscription.findFirstOrThrow({ where: { organizationId } });
      // Mercado Pago cobra solo: nuestro worker nunca la cobra (sin `nextChargeAt`) y aún no hay pago.
      expect(subscription).toMatchObject({ gateway: "MERCADO_PAGO", externalProviderRef: preapprovalId, status: "ACTIVE", nextChargeAt: null, firstPaidAt: null });

      const unknown = await request(httpServer).get("/api/v1/billing/mercadopago/return?preapproval_id=no-existe").expect(303);
      expect(unknown.headers.location).toMatch(/pago=error$/);
    });

    it("un aviso con firma inválida se rechaza sin tocar nada", async () => {
      const { preapprovalId, organizationId } = await activeMp();
      const chargeId = mercadoPago.charge(preapprovalId, "approved");
      await notify("subscription_authorized_payment", chargeId, { signature: `ts=1,v1=${"0".repeat(64)}` }).expect(401);
      await notify("subscription_authorized_payment", chargeId, { signature: "" }).expect(401);
      expect(await prisma.payment.count({ where: { organizationId } })).toBe(0);
    });

    it("cuota cobrada: pago con neto e IVA, primer cobro (retracto) y comprobante — y el aviso repetido no duplica nada", async () => {
      const { preapprovalId, organizationId, email } = await activeMp();
      const chargeId = mercadoPago.charge(preapprovalId, "approved");
      const notificationId = `notif-${chargeId}-${Date.now()}`;

      expect((await notify("subscription_authorized_payment", chargeId, { notificationId }).expect(200)).body).toEqual({ processed: true });
      const payment = await prisma.payment.findFirstOrThrow({ where: { organizationId } });
      expect(payment).toMatchObject({ gateway: "MERCADO_PAGO", status: "APPROVED", amount: 7_990, netAmount: 6_714, vatAmount: 1_276 });
      expect(payment.providerPaymentId).toBe(mercadoPago.authorizedPayments.get(chargeId)!.payment!.id);
      expect((await prisma.subscription.findFirstOrThrow({ where: { organizationId } })).firstPaidAt).not.toBeNull();
      // Cualquier comprobante cuenta (activación o renovación): un aviso repetido no debe mandar ninguno más.
      const receipts = () => emailAdapter.messages.filter((m) => m.to === email && /^(Tu plan .* está activo|Renovamos tu plan)/.test(m.subject)).length;
      expect(receipts()).toBe(1);

      // Mismo aviso otra vez (Mercado Pago reintenta): no procesa de nuevo.
      expect((await notify("subscription_authorized_payment", chargeId, { notificationId }).expect(200)).body).toEqual({ processed: false });
      // Otro aviso del mismo cobro: sincroniza, pero la transición ya ocurrió — sin segundo correo ni pago.
      await notify("subscription_authorized_payment", chargeId).expect(200);
      expect(await prisma.payment.count({ where: { organizationId } })).toBe(1);
      expect(receipts()).toBe(1);
    });

    it("cuota rechazada: morosa con el plan vigente mientras Mercado Pago reintenta; al cobrarse, vuelve a activa", async () => {
      const { preapprovalId, organizationId, email } = await activeMp();
      const chargeId = mercadoPago.charge(preapprovalId, "rejected");
      await notify("subscription_authorized_payment", chargeId).expect(200);
      let subscription = await prisma.subscription.findFirstOrThrow({ where: { organizationId } });
      expect(subscription).toMatchObject({ status: "PAST_DUE", failedAttempts: 1 });
      expect((await prisma.payment.findFirstOrThrow({ where: { organizationId } })).status).toBe("REJECTED");
      expect(emailAdapter.messages.some((m) => m.to === email && m.subject === "No pudimos cobrar tu plan Profesional")).toBe(true);

      // El reintento de Mercado Pago sobre la misma cuota sale aprobado.
      const charge = mercadoPago.authorizedPayments.get(chargeId)!;
      charge.status = "processed";
      charge.payment = { id: charge.payment!.id, status: "approved" };
      await notify("subscription_authorized_payment", chargeId).expect(200);
      subscription = await prisma.subscription.findFirstOrThrow({ where: { organizationId } });
      expect(subscription).toMatchObject({ status: "ACTIVE", failedAttempts: 0, pastDueSince: null });
      expect(await prisma.payment.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ status: "APPROVED" });
      expect(await prisma.payment.count({ where: { organizationId } })).toBe(1);
    });

    it("si la cuota llega antes que el aviso de la suscripción, primero la activa", async () => {
      const { agent, organizationId } = await createOrg();
      const preapprovalId = await startMp(agent, organizationId);
      mercadoPago.authorize(preapprovalId);
      const chargeId = mercadoPago.charge(preapprovalId, "approved");
      await notify("subscription_authorized_payment", chargeId).expect(200);
      expect(await prisma.subscription.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ status: "ACTIVE", gateway: "MERCADO_PAGO" });
      expect(await prisma.payment.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ status: "APPROVED" });
    });

    it("cancelar detiene los cobros en Mercado Pago primero; no se puede reanudar; si Mercado Pago falla, nada cambia", async () => {
      const { agent, organizationId, preapprovalId } = await activeMp();
      const original = mercadoPago.cancelSubscription.bind(mercadoPago);
      mercadoPago.cancelSubscription = async () => {
        throw new Error("Mercado Pago caído");
      };
      try {
        await agent.post(`/api/v1/organizations/${organizationId}/billing/cancel`).set(CSRF_HEADERS).expect(502);
      } finally {
        mercadoPago.cancelSubscription = original;
      }
      expect((await prisma.subscription.findFirstOrThrow({ where: { organizationId } })).cancelAtPeriodEnd).toBe(false);

      const canceled = (await agent.post(`/api/v1/organizations/${organizationId}/billing/cancel`).set(CSRF_HEADERS).expect(200)).body;
      expect(canceled).toMatchObject({ cancelAtPeriodEnd: true, status: "ACTIVE" });
      expect(mercadoPago.canceled).toContain(preapprovalId);
      expect((await agent.post(`/api/v1/organizations/${organizationId}/billing/resume`).set(CSRF_HEADERS).expect(409)).body.code).toBe("NOT_RESUMABLE");
    });

    it("si el cliente cancela desde Mercado Pago, se respeta el período pagado y no se vuelve a cobrar", async () => {
      const { organizationId, preapprovalId } = await activeMp();
      mercadoPago.subscriptions.get(preapprovalId)!.status = "cancelled";
      await notify("subscription_preapproval", preapprovalId).expect(200);
      expect(await prisma.subscription.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: true });
    });

    it("retracto con Mercado Pago: reembolsa por el id del pago y cancela allá", async () => {
      const { agent, organizationId, preapprovalId } = await activeMp();
      const chargeId = mercadoPago.charge(preapprovalId, "approved");
      await notify("subscription_authorized_payment", chargeId).expect(200);
      const paymentId = mercadoPago.authorizedPayments.get(chargeId)!.payment!.id;

      const res = await agent.post(`/api/v1/organizations/${organizationId}/billing/withdraw`).set(CSRF_HEADERS).expect(200);
      expect(res.body).toEqual({ refundedAmount: 7_990 });
      expect(mercadoPago.refunds).toContainEqual({ paymentId, amount: 7_990 });
      expect(mercadoPago.canceled).toContain(preapprovalId);
      expect(await prisma.payment.findFirstOrThrow({ where: { organizationId } })).toMatchObject({ status: "REFUNDED", refundedAmount: 7_990 });
      expect((await agent.get(`/api/v1/organizations/${organizationId}/plan`).expect(200)).body.plan.code).toBe("free");
    });

    it("dos pestañas: si ya se activó otro plan, la suscripción de Mercado Pago se cancela allá y nunca cobra", async () => {
      const { agent, organizationId } = await createOrg();
      const preapprovalId = await startMp(agent, organizationId);
      await checkoutAndReturn(agent, organizationId); // se pagó con Webpay en otra pestaña
      mercadoPago.authorize(preapprovalId);
      const back = await request(httpServer).get(`/api/v1/billing/mercadopago/return?preapproval_id=${preapprovalId}`).expect(303);
      expect(back.headers.location).toMatch(/pago=error$/);
      expect(mercadoPago.canceled).toContain(preapprovalId);
      expect(await prisma.subscription.count({ where: { organizationId } })).toBe(1);
      expect((await prisma.billingCheckout.findFirstOrThrow({ where: { organizationId, gateway: "MERCADO_PAGO" } })).failureReason).toBe("duplicate_subscription");
    });
  });
});
