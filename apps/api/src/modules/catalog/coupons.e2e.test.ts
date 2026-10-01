import { createHmac, randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { encryptSecret, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { couponResponse, orderListResponse, publicCouponCheckResponse, publicOrderConfirmationResponse } from "@impulza/contracts";
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
import { MERCADO_PAGO_CHECKOUT } from "../payment-accounts/checkout.tokens.js";

// F7.8b (ADR-023) — cupones: administración en el panel, prueba pública del código (respuesta
// uniforme), descuento calculado por el servidor, tope de usos sin carreras y cobro en Mercado Pago
// por el total con descuento.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@coupons-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const WEBHOOK_SECRET = "clave-de-firma-de-la-app-de-pruebas-0000";
const INVALID = { statusCode: 422, error: "Unprocessable Entity", code: "COUPON_INVALID", message: "Ese código no es válido.", issues: [{ path: "couponCode", message: "Ese código no es válido." }] };

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sign(dataId: string, requestId: string): string {
  const ts = String(Date.now());
  return `ts=${ts},v1=${createHmac("sha256", WEBHOOK_SECRET).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex")}`;
}

describe("Cupones (e2e) — F7.8b", () => {
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

  async function setup(options: { connected?: boolean } = {}) {
    const owner = await loggedIn();
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Tienda", slug: unique("org") }).expect(201);
    const organizationId = org.body.id as string;
    await assignRoomyPlan(prisma, organizationId);
    const siteSlug = unique("sitio");
    const site = await owner.agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Tienda Lumen", slug: siteSlug }).expect(201);
    const account = { accessToken: `APP_USR-${randomBytes(12).toString("hex")}`, providerUserId: String(Date.now()) + String(Math.floor(Math.random() * 1000)) };
    if (options.connected) {
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
    const catalog = `/api/v1/organizations/${organizationId}/sites/${site.body.id}/catalog`;
    const product = await owner.agent
      .post(`${catalog}/products`)
      .set(CSRF)
      .send({ name: "Vela", kind: "SERVICE", priceAmount: 10_000, priceCurrency: "CLP", stock: 10, paymentUrl: "https://pago.ejemplo.cl/vela" })
      .expect(201);
    return {
      owner: owner.agent,
      organizationId,
      siteId: site.body.id as string,
      account,
      productId: product.body.id as string,
      coupons: `/api/v1/organizations/${organizationId}/sites/${site.body.id}/coupons`,
      orders: `/api/v1/organizations/${organizationId}/orders`,
      publicCatalog: `/api/v1/public/sites/${siteSlug}/catalog`,
    };
  }

  function orderBody(productId: string, extra: Record<string, unknown> = {}) {
    return { productId, quantity: 2, name: "Ana Pérez", email: `ana.${unique("c")}${TEST_EMAIL_DOMAIN}`, consent: true, ...extra };
  }

  it("el negocio crea, edita, pausa y borra cupones; reglas y código único en el servidor; ANALYST solo mira; auditoría", async () => {
    const { owner, coupons, organizationId } = await setup();
    const created = couponResponse.strict().parse((await owner.post(coupons).set(CSRF).send({ code: "dia10", kind: "percent", percentOff: 10, maxRedemptions: 5 }).expect(201)).body);
    expect(created).toMatchObject({ code: "DIA10", kind: "percent", percentOff: 10, status: "active", redemptionCount: 0, discountGiven: [] });

    await owner.post(coupons).set(CSRF).send({ code: "DIA10", kind: "percent", percentOff: 20 }).expect(409);
    await owner.post(coupons).set(CSRF).send({ code: "MIL", kind: "fixed", amountOff: 1000 }).expect(400);
    await owner.post(coupons).set(CSRF).send({ code: "X Y", kind: "percent", percentOff: 5 }).expect(400);

    // Editar combina con lo guardado: pasar a monto fijo sin moneda es incoherente (422).
    const incoherent = await owner.patch(`${coupons}/${created.id}`).set(CSRF).send({ kind: "fixed", amountOff: 2000 }).expect(422);
    expect(incoherent.body.issues).toEqual([{ path: "currency", message: "Elige la moneda del descuento." }]);
    const fixed = couponResponse.parse((await owner.patch(`${coupons}/${created.id}`).set(CSRF).send({ kind: "fixed", amountOff: 2000, currency: "CLP" }).expect(200)).body);
    expect(fixed).toMatchObject({ kind: "fixed", amountOff: 2000, percentOff: null, currency: "CLP" });
    const paused = couponResponse.parse((await owner.patch(`${coupons}/${created.id}`).set(CSRF).send({ active: false }).expect(200)).body);
    expect(paused.status).toBe("paused");
    // El tope no puede quedar bajo los usos.
    await prisma.coupon.update({ where: { id: created.id }, data: { redemptionCount: 3 } });
    await owner.patch(`${coupons}/${created.id}`).set(CSRF).send({ maxRedemptions: 2 }).expect(422);

    const analyst = await loggedIn();
    const invite = await owner.post(`/api/v1/organizations/${organizationId}/members`).set(CSRF).send({ email: analyst.email, role: "ANALYST" }).expect(201);
    await analyst.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
    await analyst.agent.get(coupons).expect(200);
    await analyst.agent.post(coupons).set(CSRF).send({ code: "NO", kind: "percent", percentOff: 5 }).expect(403);
    await analyst.agent.patch(`${coupons}/${created.id}`).set(CSRF).send({ active: true }).expect(403);
    await analyst.agent.delete(`${coupons}/${created.id}`).set(CSRF).expect(403);

    await owner.delete(`${coupons}/${created.id}`).set(CSRF).expect(204);
    expect((await owner.get(coupons).expect(200)).body).toEqual([]);
    const actions = (await prisma.auditLog.findMany({ where: { organizationId, action: { startsWith: "coupon." } } })).map((row) => row.action).sort();
    expect(actions).toEqual(["coupon.created", "coupon.deleted", "coupon.updated", "coupon.updated"]);
  });

  it("probar un código: calcula el descuento sin contar un uso, y cualquier código que no aplica recibe la misma respuesta", async () => {
    const { owner, coupons, productId, publicCatalog } = await setup();
    const now = Date.now();
    await owner.post(coupons).set(CSRF).send({ code: "QUINCE", kind: "percent", percentOff: 15 }).expect(201);
    await owner.post(coupons).set(CSRF).send({ code: "PAUSADO", kind: "percent", percentOff: 15, active: false }).expect(201);
    await owner.post(coupons).set(CSRF).send({ code: "VENCIDO", kind: "percent", percentOff: 15, endsAt: new Date(now - 60_000).toISOString() }).expect(201);
    await owner.post(coupons).set(CSRF).send({ code: "FUTURO", kind: "percent", percentOff: 15, startsAt: new Date(now + 3_600_000).toISOString() }).expect(201);
    await owner.post(coupons).set(CSRF).send({ code: "DOLARES", kind: "fixed", amountOff: 500, currency: "USD" }).expect(201);
    await owner.post(coupons).set(CSRF).send({ code: "MINIMO", kind: "percent", percentOff: 15, minSubtotal: 50_000, currency: "CLP" }).expect(201);
    const agotado = await owner.post(coupons).set(CSRF).send({ code: "AGOTADO", kind: "percent", percentOff: 15, maxRedemptions: 1 }).expect(201);
    await prisma.coupon.update({ where: { id: agotado.body.id }, data: { redemptionCount: 1 } });

    const ok = await request(httpServer).post(`${publicCatalog}/coupons/check`).set(CSRF).send({ code: " quince ", productId, quantity: 2 }).expect(200);
    expect(publicCouponCheckResponse.strict().parse(ok.body)).toEqual({ code: "QUINCE", subtotalAmount: 20_000, discountAmount: 3_000, totalAmount: 17_000, priceCurrency: "CLP" });
    expect((await prisma.coupon.findFirstOrThrow({ where: { code: "QUINCE", siteId: (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).siteId } })).redemptionCount).toBe(0);

    for (const code of ["NOEXISTE", "PAUSADO", "VENCIDO", "FUTURO", "DOLARES", "MINIMO", "AGOTADO", "x"]) {
      const res = await request(httpServer).post(`${publicCatalog}/coupons/check`).set(CSRF).send({ code, productId, quantity: 2 });
      expect({ code, status: res.status, body: res.body }).toEqual({ code, status: 422, body: INVALID });
      await redis.del(...(await redis.keys("ratelimit:*")));
    }
  });

  it("un pedido con cupón cobra el total con descuento en Mercado Pago, cuenta el uso y avisa el descuento", async () => {
    const b = await setup({ connected: true });
    await b.owner.post(b.coupons).set(CSRF).send({ code: "MILPESOS", kind: "fixed", amountOff: 1_000, currency: "CLP" }).expect(201);
    const email = `ana.${unique("c")}${TEST_EMAIL_DOMAIN}`;
    const res = await request(httpServer)
      .post(`${b.publicCatalog}/orders`)
      .set(CSRF)
      .send(orderBody(b.productId, { couponCode: "milpesos", email, discountAmount: 19_999, totalAmount: 1 }))
      .expect(201);
    const confirmation = publicOrderConfirmationResponse.strict().parse(res.body);
    expect(confirmation).toMatchObject({ unitPriceAmount: 10_000, quantity: 2, discountAmount: 1_000, couponCode: "MILPESOS", totalAmount: 19_000, paymentUrl: null });
    expect(confirmation.checkoutUrl).toContain("mercadopago");

    const order = await prisma.order.findFirstOrThrow({ where: { customerEmail: email } });
    expect(order).toMatchObject({ totalAmount: 19_000, discountAmount: 1_000, couponCode: "MILPESOS" });
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: order.couponId! } })).redemptionCount).toBe(1);

    // Mercado Pago cobra un solo ítem por el total con descuento.
    const preference = checkout.preferences.find((item) => item.externalReference === order.id)!;
    expect(preference).toMatchObject({ quantity: 1, unitPrice: 19_000, title: "Vela (cupón MILPESOS)" });
    const paymentId = checkout.pay(order.id, { collectorId: b.account.providerUserId });
    const requestId = unique("req");
    await request(httpServer)
      .post(`/api/v1/payments/mercadopago/orders/${order.id}/webhook?data.id=${paymentId}&type=payment`)
      .set("x-request-id", requestId)
      .set("x-signature", sign(paymentId, requestId))
      .send({ type: "payment" })
      .expect(200, { result: "paid" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");

    expect(emailAdapter.messages.find((m) => m.to === email)?.text).toContain("Descuento (MILPESOS): −$1.000\nTotal: $19.000");
    const listed = orderListResponse.strict().parse((await b.owner.get(b.orders).expect(200)).body);
    expect(listed.items[0]).toMatchObject({ discountAmount: 1_000, couponCode: "MILPESOS", totalAmount: 19_000 });

    // Un código que no aplica no hace el pedido (ni descuenta stock).
    const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: b.productId } })).stock;
    const rejected = await request(httpServer).post(`${b.publicCatalog}/orders`).set(CSRF).send(orderBody(b.productId, { couponCode: "NOEXISTE" })).expect(422);
    expect(rejected.body).toEqual(INVALID);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: b.productId } })).stock).toBe(stockBefore);
  });

  it("el último uso de un cupón, pedido tres veces a la vez: un solo pedido con descuento y el stock baja una sola vez", async () => {
    const b = await setup();
    const coupon = await b.owner.post(b.coupons).set(CSRF).send({ code: "UNAVEZ", kind: "percent", percentOff: 50, maxRedemptions: 1 }).expect(201);
    const results = await Promise.all([1, 2, 3].map(() => request(httpServer).post(`${b.publicCatalog}/orders`).set(CSRF).send(orderBody(b.productId, { couponCode: "UNAVEZ", quantity: 1 }))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 422, 422]);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.body.id } })).redemptionCount).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: b.productId } })).stock).toBe(9);
    expect(await prisma.order.count({ where: { couponId: coupon.body.id } })).toBe(1);
  });

  it("un cupón del 100 % deja el pedido gratis, sin cobro en línea ni enlace de pago; el descuento entregado excluye cancelados", async () => {
    const b = await setup({ connected: true });
    const coupon = await b.owner.post(b.coupons).set(CSRF).send({ code: "GRATIS", kind: "percent", percentOff: 100 }).expect(201);
    const preferencesBefore = checkout.preferences.length;
    const res = await request(httpServer).post(`${b.publicCatalog}/orders`).set(CSRF).send(orderBody(b.productId, { couponCode: "GRATIS" })).expect(201);
    expect(res.body).toMatchObject({ totalAmount: 0, discountAmount: 20_000, paymentUrl: null, checkoutUrl: null });
    expect(checkout.preferences.length).toBe(preferencesBefore);

    await request(httpServer).post(`${b.publicCatalog}/orders`).set(CSRF).send(orderBody(b.productId, { couponCode: "GRATIS", quantity: 1 })).expect(201);
    const second = await prisma.order.findFirstOrThrow({ where: { couponId: coupon.body.id, quantity: 1 } });
    await b.owner.patch(`${b.orders}/${second.id}`).set(CSRF).send({ status: "CANCELLED" }).expect(200);
    const listed = couponResponse.parse((await b.owner.get(b.coupons).expect(200)).body[0]);
    expect(listed).toMatchObject({ redemptionCount: 2, discountGiven: [{ currency: "CLP", amount: 20_000 }] });

    // Borrar el cupón conserva el código y el descuento en los pedidos.
    await b.owner.delete(`${b.coupons}/${coupon.body.id}`).set(CSRF).expect(204);
    const kept = await prisma.order.findMany({ where: { couponCode: "GRATIS", siteId: b.siteId } });
    expect(kept.map((order) => [order.couponId, order.discountAmount]).sort()).toEqual([
      [null, 10_000],
      [null, 20_000],
    ]);
  });
});
