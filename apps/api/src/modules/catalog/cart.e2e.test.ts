import { createHmac, randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { encryptSecret, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { orderListResponse, publicCouponCheckResponse, publicOrderConfirmationResponse } from "@impulza/contracts";
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

// F7.8c (ADR-023) — carrito: varias líneas en un pedido, todo recalculado en el servidor, stock y
// cupón todo o nada, una moneda, un digital solo, cobro en Mercado Pago por el total y cancelar o
// reabrir por línea.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@cart-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const WEBHOOK_SECRET = "clave-de-firma-de-la-app-de-pruebas-0000";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sign(dataId: string, requestId: string): string {
  const ts = String(Date.now());
  return `ts=${ts},v1=${createHmac("sha256", WEBHOOK_SECRET).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex")}`;
}

describe("Carrito (e2e) — F7.8c", () => {
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

  async function setup(options: { connected?: boolean } = {}) {
    const email = `${unique("owner")}${TEST_EMAIL_DOMAIN}`;
    const owner = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    await owner.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const org = await owner.post("/api/v1/organizations").set(CSRF).send({ name: "Tienda", slug: unique("org") }).expect(201);
    const organizationId = org.body.id as string;
    await assignRoomyPlan(prisma, organizationId);
    const siteSlug = unique("sitio");
    const site = await owner.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Tienda Lumen", slug: siteSlug }).expect(201);
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
    const product = async (body: Record<string, unknown>) =>
      (await owner.post(`${catalog}/products`).set(CSRF).send({ priceCurrency: "CLP", kind: "PHYSICAL", ...body }).expect(201)).body as { id: string };
    const polera = await product({ name: "Polera", priceAmount: 10_000 });
    const variants = await owner.post(`${catalog}/products/${polera.id}/variants`).set(CSRF).send({ name: "M", stock: 3 }).expect(201);
    const taza = await product({ name: "Taza", priceAmount: 5_000, stock: 2 });
    const taller = await product({ name: "Taller", kind: "SERVICE", priceAmount: 20_000 });
    emailAdapter.messages = [];
    return {
      owner,
      organizationId,
      account,
      siteId: site.body.id as string,
      catalog,
      product,
      polera: polera.id,
      poleraM: variants.body.variants[0].id as string,
      taza: taza.id,
      taller: taller.id,
      orders: `/api/v1/organizations/${organizationId}/orders`,
      coupons: `/api/v1/organizations/${organizationId}/sites/${site.body.id}/coupons`,
      cart: `/api/v1/public/sites/${siteSlug}/catalog/cart`,
    };
  }

  const customer = () => ({ name: "Ana Pérez", email: `ana.${unique("c")}${TEST_EMAIL_DOMAIN}`, address: "Av. Siempre Viva 742", consent: true });

  it("un pedido de varias líneas: precios del servidor, stock de cada línea, resumen, correo detallado y cobro por el total", async () => {
    const b = await setup({ connected: true });
    const buyer = customer();
    const res = await request(httpServer)
      .post(`${b.cart}/orders`)
      .set(CSRF)
      .send({
        ...buyer,
        lines: [
          { productId: b.polera, variantId: b.poleraM, quantity: 2, priceAmount: 1 },
          { productId: b.taza, quantity: 1 },
          { productId: b.taller, quantity: 1 },
        ],
      })
      .expect(201);
    const confirmation = publicOrderConfirmationResponse.strict().parse(res.body);
    expect(confirmation).toMatchObject({ productName: "Polera (M) y 2 productos más", quantity: 1, unitPriceAmount: 45_000, totalAmount: 45_000, paymentUrl: null });
    expect(confirmation.checkoutUrl).toContain("mercadopago");

    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: b.poleraM } })).stock).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: b.taza } })).stock).toBe(1);

    const listed = orderListResponse.strict().parse((await b.owner.get(b.orders).expect(200)).body);
    const order = listed.items[0]!;
    expect(order).toMatchObject({ productId: null, productKind: "PHYSICAL", deliveryAddress: "Av. Siempre Viva 742" });
    expect(order.items.map((item) => [item.productName, item.variantName, item.quantity, item.lineTotalAmount])).toEqual([
      ["Polera", "M", 2, 20_000],
      ["Taza", null, 1, 5_000],
      ["Taller", null, 1, 20_000],
    ]);

    const toCustomer = emailAdapter.messages.find((m) => m.to === buyer.email.toLowerCase())!;
    expect(toCustomer.text).toContain("2 × Polera (M): $20.000\n1 × Taza: $5.000\n1 × Taller: $20.000\nTotal: $45.000");

    const preference = checkout.preferences.find((item) => item.externalReference === order.id)!;
    expect(preference).toMatchObject({ quantity: 1, unitPrice: 45_000, title: "Polera (M) y 2 productos más" });
    const paymentId = checkout.pay(order.id, { collectorId: b.account.providerUserId });
    const requestId = unique("req");
    await request(httpServer)
      .post(`/api/v1/payments/mercadopago/orders/${order.id}/webhook?data.id=${paymentId}&type=payment`)
      .set("x-request-id", requestId)
      .set("x-signature", sign(paymentId, requestId))
      .send({ type: "payment" })
      .expect(200, { result: "paid" });
    // Un evento por pedido, sin producto como sujeto (son varios).
    const event = await prisma.analyticsEvent.findFirst({ where: { siteId: b.siteId, idempotencyKey: `order_created:${order.id}` } });
    expect(event?.subjectId ?? null).toBeNull();
  });

  it("todo o nada: si una línea no tiene stock, no se reserva nada ni se usa el cupón, y el mensaje nombra la línea", async () => {
    const b = await setup();
    const coupon = await b.owner.post(b.coupons).set(CSRF).send({ code: "DIEZ", kind: "percent", percentOff: 10 }).expect(201);
    const res = await request(httpServer)
      .post(`${b.cart}/orders`)
      .set(CSRF)
      .send({ ...customer(), couponCode: "DIEZ", lines: [{ productId: b.polera, variantId: b.poleraM, quantity: 1 }, { productId: b.taza, quantity: 3 }] })
      .expect(409);
    expect(res.body.message).toBe("No quedan suficientes unidades de Taza.");
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: b.poleraM } })).stock).toBe(3);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: b.taza } })).stock).toBe(2);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.body.id } })).redemptionCount).toBe(0);
    expect(await prisma.order.count({ where: { siteId: b.siteId } })).toBe(0);
  });

  it("reglas del servidor: una moneda, un digital solo, sin líneas repetidas, dirección si algo se entrega, productos del mismo sitio", async () => {
    const b = await setup();
    const dolares = await b.product({ name: "Curso", kind: "SERVICE", priceAmount: 1_000, priceCurrency: "USD" });
    const ebook = await b.product({ name: "Guía", kind: "DIGITAL", priceAmount: 3_000 });
    const send = (body: Record<string, unknown>) => request(httpServer).post(`${b.cart}/orders`).set(CSRF).send({ ...customer(), ...body });

    const mixed = await send({ lines: [{ productId: b.taller, quantity: 1 }, { productId: dolares.id, quantity: 1 }] }).expect(400);
    expect(mixed.body.issues).toEqual([{ path: "lines", message: "Tu carrito tiene productos con monedas distintas: pídelos por separado." }]);
    const digital = await send({ lines: [{ productId: b.taller, quantity: 1 }, { productId: ebook.id, quantity: 1 }] }).expect(400);
    expect(digital.body.issues[0].message).toContain("Un producto digital se compra solo");
    await send({ lines: [{ productId: ebook.id, quantity: 1 }] }).expect(201);
    await send({ lines: [{ productId: b.taza, quantity: 1 }, { productId: b.taza, quantity: 1 }] }).expect(400);
    const noAddress = await send({ address: undefined, lines: [{ productId: b.taller, quantity: 1 }, { productId: b.taza, quantity: 1 }] }).expect(400);
    expect(noAddress.body.issues).toEqual([{ path: "address", message: "Escribe la dirección de entrega." }]);
    // Solo servicios: no pide dirección.
    await send({ address: undefined, lines: [{ productId: b.taller, quantity: 1 }] }).expect(201);
    // La variante sigue siendo obligatoria en el carrito.
    await send({ lines: [{ productId: b.polera, quantity: 1 }] }).expect(400);

    // Un producto de otro sitio (de la misma organización) no se pide por este.
    const other = await b.owner.post(`/api/v1/organizations/${b.organizationId}/sites`).set(CSRF).send({ name: "Otro", slug: unique("otro") }).expect(201);
    const foreign = await b.owner
      .post(`/api/v1/organizations/${b.organizationId}/sites/${other.body.id}/catalog/products`)
      .set(CSRF)
      .send({ name: "Ajeno", priceAmount: 1_000, priceCurrency: "CLP" })
      .expect(201);
    await send({ lines: [{ productId: b.taller, quantity: 1 }, { productId: foreign.body.id, quantity: 1 }] }).expect(404);
  });

  it("el cupón va sobre el subtotal del carrito (mínimo incluido) y el cobro es por el total con descuento", async () => {
    const b = await setup();
    await b.owner.post(b.coupons).set(CSRF).send({ code: "GRANDE", kind: "fixed", amountOff: 5_000, currency: "CLP", minSubtotal: 30_000 }).expect(201);
    const lines = [
      { productId: b.taller, quantity: 1 },
      { productId: b.taza, quantity: 2 },
    ];
    const check = await request(httpServer).post(`${b.cart}/coupons/check`).set(CSRF).send({ code: "grande", lines }).expect(200);
    expect(publicCouponCheckResponse.strict().parse(check.body)).toEqual({ code: "GRANDE", subtotalAmount: 30_000, discountAmount: 5_000, totalAmount: 25_000, priceCurrency: "CLP" });
    // Bajo el mínimo (solo el taller): no aplica.
    await request(httpServer).post(`${b.cart}/coupons/check`).set(CSRF).send({ code: "GRANDE", lines: [{ productId: b.taller, quantity: 1 }] }).expect(422);

    const res = await request(httpServer).post(`${b.cart}/orders`).set(CSRF).send({ ...customer(), couponCode: "GRANDE", lines }).expect(201);
    expect(res.body).toMatchObject({ unitPriceAmount: 30_000, quantity: 1, discountAmount: 5_000, totalAmount: 25_000, couponCode: "GRANDE" });
  });

  it("cancelar devuelve el stock de cada línea; reabrir reserva todas o ninguna", async () => {
    const b = await setup();
    await request(httpServer)
      .post(`${b.cart}/orders`)
      .set(CSRF)
      .send({ ...customer(), lines: [{ productId: b.polera, variantId: b.poleraM, quantity: 2 }, { productId: b.taza, quantity: 2 }] })
      .expect(201);
    const order = await prisma.order.findFirstOrThrow({ where: { siteId: b.siteId } });
    const stock = async () => [
      (await prisma.productVariant.findUniqueOrThrow({ where: { id: b.poleraM } })).stock,
      (await prisma.product.findUniqueOrThrow({ where: { id: b.taza } })).stock,
    ];
    expect(await stock()).toEqual([1, 0]);
    await b.owner.patch(`${b.orders}/${order.id}`).set(CSRF).send({ status: "CANCELLED" }).expect(200);
    expect(await stock()).toEqual([3, 2]);

    // Se vende una taza: reabrir necesita 2 → 409 y no reserva la polera.
    await request(httpServer).post(`${b.cart}/orders`).set(CSRF).send({ ...customer(), lines: [{ productId: b.taza, quantity: 1 }] }).expect(201);
    await b.owner.patch(`${b.orders}/${order.id}`).set(CSRF).send({ status: "NEW" }).expect(409);
    expect(await stock()).toEqual([3, 1]);
    await prisma.product.update({ where: { id: b.taza }, data: { stock: 5 } });
    await b.owner.patch(`${b.orders}/${order.id}`).set(CSRF).send({ status: "NEW" }).expect(200);
    expect(await stock()).toEqual([1, 3]);
  });
});
