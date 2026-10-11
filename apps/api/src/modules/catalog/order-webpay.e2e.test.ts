import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { encryptSecret, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { orderListResponse, orderWebpayStartResponse, publicOrderConfirmationResponse, publicOrderStatusResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { FakeMercadoPagoCheckout, FakeWebpayPlus, WEBPAY_PLUS_INTEGRATION_CREDENTIALS } from "@impulza/payments";
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
import { MERCADO_PAGO_CHECKOUT, WEBPAY_PLUS_GATEWAY } from "../payment-accounts/checkout.tokens.js";

// F10.2d (ADR-030) — Webpay Plus en los pedidos de la tienda: la transacción se crea al pulsar «Pagar», el servidor confirma al volver
// el comprador y el pedido se marca pagado una sola vez, con el monto y la orden de compra guardados.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@order-webpay-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const WEBHOOK_SECRET = "clave-de-firma-de-la-app-de-pruebas-0000";
const CREDENTIALS = { commerceCode: WEBPAY_PLUS_INTEGRATION_CREDENTIALS.commerceCode, apiKeySecret: WEBPAY_PLUS_INTEGRATION_CREDENTIALS.apiKeySecret, environment: "integration" };
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

describe("Pedidos con Webpay Plus del negocio (e2e) — F10.2d / ADR-030", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let webpay: FakeWebpayPlus;
  let mercadoPago: FakeMercadoPagoCheckout;
  let http: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    webpay = new FakeWebpayPlus();
    mercadoPago = new FakeMercadoPagoCheckout();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(WEBPAY_PLUS_GATEWAY)
      .useValue(webpay)
      .overrideProvider(MERCADO_PAGO_CHECKOUT)
      .useValue({ checkout: mercadoPago, webhookSecret: WEBHOOK_SECRET })
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map((user) => user.id) } } });
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  async function business(options: { webpay?: boolean; mercadoPago?: boolean; commerceCode?: string } = {}) {
    const email = `${unique("owner")}${DOMAIN}`;
    const owner = request.agent(http);
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    await owner.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const org = await owner.post("/api/v1/organizations").set(CSRF).send({ name: "Pastelería", slug: unique("org") }).expect(201);
    const organizationId = org.body.id as string;
    await assignRoomyPlan(prisma, organizationId);
    const siteSlug = unique("sitio");
    const site = await owner.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Pastelería Luna", slug: siteSlug }).expect(201);
    const catalog = `/api/v1/organizations/${organizationId}/sites/${site.body.id}/catalog`;

    const mp = { accessToken: `APP_USR-${randomBytes(12).toString("hex")}`, providerUserId: `${Date.now()}${Math.floor(Math.random() * 1000)}` };
    if (options.mercadoPago) {
      await prisma.paymentAccount.create({
        data: {
          organizationId,
          provider: "MERCADO_PAGO",
          providerUserId: mp.providerUserId,
          accessTokenEncrypted: encryptSecret(mp.accessToken, env.AUTH_ENCRYPTION_KEY),
          refreshTokenEncrypted: encryptSecret("TG-refresh-de-pruebas", env.AUTH_ENCRYPTION_KEY),
          expiresAt: new Date(Date.now() + 90 * 24 * 3_600_000),
          liveMode: false,
        },
      });
    }
    if (options.webpay !== false) {
      await owner.put(`/api/v1/organizations/${organizationId}/payment-accounts/webpay-plus`).set(CSRF).send({ ...CREDENTIALS, ...(options.commerceCode ? { commerceCode: options.commerceCode } : {}) }).expect(204);
    }
    emailAdapter.messages = [];
    return { owner, ownerEmail: email, organizationId, catalog, mp, orders: `/api/v1/organizations/${organizationId}/orders`, publicCatalog: `/api/v1/public/sites/${siteSlug}/catalog` };
  }

  async function product(b: Awaited<ReturnType<typeof business>>, body: Record<string, unknown> = {}) {
    const res = await b.owner
      .post(`${b.catalog}/products`)
      .set(CSRF)
      .send({ name: "Torta de chocolate", kind: "SERVICE", priceAmount: 12_990, priceCurrency: "CLP", paymentUrl: "https://pago.ejemplo.cl/torta", ...body })
      .expect(201);
    return res.body.id as string;
  }

  async function placeOrder(b: Awaited<ReturnType<typeof business>>, productId: string, quantity = 2) {
    const customerEmail = `cliente.${unique("c")}${DOMAIN}`;
    const res = await request(http).post(`${b.publicCatalog}/orders`).set(CSRF).send({ productId, quantity, name: "Ana Pérez", email: customerEmail, consent: true }).expect(201);
    const confirmation = publicOrderConfirmationResponse.strict().parse(res.body);
    const order = await prisma.order.findFirstOrThrow({ where: { productId, customerEmail }, orderBy: { createdAt: "desc" } });
    const statusToken = /\/pedido\/([A-Za-z0-9_-]+)/.exec(emailAdapter.messages.find((m) => m.to === customerEmail)?.text ?? "")?.[1];
    return { confirmation, order, customerEmail, statusToken: statusToken! };
  }

  const startWebpay = (token: string) => request(http).post(`/api/v1/public/orders/${token}/webpay`).set(CSRF);
  const status = async (token: string) => publicOrderStatusResponse.strict().parse((await request(http).get(`/api/v1/public/orders/${token}`).set(CSRF).expect(200)).body);
  const returnGet = (orderId: string, token: string, query: Record<string, string>) =>
    request(http).get(`/api/v1/payments/webpay/orders/${orderId}/return`).query({ t: token, ...query });

  /** Crea la transacción y la deja pagada en el simulador (el comprador pagó en Webpay). */
  async function startAndPay(statusToken: string, outcome: { status?: string; responseCode?: number; amount?: number } = {}): Promise<string> {
    const started = orderWebpayStartResponse.parse((await startWebpay(statusToken).expect(200)).body);
    const token = started.fields.token_ws!;
    webpay.pay(token, outcome);
    return token;
  }

  it("un negocio solo con Webpay: el pedido ofrece pagar en «Tu pedido» y se queda sin enlace externo", async () => {
    const b = await business();
    const productId = await product(b);
    const before = mercadoPago.preferences.length;
    const { confirmation, order, customerEmail, statusToken } = await placeOrder(b, productId);

    expect(confirmation).toMatchObject({ paymentUrl: null, checkoutUrl: null, webpayUrl: `${env.PUBLIC_SITE_BASE_URL}/pedido/${statusToken}` });
    expect(mercadoPago.preferences.length).toBe(before);
    // Todavía no hay transacción: se crea al pulsar «Pagar» (cada intento necesita la suya).
    expect(webpay.created.filter((item) => item.sessionId === order.id)).toHaveLength(0);
    expect(order.statusTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(order.checkoutExpiresAt).not.toBeNull();
    const toCustomer = emailAdapter.messages.find((m) => m.to === customerEmail)!;
    expect(toCustomer.text).toContain("Webpay Plus");
    expect(toCustomer.text).not.toContain("Mercado Pago");
    expect(toCustomer.text).not.toContain("pago.ejemplo.cl");

    expect(await status(statusToken)).toMatchObject({ status: "NEW", paymentStatus: null, checkoutUrl: null, webpayAvailable: true, totalAmount: 25_980 });
  });

  it("crea la transacción con el comercio del negocio y el total guardado, sin tomar nada del visitante", async () => {
    const b = await business();
    const { order, statusToken } = await placeOrder(b, await product(b));

    // El visitante intenta imponer un monto: se ignora (la API toma el total del pedido).
    const res = await startWebpay(statusToken).send({ amount: 1, totalAmount: 1 }).expect(200);
    const started = orderWebpayStartResponse.parse(res.body);
    expect(started).toMatchObject({ method: "POST", checkoutUrl: "https://webpay3gint.transbank.cl/webpayserver/initTransaction" });
    const created = webpay.created.find((item) => item.token === started.fields.token_ws)!;
    expect(created).toMatchObject({ amount: 25_980, sessionId: order.id, commerceCode: CREDENTIALS.commerceCode });
    expect(created.returnUrl).toBe(`${env.API_PUBLIC_URL}/api/v1/payments/webpay/orders/${order.id}/return?t=${statusToken}`);
    expect(created.buyOrder).toMatch(/^[A-Za-z0-9]{1,26}$/);

    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored).toMatchObject({ webpayToken: started.fields.token_ws, webpayBuyOrder: created.buyOrder, paymentProvider: "WEBPAY_PLUS", providerPaymentId: null, status: "NEW" });

    // Un enlace inventado no revela nada.
    await startWebpay(randomBytes(32).toString("base64url")).expect(404);
  });

  it("al volver autorizado, el servidor confirma, marca pagado una sola vez y avisa con el nombre correcto", async () => {
    const b = await business();
    const { order, customerEmail, statusToken } = await placeOrder(b, await product(b));
    const token = await startAndPay(statusToken);
    emailAdapter.messages = [];

    const back = await returnGet(order.id, statusToken, {}).query({ token_ws: token }).expect(303);
    expect(back.headers.location).toBe(`${env.PUBLIC_SITE_BASE_URL}/pedido/${statusToken}`);
    expect(back.headers["cache-control"]).toBe("no-store");

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid).toMatchObject({ status: "PAID", paymentStatus: "approved", paymentProvider: "WEBPAY_PLUS" });
    expect(paid.providerPaymentId).toBe(`webpay:${paid.webpayBuyOrder}`);
    expect(paid.paidAt).not.toBeNull();
    expect(webpay.isCommitted(token)).toBe(true);

    expect(emailAdapter.messages.find((m) => m.to === customerEmail)?.text).toContain("Webpay Plus confirmó el pago");
    const toOwner = emailAdapter.messages.find((m) => m.to === b.ownerEmail)!;
    expect(toOwner.text).toContain("Webpay Plus");
    expect(toOwner.text).not.toContain("Mercado Pago");
    expect(toOwner.text).toContain(paid.webpayBuyOrder!);
    expect(await prisma.auditLog.count({ where: { organizationId: b.organizationId, action: "order.paid_online", targetId: order.id } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: b.organizationId, action: "order.paid_online", targetId: order.id } });
    expect(audit.metadata).toMatchObject({ provider: "WEBPAY_PLUS" });

    // Recargar la URL de regreso: sin efecto ni correos nuevos.
    emailAdapter.messages = [];
    await returnGet(order.id, statusToken, {}).query({ token_ws: token }).expect(303);
    expect(emailAdapter.messages).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { organizationId: b.organizationId, action: "order.paid_online", targetId: order.id } })).toBe(1);

    expect(await status(statusToken)).toMatchObject({ status: "PAID", paymentStatus: "approved", webpayAvailable: false });
    // Ya pagado: no se puede crear otra transacción.
    await startWebpay(statusToken).expect(409);

    // El panel muestra la pasarela y no ofrece devolver por Mercado Pago.
    const list = orderListResponse.parse((await b.owner.get(b.orders).expect(200)).body);
    expect(list.items.find((item) => item.id === order.id)?.onlinePayment).toEqual({
      status: "approved",
      paymentId: paid.providerPaymentId,
      refundedAmount: 0,
      provider: "WEBPAY_PLUS",
    });
  });

  it("regresos simultáneos del mismo pago: una sola confirmación, un solo aviso", async () => {
    const b = await business();
    const { order, statusToken } = await placeOrder(b, await product(b));
    const token = await startAndPay(statusToken);
    emailAdapter.messages = [];

    const results = await Promise.all(Array.from({ length: 6 }, () => returnGet(order.id, statusToken, {}).query({ token_ws: token })));
    expect(results.every((res) => res.status === 303)).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    expect(await prisma.auditLog.count({ where: { organizationId: b.organizationId, action: "order.paid_online", targetId: order.id } })).toBe(1);
    expect(emailAdapter.messages.filter((m) => m.to === b.ownerEmail)).toHaveLength(1);
  });

  it("tarjeta rechazada: queda constancia, el pedido sigue pendiente y se puede reintentar con una transacción nueva", async () => {
    const b = await business();
    const { order, statusToken } = await placeOrder(b, await product(b));
    const first = await startAndPay(statusToken, { status: "FAILED", responseCode: -1 });
    await returnGet(order.id, statusToken, {}).query({ token_ws: first }).expect(303);

    const rejected = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(rejected).toMatchObject({ status: "NEW", paymentStatus: "rejected", providerPaymentId: null });
    expect(await status(statusToken)).toMatchObject({ status: "NEW", paymentStatus: "rejected", webpayAvailable: true });

    const second = await startAndPay(statusToken);
    expect(second).not.toBe(first);
    await returnGet(order.id, statusToken, {}).query({ token_ws: second }).expect(303);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "PAID", paymentStatus: "approved" });
    // La transacción rechazada nunca se volvió a confirmar.
    expect(await prisma.auditLog.count({ where: { organizationId: b.organizationId, action: "order.paid_online", targetId: order.id } })).toBe(1);
  });

  it("un monto distinto al del pedido no lo marca pagado", async () => {
    const b = await business();
    const { order, statusToken } = await placeOrder(b, await product(b));
    const token = await startAndPay(statusToken, { amount: 100 });
    await returnGet(order.id, statusToken, {}).query({ token_ws: token }).expect(303);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "NEW", providerPaymentId: null });
    expect(await prisma.auditLog.count({ where: { organizationId: b.organizationId, action: "order.paid_online", targetId: order.id } })).toBe(0);
  });

  it("el token de la URL nunca se toma como verdad: uno ajeno no confirma ni consume la transacción de otro pedido", async () => {
    const b = await business();
    const productId = await product(b);
    const mine = await placeOrder(b, productId);
    const other = await placeOrder(b, productId);
    await startAndPay(mine.statusToken);
    const otherToken = await startAndPay(other.statusToken);

    await returnGet(mine.order.id, mine.statusToken, {}).query({ token_ws: otherToken }).expect(303);
    expect(webpay.isCommitted(otherToken)).toBe(false);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: mine.order.id } })).toMatchObject({ status: "NEW", providerPaymentId: null });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: other.order.id } })).toMatchObject({ status: "NEW", providerPaymentId: null });

    // Enlace de pedido que no corresponde al pedido de la URL: 404, sin pistas.
    await returnGet(other.order.id, mine.statusToken, {}).query({ token_ws: otherToken }).expect(404);
    await returnGet(mine.order.id, "no-es-un-enlace", {}).expect(404);
    expect(webpay.isCommitted(otherToken)).toBe(false);
  });

  it("abandonar el pago en Webpay no cobra ni cambia nada", async () => {
    const b = await business();
    const { order, statusToken } = await placeOrder(b, await product(b));
    const token = await startAndPay(statusToken);
    await returnGet(order.id, statusToken, {}).query({ TBK_TOKEN: token }).expect(303);
    expect(webpay.isCommitted(token)).toBe(false);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "NEW", providerPaymentId: null, paymentStatus: null });
  });

  it("un pedido vencido o cancelado no se puede pagar con Webpay", async () => {
    const b = await business();
    const productId = await product(b);
    const expired = await placeOrder(b, productId);
    await prisma.order.update({ where: { id: expired.order.id }, data: { checkoutExpiresAt: new Date(Date.now() - 1000) } });
    await startWebpay(expired.statusToken).expect(409);
    expect(await status(expired.statusToken)).toMatchObject({ webpayAvailable: false });

    const cancelled = await placeOrder(b, productId);
    await b.owner.patch(`${b.orders}/${cancelled.order.id}`).set(CSRF).send({ status: "CANCELLED" }).expect(200);
    await startWebpay(cancelled.statusToken).expect(409);
  });

  it("si Transbank no responde, el pedido sigue y se puede reintentar", async () => {
    const b = await business();
    const { order, statusToken } = await placeOrder(b, await product(b));
    webpay.failNextCreate = true;
    await startWebpay(statusToken).expect(503);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "NEW", webpayToken: null });
    await startWebpay(statusToken).expect(200);
  });

  it("con Mercado Pago y Webpay: se ofrecen los dos y gana el medio que efectivamente cobra", async () => {
    const b = await business({ mercadoPago: true });
    const { confirmation, order, customerEmail, statusToken } = await placeOrder(b, await product(b));
    expect(confirmation.checkoutUrl).toMatch(/^https:\/\/www\.mercadopago\.cl\//);
    expect(confirmation.webpayUrl).toBe(`${env.PUBLIC_SITE_BASE_URL}/pedido/${statusToken}`);
    expect(emailAdapter.messages.find((m) => m.to === customerEmail)?.text).toContain("Mercado Pago o Webpay Plus");

    // Intentó con Webpay, abandonó y terminó pagando con Mercado Pago.
    const token = await startAndPay(statusToken);
    await returnGet(order.id, statusToken, {}).query({ TBK_TOKEN: token }).expect(303);
    const paymentId = mercadoPago.pay(order.id, { collectorId: b.mp.providerUserId });
    const { createHmac } = await import("node:crypto");
    const requestId = unique("req");
    const ts = String(Date.now());
    const signature = `ts=${ts},v1=${createHmac("sha256", WEBHOOK_SECRET).update(`id:${paymentId};request-id:${requestId};ts:${ts};`).digest("hex")}`;
    await request(http)
      .post(`/api/v1/payments/mercadopago/orders/${order.id}/webhook?data.id=${paymentId}&type=payment`)
      .set("x-request-id", requestId)
      .set("x-signature", signature)
      .send({ action: "payment.created", type: "payment", data: { id: paymentId } })
      .expect(200);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "PAID", providerPaymentId: paymentId, paymentProvider: "MERCADO_PAGO" });
  });

  it("un pedido pagado con Webpay no se devuelve por la API de Mercado Pago: se explica dónde hacerlo", async () => {
    const b = await business({ mercadoPago: true });
    const { order, statusToken } = await placeOrder(b, await product(b));
    const token = await startAndPay(statusToken);
    await returnGet(order.id, statusToken, {}).query({ token_ws: token }).expect(303);

    const res = await b.owner.post(`${b.orders}/${order.id}/refund`).set(CSRF).send({}).expect(422);
    expect(JSON.stringify(res.body)).toContain("Transbank");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).refundedAmount).toBe(0);
    // Tampoco se puede «deshacer» un pago confirmado en línea.
    await b.owner.patch(`${b.orders}/${order.id}`).set(CSRF).send({ status: "NEW" }).expect(422);
  });

  it("aislamiento: cada pedido se cobra solo con el comercio de su propio negocio", async () => {
    const a = await business({ commerceCode: "597011111111" });
    const other = await business({ commerceCode: "597022222222" });
    const first = await placeOrder(a, await product(a));
    const second = await placeOrder(other, await product(other));
    await startWebpay(first.statusToken).expect(200);
    await startWebpay(second.statusToken).expect(200);
    expect(webpay.created.find((item) => item.sessionId === first.order.id)?.commerceCode).toBe("597011111111");
    expect(webpay.created.find((item) => item.sessionId === second.order.id)?.commerceCode).toBe("597022222222");

    // El enlace de un pedido no sirve para el pedido de otro negocio.
    await returnGet(second.order.id, first.statusToken, {}).expect(404);

    // Un negocio sin Webpay conectado: sus pedidos no ofrecen Webpay y no se puede iniciar.
    const bare = await business({ webpay: false });
    const bareOrder = await placeOrder(bare, await product(bare));
    expect(bareOrder.confirmation).toMatchObject({ webpayUrl: null, checkoutUrl: null, paymentUrl: "https://pago.ejemplo.cl/torta" });
    expect(bareOrder.order.statusTokenHash).toBeNull();
  });
});
