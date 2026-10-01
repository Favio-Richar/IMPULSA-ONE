import { createHmac, randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { encryptSecret, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { bookingResponse, orderResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { FakeMercadoPagoCheckout } from "@impulza/payments";
import { addDaysToDate, DEFAULT_BOOKING_SETTINGS, localDateOf, weekdayOf, zonedWallTimeToUtc } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { MERCADO_PAGO_CHECKOUT } from "./checkout.tokens.js";

// F5.11a (ADR-013) — reembolsos de pedidos y señas con el token del negocio, y contracargos o
// devoluciones hechas desde Mercado Pago que llegan por aviso.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@checkout-refunds-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const WEBHOOK_SECRET = "clave-de-firma-de-la-app-de-pruebas-0000";
const TZ = "America/Santiago";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sign(dataId: string, requestId: string): string {
  const ts = String(Date.now());
  return `ts=${ts},v1=${createHmac("sha256", WEBHOOK_SECRET).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex")}`;
}

function nextMondayAt(hour: number): string {
  let date = addDaysToDate(localDateOf(new Date(), TZ), 7);
  while (weekdayOf(date) !== 1) date = addDaysToDate(date, 1);
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return zonedWallTimeToUtc({ year, month, day, hour, minute: 0 }, TZ)!.toISOString();
}

describe("Reembolsos y contracargos (e2e) — F5.11a, ADR-013", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let checkout: FakeMercadoPagoCheckout;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    checkout = new FakeMercadoPagoCheckout();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(MERCADO_PAGO_CHECKOUT)
      .useValue({ checkout, webhookSecret: WEBHOOK_SECRET })
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
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  async function loggedIn() {
    const email = `${unique("user")}${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    return { email, agent };
  }

  /** Negocio con cuenta de Mercado Pago conectada, un producto y un servicio con seña. */
  async function business() {
    const owner = await loggedIn();
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio", slug: unique("org") }).expect(201);
    const organizationId = org.body.id as string;
    await assignRoomyPlan(prisma, organizationId);
    const siteSlug = unique("sitio");
    const site = await owner.agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Tienda Sol", slug: siteSlug }).expect(201);
    const siteBase = `/api/v1/organizations/${organizationId}/sites/${site.body.id}`;
    const product = await owner.agent.post(`${siteBase}/catalog/products`).set(CSRF).send({ name: "Curso", kind: "SERVICE", priceAmount: 20_000, priceCurrency: "CLP" }).expect(201);
    await owner.agent
      .put(`${siteBase}/booking/settings`)
      .set(CSRF)
      .send({ ...DEFAULT_BOOKING_SETTINGS, enabled: true, minNoticeMinutes: 0, weeklyHours: { mon: [{ start: "09:00", end: "12:00" }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } })
      .expect(200);
    const service = await owner.agent
      .post(`${siteBase}/booking/services`)
      .set(CSRF)
      .send({ name: "Masaje", durationMinutes: 60, priceAmount: 30_000, priceCurrency: "CLP", depositAmount: 6_000 })
      .expect(201);
    const account = { accessToken: `APP_USR-${randomBytes(12).toString("hex")}`, providerUserId: `${Date.now()}${Math.floor(Math.random() * 1000)}` };
    await prisma.paymentAccount.create({
      data: {
        organizationId,
        provider: "MERCADO_PAGO",
        providerUserId: account.providerUserId,
        accessTokenEncrypted: encryptSecret(account.accessToken, env.AUTH_ENCRYPTION_KEY),
        refreshTokenEncrypted: encryptSecret("TG-refresh-de-pruebas", env.AUTH_ENCRYPTION_KEY),
        expiresAt: new Date(Date.now() + 90 * 24 * 3_600_000),
        liveMode: false,
      },
    });
    emailAdapter.messages = [];
    return {
      owner: owner.agent,
      ownerEmail: owner.email,
      organizationId,
      account,
      productId: product.body.id as string,
      serviceId: service.body.id as string,
      orders: `/api/v1/organizations/${organizationId}/orders`,
      agenda: `/api/v1/organizations/${organizationId}/bookings`,
      publicCatalog: `/api/v1/public/sites/${siteSlug}/catalog`,
      publicBooking: `/api/v1/public/sites/${siteSlug}/booking`,
    };
  }

  function webhook(kind: "orders" | "bookings", id: string, paymentId: string) {
    const requestId = unique("req");
    return request(httpServer)
      .post(`/api/v1/payments/mercadopago/${kind}/${id}/webhook?data.id=${paymentId}&type=payment`)
      .set("x-request-id", requestId)
      .set("x-signature", sign(paymentId, requestId))
      .send({ type: "payment" });
  }

  /** Un pedido de 2 × $20.000 pagado con Mercado Pago. */
  async function paidOrder(b: Awaited<ReturnType<typeof business>>) {
    const customerEmail = `cliente.${unique("c")}${TEST_EMAIL_DOMAIN}`;
    await request(httpServer).post(`${b.publicCatalog}/orders`).set(CSRF).send({ productId: b.productId, quantity: 2, name: "Ana", email: customerEmail, consent: true }).expect(201);
    const order = await prisma.order.findFirstOrThrow({ where: { customerEmail } });
    const paymentId = checkout.pay(order.id, { collectorId: b.account.providerUserId });
    await webhook("orders", order.id, paymentId).expect(200, { result: "paid" });
    emailAdapter.messages = [];
    return { orderId: order.id, paymentId, customerEmail };
  }

  it("el dueño devuelve una parte y después el resto; lo devuelto sale de Mercado Pago y el cliente recibe el aviso", async () => {
    const b = await business();
    const { orderId, paymentId, customerEmail } = await paidOrder(b);

    const partial = orderResponse.parse((await b.owner.post(`${b.orders}/${orderId}/refund`).set(CSRF).send({ amount: 15_000 }).expect(200)).body);
    expect(partial.onlinePayment).toEqual({ status: "approved", paymentId, refundedAmount: 15_000 });
    const refund = checkout.refunds.find((item) => item.paymentId === paymentId)!;
    expect(refund).toMatchObject({ accessToken: b.account.accessToken, amount: 15_000, idempotencyKey: `refund-order-${orderId}-0-15000` });
    expect(emailAdapter.messages.find((m) => m.to === customerEmail)?.subject).toContain("Te devolvimos parte del pago");

    // Más de lo que queda: el servidor lo rechaza sin llamar a Mercado Pago.
    await b.owner.post(`${b.orders}/${orderId}/refund`).set(CSRF).send({ amount: 25_001 }).expect(422);

    const rest = orderResponse.parse((await b.owner.post(`${b.orders}/${orderId}/refund`).set(CSRF).send({}).expect(200)).body);
    expect(rest.onlinePayment).toEqual({ status: "refunded", paymentId, refundedAmount: 40_000 });
    expect(checkout.refunds.filter((item) => item.paymentId === paymentId).map((item) => item.amount)).toEqual([15_000, 25_000]);
    expect(await prisma.auditLog.count({ where: { organizationId: b.organizationId, action: "order.refunded", targetId: orderId } })).toBe(2);
    // Ya no queda nada por devolver.
    await b.owner.post(`${b.orders}/${orderId}/refund`).set(CSRF).send({}).expect(422);
  });

  it("solo el dueño devuelve dinero; un pedido sin pago en línea no se devuelve", async () => {
    const b = await business();
    const { orderId } = await paidOrder(b);
    const editor = await loggedIn();
    const invite = await b.owner.post(`/api/v1/organizations/${b.organizationId}/members`).set(CSRF).send({ email: editor.email, role: "EDITOR" }).expect(201);
    await editor.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
    // EDITOR atiende pedidos (order.manage) pero no devuelve dinero (payments.refund).
    await editor.agent.post(`${b.orders}/${orderId}/refund`).set(CSRF).send({}).expect(403);

    const unpaidEmail = `sinpago.${unique("c")}${TEST_EMAIL_DOMAIN}`;
    await request(httpServer).post(`${b.publicCatalog}/orders`).set(CSRF).send({ productId: b.productId, quantity: 1, name: "Beto", email: unpaidEmail, consent: true }).expect(201);
    const unpaid = await prisma.order.findFirstOrThrow({ where: { customerEmail: unpaidEmail } });
    await b.owner.post(`${b.orders}/${unpaid.id}/refund`).set(CSRF).send({}).expect(422);
    expect(checkout.refunds.filter((item) => item.accessToken === b.account.accessToken)).toHaveLength(0);
  });

  it("dos clics a la vez devuelven una sola vez; si Mercado Pago falla, reintentar no devuelve dos veces", async () => {
    const b = await business();
    const { orderId, paymentId } = await paidOrder(b);
    const responses = await Promise.all([0, 1, 2].map(() => b.owner.post(`${b.orders}/${orderId}/refund`).set(CSRF).send({})));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.every((r) => [200, 409, 422].includes(r.status))).toBe(true);
    expect(checkout.refunds.filter((item) => item.paymentId === paymentId)).toHaveLength(1);

    const other = await paidOrder(b);
    checkout.failNextRefund = true;
    await b.owner.post(`${b.orders}/${other.orderId}/refund`).set(CSRF).send({ amount: 5_000 }).expect(503);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: other.orderId } })).refundedAmount).toBe(0);
    await b.owner.post(`${b.orders}/${other.orderId}/refund`).set(CSRF).send({ amount: 5_000 }).expect(200);
    expect(checkout.refunds.filter((item) => item.paymentId === other.paymentId).map((item) => item.amount)).toEqual([5_000]);
  });

  it("devoluciones parciales a la vez nunca suman más que lo pagado: el saldo se vuelve a leer bajo el candado", async () => {
    const b = await business();
    const { orderId, paymentId } = await paidOrder(b);
    // 40.000 pagados; tres pedidos de devolución que juntos suman 75.000.
    const responses = await Promise.all([30_000, 25_000, 20_000].map((amount) => b.owner.post(`${b.orders}/${orderId}/refund`).set(CSRF).send({ amount })));
    expect(responses.every((r) => [200, 409, 422].includes(r.status))).toBe(true);
    const refunded = checkout.refunds.filter((item) => item.paymentId === paymentId).reduce((sum, item) => sum + item.amount, 0);
    expect(refunded).toBeLessThanOrEqual(40_000);
    expect(refunded).toBeGreaterThan(0);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.refundedAmount).toBe(refunded);
    // Después, lo que queda se puede devolver; nunca más que eso.
    await b.owner.post(`${b.orders}/${orderId}/refund`).set(CSRF).send({ amount: 40_000 - refunded + 1 }).expect(422);
  });

  it("un contracargo o una devolución hecha desde Mercado Pago llegan por aviso; el contracargo avisa al negocio una sola vez", async () => {
    const b = await business();
    const { orderId, paymentId } = await paidOrder(b);
    checkout.setStatus(paymentId, "charged_back");
    expect((await webhook("orders", orderId, paymentId).expect(200)).body).toEqual({ result: "dispute" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus).toBe("charged_back");
    const alert = emailAdapter.messages.find((m) => m.to === b.ownerEmail);
    expect(alert?.subject).toContain("Contracargo en Mercado Pago");
    expect(await prisma.auditLog.count({ where: { organizationId: b.organizationId, action: "order.payment_disputed", targetId: orderId } })).toBe(1);

    emailAdapter.messages = [];
    expect((await webhook("orders", orderId, paymentId).expect(200)).body).toEqual({ result: "unchanged" });
    expect(emailAdapter.messages).toHaveLength(0);
    // Con contracargo no se puede devolver desde Impulza.
    await b.owner.post(`${b.orders}/${orderId}/refund`).set(CSRF).send({}).expect(422);

    // Devolución hecha por el negocio directo en Mercado Pago: se registra lo devuelto.
    const other = await paidOrder(b);
    await checkout.refundPayment(b.account.accessToken, other.paymentId, 40_000, "desde-el-panel-de-mercado-pago");
    expect((await webhook("orders", other.orderId, other.paymentId).expect(200)).body).toEqual({ result: "updated" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: other.orderId } })).toMatchObject({ paymentStatus: "refunded", refundedAmount: 40_000 });
  });

  it("el dueño devuelve la seña de una reserva; el cliente recibe el aviso", async () => {
    const b = await business();
    const customerEmail = `reserva.${unique("c")}${TEST_EMAIL_DOMAIN}`;
    await request(httpServer).post(b.publicBooking).set(CSRF).send({ serviceId: b.serviceId, startsAt: nextMondayAt(9), name: "Ana", email: customerEmail, consent: true }).expect(201);
    const booking = await prisma.booking.findFirstOrThrow({ where: { customerEmail } });
    const paymentId = checkout.pay(booking.id, { collectorId: b.account.providerUserId });
    await webhook("bookings", booking.id, paymentId).expect(200, { result: "paid" });
    emailAdapter.messages = [];

    await b.owner.post(`${b.agenda}/${booking.id}/refund-deposit`).set(CSRF).send({ amount: 7_000 }).expect(422);
    const refunded = bookingResponse.parse((await b.owner.post(`${b.agenda}/${booking.id}/refund-deposit`).set(CSRF).send({}).expect(200)).body);
    expect(refunded).toMatchObject({ status: "CONFIRMED", deposit: { amount: 6_000, refundedAmount: 6_000, status: "refunded", paymentId } });
    expect(emailAdapter.messages.find((m) => m.to === customerEmail)?.subject).toContain("Te devolvimos la seña");
    expect(await prisma.auditLog.count({ where: { organizationId: b.organizationId, action: "booking.deposit_refunded", targetId: booking.id } })).toBe(1);
  });

  it("aislamiento (ADR-002/013): un negocio nunca devuelve el pago de otro", async () => {
    const a = await business();
    const b = await business();
    const { orderId } = await paidOrder(b);
    await a.owner.post(`${a.orders}/${orderId}/refund`).set(CSRF).send({}).expect(404);
    await a.owner.post(`${b.orders}/${orderId}/refund`).set(CSRF).send({}).expect(403);
    expect(checkout.refunds.filter((item) => item.accessToken === b.account.accessToken)).toHaveLength(0);
  });
});
