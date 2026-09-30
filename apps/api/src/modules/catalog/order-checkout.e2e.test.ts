import { createHmac, randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { encryptSecret, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { orderListResponse, publicOrderConfirmationResponse, publicOrderStatusResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { FakeMercadoPagoCheckout } from "@impulza/payments";
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
import { ORDER_CHECKOUT } from "./order-checkout.tokens.js";

// F5.9 (ADR-013) — cobro de pedidos con Checkout Pro en la cuenta de Mercado Pago del negocio.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@order-checkout-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const WEBHOOK_SECRET = "clave-de-firma-de-la-app-de-pruebas-0000";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Firma un aviso como Mercado Pago (`x-signature: ts=…,v1=…`). */
function sign(dataId: string, requestId: string, secret = WEBHOOK_SECRET): string {
  const ts = String(Date.now());
  return `ts=${ts},v1=${createHmac("sha256", secret).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex")}`;
}

describe("Cobro de pedidos con Mercado Pago (e2e) — F5.9, ADR-013", () => {
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
      .overrideProvider(ORDER_CHECKOUT)
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

  async function setup(options: { connected?: boolean } = {}) {
    const email = `${unique("owner")}${TEST_EMAIL_DOMAIN}`;
    const owner = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    await owner.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const org = await owner.post("/api/v1/organizations").set(CSRF).send({ name: "Pastelería", slug: unique("org") }).expect(201);
    const organizationId = org.body.id as string;
    await assignRoomyPlan(prisma, organizationId);
    const siteSlug = unique("sitio");
    const site = await owner.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Pastelería Luna", slug: siteSlug }).expect(201);
    const catalog = `/api/v1/organizations/${organizationId}/sites/${site.body.id}/catalog`;

    // La cuenta se conecta por OAuth (probado en F5.8); acá se deja conectada directo en la base.
    const account = { accessToken: `APP_USR-${randomBytes(12).toString("hex")}`, providerUserId: String(Date.now()) + String(Math.floor(Math.random() * 1000)) };
    if (options.connected !== false) {
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
    }
    emailAdapter.messages = [];
    return {
      owner,
      ownerEmail: email,
      organizationId,
      catalog,
      account,
      orders: `/api/v1/organizations/${organizationId}/orders`,
      publicCatalog: `/api/v1/public/sites/${siteSlug}/catalog`,
    };
  }

  async function product(agent: ReturnType<typeof request.agent>, catalog: string, body: Record<string, unknown> = {}) {
    const res = await agent
      .post(`${catalog}/products`)
      .set(CSRF)
      .send({ name: "Torta de chocolate", kind: "SERVICE", priceAmount: 12_990, priceCurrency: "CLP", paymentUrl: "https://pago.ejemplo.cl/torta", ...body })
      .expect(201);
    return res.body.id as string;
  }

  async function placeOrder(publicCatalog: string, productId: string, quantity = 2) {
    const customerEmail = `cliente.${unique("c")}${TEST_EMAIL_DOMAIN}`;
    const res = await request(httpServer)
      .post(`${publicCatalog}/orders`)
      .set(CSRF)
      .send({ productId, quantity, name: "Ana Pérez", email: customerEmail, consent: true })
      .expect(201);
    const confirmation = publicOrderConfirmationResponse.strict().parse(res.body);
    const order = await prisma.order.findFirstOrThrow({ where: { productId, customerEmail }, orderBy: { createdAt: "desc" } });
    const statusToken = /\/pedido\/([A-Za-z0-9_-]+)/.exec(emailAdapter.messages.find((m) => m.to === customerEmail)?.text ?? "")?.[1];
    return { confirmation, order, customerEmail, statusToken };
  }

  function webhook(orderId: string, paymentId: string, signature?: string) {
    const requestId = unique("req");
    return request(httpServer)
      .post(`/api/v1/payments/mercadopago/orders/${orderId}/webhook?data.id=${paymentId}&type=payment`)
      .set("x-request-id", requestId)
      .set("x-signature", signature ?? sign(paymentId, requestId))
      .send({ action: "payment.created", type: "payment", data: { id: paymentId } });
  }

  it("sin cuenta conectada, el pedido sigue con el enlace de pago externo de siempre", async () => {
    const { owner, catalog, publicCatalog } = await setup({ connected: false });
    const productId = await product(owner, catalog);
    const before = checkout.preferences.length;
    const { confirmation, order, statusToken } = await placeOrder(publicCatalog, productId);
    expect(confirmation).toMatchObject({ paymentUrl: "https://pago.ejemplo.cl/torta", checkoutUrl: null });
    expect(checkout.preferences.length).toBe(before);
    expect(order.checkoutPreferenceId).toBeNull();
    expect(statusToken).toBeUndefined();
  });

  it("con cuenta conectada, el pedido crea el cobro a nombre del negocio y el comprador recibe su enlace", async () => {
    const { owner, catalog, publicCatalog, account } = await setup();
    const productId = await product(owner, catalog);
    const { confirmation, order, customerEmail, statusToken } = await placeOrder(publicCatalog, productId);

    expect(confirmation.paymentUrl).toBeNull();
    expect(confirmation.checkoutUrl).toMatch(/^https:\/\/www\.mercadopago\.cl\//);
    const preference = checkout.preferences.find((item) => item.externalReference === order.id)!;
    // El token es el del negocio; el precio, el guardado (nunca el que mande el visitante).
    expect(preference).toMatchObject({ accessToken: account.accessToken, title: "Torta de chocolate", quantity: 2, unitPrice: 12_990, currency: "CLP", payerEmail: customerEmail });
    expect(preference.notificationUrl).toBe(`${env.API_PUBLIC_URL}/api/v1/payments/mercadopago/orders/${order.id}/webhook`);
    expect(preference.backUrl).toBe(`${env.PUBLIC_SITE_BASE_URL}/pedido/${statusToken}`);
    expect(order).toMatchObject({ checkoutPreferenceId: preference.id, checkoutUrl: confirmation.checkoutUrl, providerPaymentId: null, paymentStatus: null });
    // El enlace "Tu pedido" nunca se guarda: solo su hash.
    expect(order.statusTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(order.statusTokenHash).not.toBe(statusToken);
    const toCustomer = emailAdapter.messages.find((m) => m.to === customerEmail)!;
    expect(toCustomer.text).toContain("Mercado Pago");
    expect(toCustomer.text).not.toContain("pago.ejemplo.cl");

    const status = publicOrderStatusResponse.strict().parse((await request(httpServer).get(`/api/v1/public/orders/${statusToken}`).set(CSRF).expect(200)).body);
    expect(status).toMatchObject({ status: "NEW", paymentStatus: null, checkoutUrl: confirmation.checkoutUrl, totalAmount: 25_980, siteName: "Pastelería Luna" });
    expect(JSON.stringify(status)).not.toContain(customerEmail);
    await request(httpServer).get(`/api/v1/public/orders/${randomBytes(32).toString("base64url")}`).set(CSRF).expect(404);
  });

  it("el aviso firmado de un pago aprobado marca el pedido pagado una sola vez y avisa a los dos", async () => {
    const { owner, catalog, publicCatalog, account, orders, ownerEmail, organizationId } = await setup();
    const productId = await product(owner, catalog);
    const { order, customerEmail, statusToken } = await placeOrder(publicCatalog, productId);
    const paymentId = checkout.pay(order.id, { collectorId: account.providerUserId });

    // Sin firma válida no se lee nada.
    await webhook(order.id, paymentId, sign(paymentId, "otro-request")).expect(401);
    await webhook(order.id, paymentId, sign(paymentId, "x", "otra-clave-cualquiera-000000000")).expect(401);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("NEW");

    emailAdapter.messages = [];
    expect((await webhook(order.id, paymentId).expect(200)).body).toEqual({ result: "paid" });
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid).toMatchObject({ status: "PAID", providerPaymentId: paymentId, paymentStatus: "approved" });
    expect(paid.paidAt).not.toBeNull();
    expect(emailAdapter.messages.find((m) => m.to === customerEmail)?.subject).toContain("Recibimos el pago de tu pedido");
    const toOwner = emailAdapter.messages.find((m) => m.to === ownerEmail);
    expect(toOwner?.subject).toContain("Pago recibido");
    expect(toOwner?.text).toContain(paymentId);
    expect(await prisma.auditLog.count({ where: { organizationId, action: "order.paid_online", targetId: order.id } })).toBe(1);

    // Mercado Pago repite el aviso: sin efecto ni correos nuevos.
    emailAdapter.messages = [];
    expect((await webhook(order.id, paymentId).expect(200)).body).toEqual({ result: "unchanged" });
    expect(emailAdapter.messages).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { organizationId, action: "order.paid_online", targetId: order.id } })).toBe(1);

    // El panel lo muestra pagado en línea y no deja "deshacer" el pago.
    const list = orderListResponse.parse((await owner.get(orders).expect(200)).body);
    expect(list.items.find((item) => item.id === order.id)?.onlinePayment).toEqual({ status: "approved", paymentId });
    await owner.patch(`${orders}/${order.id}`).set(CSRF).send({ status: "NEW" }).expect(422);
    await owner.patch(`${orders}/${order.id}`).set(CSRF).send({ status: "DELIVERED" }).expect(200);

    const status = publicOrderStatusResponse.parse((await request(httpServer).get(`/api/v1/public/orders/${statusToken}`).set(CSRF).expect(200)).body);
    expect(status).toMatchObject({ status: "DELIVERED", checkoutUrl: null });
  });

  it("no marca pagado si el monto, la moneda, el pedido o la cuenta receptora no coinciden", async () => {
    const { owner, catalog, publicCatalog, account } = await setup();
    const productId = await product(owner, catalog);
    const { order } = await placeOrder(publicCatalog, productId);
    const other = await placeOrder(publicCatalog, productId, 1);

    const wrongAmount = checkout.pay(order.id, { collectorId: account.providerUserId, amount: 100 });
    const wrongCurrency = checkout.pay(order.id, { collectorId: account.providerUserId, currency: "USD" });
    const wrongCollector = checkout.pay(order.id, { collectorId: "999999" });
    // Pago real del otro pedido, avisado en la URL de este: no lo paga.
    const otherOrderPayment = checkout.pay(other.order.id, { collectorId: account.providerUserId });
    for (const paymentId of [wrongAmount, wrongCurrency, wrongCollector, otherOrderPayment]) {
      expect((await webhook(order.id, paymentId).expect(200)).body).toEqual({ result: "mismatch" });
    }
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "NEW", providerPaymentId: null });
    // Un aviso de otro tipo o con ids inválidos se acepta sin efecto.
    const requestId = unique("req");
    await request(httpServer)
      .post(`/api/v1/payments/mercadopago/orders/${order.id}/webhook?data.id=123&type=merchant_order`)
      .set("x-request-id", requestId)
      .set("x-signature", sign("123", requestId))
      .expect(200, { result: "ignored" });
    await webhook("no-es-un-uuid", "123").expect(200, { result: "ignored" });
  });

  it("aislamiento (ADR-002/013): un pago de la cuenta de otro negocio nunca paga un pedido ajeno", async () => {
    const a = await setup();
    const b = await setup();
    const productA = await product(a.owner, a.catalog);
    const { order: orderA } = await placeOrder(a.publicCatalog, productA);

    // B cobra con su propia cuenta un pago que dice ser del pedido de A.
    const productB = await product(b.owner, b.catalog);
    const { order: orderB } = await placeOrder(b.publicCatalog, productB);
    const paymentOfB = checkout.pay(orderB.id, { collectorId: b.account.providerUserId });
    const forgedForA = checkout.pay(orderB.id, { collectorId: a.account.providerUserId, accessToken: b.account.accessToken });
    for (const paymentId of [paymentOfB, forgedForA]) {
      // El pago se consulta con el token de A: el de otra cuenta no existe para él.
      expect((await webhook(orderA.id, paymentId).expect(200)).body).toEqual({ result: "mismatch" });
    }
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderA.id } })).status).toBe("NEW");
    // El panel de B no ve el pedido de A.
    const listB = orderListResponse.parse((await b.owner.get(b.orders).expect(200)).body);
    expect(listB.items.map((item) => item.id)).not.toContain(orderA.id);
  });

  it("al volver de Mercado Pago con el pago, la página lo confirma sin esperar el aviso; un pago en revisión se informa", async () => {
    const { owner, catalog, publicCatalog, account } = await setup();
    const productId = await product(owner, catalog);
    const { order, statusToken } = await placeOrder(publicCatalog, productId);

    const pending = checkout.pay(order.id, { collectorId: account.providerUserId, status: "in_process" });
    const inReview = publicOrderStatusResponse.parse((await request(httpServer).get(`/api/v1/public/orders/${statusToken}?paymentId=${pending}`).set(CSRF).expect(200)).body);
    expect(inReview).toMatchObject({ status: "NEW", paymentStatus: "in_process" });

    checkout.setStatus(pending, "approved");
    const done = publicOrderStatusResponse.parse((await request(httpServer).get(`/api/v1/public/orders/${statusToken}?paymentId=${pending}`).set(CSRF).expect(200)).body);
    expect(done).toMatchObject({ status: "PAID", paymentStatus: "approved", checkoutUrl: null });
    // El aviso que llega después no repite nada.
    expect((await webhook(order.id, pending).expect(200)).body).toEqual({ result: "unchanged" });
  });

  it("si pagan un pedido cancelado, sigue cancelado y se avisa al negocio para reactivarlo o devolver el dinero", async () => {
    const { owner, catalog, publicCatalog, account, orders, ownerEmail } = await setup();
    const productId = await product(owner, catalog);
    const { order, customerEmail } = await placeOrder(publicCatalog, productId);
    await owner.patch(`${orders}/${order.id}`).set(CSRF).send({ status: "CANCELLED" }).expect(200);
    emailAdapter.messages = [];

    const paymentId = checkout.pay(order.id, { collectorId: account.providerUserId });
    expect((await webhook(order.id, paymentId).expect(200)).body).toEqual({ result: "cancelled_paid" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "CANCELLED", providerPaymentId: paymentId });
    expect(emailAdapter.messages.find((m) => m.to === ownerEmail)?.subject).toContain("pagaron un pedido cancelado");
    expect(emailAdapter.messages.find((m) => m.to === customerEmail)).toBeUndefined();
  });

  it("una moneda que Mercado Pago Chile no cobra, o una falla de Mercado Pago, dejan el pedido con su enlace externo", async () => {
    const { owner, catalog, publicCatalog } = await setup();
    const dollars = await product(owner, catalog, { name: "Curso", priceAmount: 1990, priceCurrency: "USD" });
    const usd = await placeOrder(publicCatalog, dollars, 1);
    expect(usd.confirmation).toMatchObject({ checkoutUrl: null, paymentUrl: "https://pago.ejemplo.cl/torta" });
    expect(usd.order.checkoutPreferenceId).toBeNull();

    const pesos = await product(owner, catalog);
    checkout.failNextPreference = true;
    const failed = await placeOrder(publicCatalog, pesos, 1);
    expect(failed.confirmation).toMatchObject({ checkoutUrl: null, paymentUrl: "https://pago.ejemplo.cl/torta" });
    expect(failed.order).toMatchObject({ status: "NEW", checkoutPreferenceId: null });
  });
});
