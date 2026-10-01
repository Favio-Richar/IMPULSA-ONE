import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { orderListResponse, productResponse, publicCatalogResponse, publicOrderConfirmationResponse, type ProductResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";

// F7.8a (ADR-023) — variantes de producto y líneas de pedido: CRUD en el panel, catálogo público,
// pedido que exige variante y descuenta su stock (sin carreras), y cancelar/reabrir por línea.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@variants-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Variantes y líneas de pedido (e2e) — F7.8a", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EMAIL_ADAPTER).useValue(emailAdapter).compile();
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
    if (keys.length > 0) {
      await redis.del(...keys);
    }
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

  async function member(ownerAgent: ReturnType<typeof request.agent>, organizationId: string, role: string) {
    const user = await loggedIn();
    const invite = await ownerAgent.post(`/api/v1/organizations/${organizationId}/members`).set(CSRF).send({ email: user.email, role }).expect(201);
    await user.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
    return user.agent;
  }

  async function setup() {
    const owner = await loggedIn();
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Tienda", slug: unique("org") }).expect(201);
    await assignRoomyPlan(prisma, org.body.id);
    const siteSlug = unique("sitio");
    const site = await owner.agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF).send({ name: "Tienda Lumen", slug: siteSlug }).expect(201);
    return {
      owner: owner.agent,
      organizationId: org.body.id as string,
      catalog: `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/catalog`,
      orders: `/api/v1/organizations/${org.body.id}/orders`,
      publicCatalog: `/api/v1/public/sites/${siteSlug}/catalog`,
    };
  }

  async function polera(agent: ReturnType<typeof request.agent>, catalog: string, extra: Record<string, unknown> = {}) {
    const res = await agent.post(`${catalog}/products`).set(CSRF).send({ name: "Polera", priceAmount: 9990, priceCurrency: "CLP", stock: 50, ...extra }).expect(201);
    return productResponse.strict().parse(res.body);
  }

  async function addVariant(agent: ReturnType<typeof request.agent>, catalog: string, productId: string, body: Record<string, unknown>): Promise<ProductResponse> {
    const res = await agent.post(`${catalog}/products/${productId}/variants`).set(CSRF).send(body).expect(201);
    return productResponse.strict().parse(res.body);
  }

  function orderBody(productId: string, extra: Record<string, unknown> = {}) {
    return { productId, quantity: 1, name: "Ana Pérez", email: `ana.${unique("c")}${TEST_EMAIL_DOMAIN}`, address: "Av. Siempre Viva 742", consent: true, ...extra };
  }

  it("el negocio agrega, edita, ordena y borra variantes; nombre único por producto; tope; ANALYST solo mira; auditoría", async () => {
    const { owner, catalog, organizationId } = await setup();
    const product = await polera(owner, catalog);
    expect(product.variants).toEqual([]);

    let withVariants = await addVariant(owner, catalog, product.id, { name: "M", stock: 2 });
    withVariants = await addVariant(owner, catalog, product.id, { name: "L", priceAmount: 10990, sku: "POL-L" });
    expect(withVariants.variants.map((v) => [v.name, v.priceAmount, v.stock, v.sku, v.position])).toEqual([
      ["M", null, 2, null, 0],
      ["L", 10990, null, "POL-L", 1],
    ]);
    const [m, l] = withVariants.variants;

    // Mismo nombre en el mismo producto: 409; en otro producto, sin problema.
    await owner.post(`${catalog}/products/${product.id}/variants`).set(CSRF).send({ name: "M" }).expect(409);
    const otro = await polera(owner, catalog, { name: "Gorro" });
    await addVariant(owner, catalog, otro.id, { name: "M" });
    // Validación en servidor.
    await owner.post(`${catalog}/products/${product.id}/variants`).set(CSRF).send({ name: "S", stock: -1 }).expect(400);

    const edited = await owner.patch(`${catalog}/products/${product.id}/variants/${l!.id}`).set(CSRF).send({ priceAmount: null, position: 0, stock: 4 }).expect(200);
    expect(edited.body.variants.find((v: { id: string }) => v.id === l!.id)).toMatchObject({ priceAmount: null, stock: 4, position: 0 });
    await owner.patch(`${catalog}/products/${product.id}/variants/${l!.id}`).set(CSRF).send({ name: "M" }).expect(409);
    // Una variante de otro producto no se alcanza por este.
    const otroVariant = (await owner.get(`${catalog}/products`).expect(200)).body.find((p: ProductResponse) => p.id === otro.id).variants[0];
    await owner.patch(`${catalog}/products/${product.id}/variants/${otroVariant.id}`).set(CSRF).send({ name: "X" }).expect(404);

    // El listado del panel trae las variantes en orden.
    const listed = (await owner.get(`${catalog}/products`).expect(200)).body as ProductResponse[];
    expect(listed.find((p) => p.id === product.id)!.variants.map((v) => v.name)).toEqual(["M", "L"]);

    const analyst = await member(owner, organizationId, "ANALYST");
    await analyst.post(`${catalog}/products/${product.id}/variants`).set(CSRF).send({ name: "XL" }).expect(403);
    await analyst.patch(`${catalog}/products/${product.id}/variants/${m!.id}`).set(CSRF).send({ name: "XL" }).expect(403);
    await analyst.delete(`${catalog}/products/${product.id}/variants/${m!.id}`).set(CSRF).expect(403);

    const removed = productResponse.parse((await owner.delete(`${catalog}/products/${product.id}/variants/${m!.id}`).set(CSRF).expect(200)).body);
    expect(removed.variants.map((v) => v.name)).toEqual(["L"]);
    await owner.delete(`${catalog}/products/${product.id}/variants/${m!.id}`).set(CSRF).expect(404);

    // Tope por producto.
    for (let index = 0; index < 29; index += 1) {
      await prisma.productVariant.create({
        data: { organizationId, siteId: product.siteId, productId: product.id, name: `T${index}`, position: index + 1 },
      });
    }
    await owner.post(`${catalog}/products/${product.id}/variants`).set(CSRF).send({ name: "Una más" }).expect(422);

    const actions = (await prisma.auditLog.findMany({ where: { organizationId, action: { startsWith: "catalog.variant_" } } })).map((row) => row.action).sort();
    expect(actions).toEqual([
      "catalog.variant_created",
      "catalog.variant_created",
      "catalog.variant_created",
      "catalog.variant_deleted",
      "catalog.variant_updated",
    ]);
  });

  it("el catálogo público muestra solo variantes activas con su precio resuelto, y la disponibilidad sale de ellas", async () => {
    const { owner, catalog, publicCatalog } = await setup();
    const product = await polera(owner, catalog, { stock: 0 });
    await addVariant(owner, catalog, product.id, { name: "M", stock: 0 });
    await addVariant(owner, catalog, product.id, { name: "L", priceAmount: 10990, stock: 120 });
    await addVariant(owner, catalog, product.id, { name: "XL", active: false });
    const body = publicCatalogResponse.strict().parse((await request(httpServer).get(publicCatalog).expect(200)).body);
    const shown = body.products.find((p) => p.id === product.id)!;
    // El stock 0 del producto no cuenta: hay variantes y una tiene stock.
    expect(shown).toMatchObject({ available: true, maxQuantity: 99 });
    expect(shown.variants.map((v) => [v.name, v.priceAmount, v.available, v.maxQuantity])).toEqual([
      ["M", 9990, false, 0],
      ["L", 10990, true, 99],
    ]);
    expect(JSON.stringify(body)).not.toContain("XL");
    expect(JSON.stringify(body)).not.toContain('"stock"');
  });

  it("un pedido exige una variante activa del mismo producto, usa su precio y descuenta su stock (no el del producto)", async () => {
    const { owner, catalog, publicCatalog, orders } = await setup();
    const product = await polera(owner, catalog, { stock: 50 });
    const sinVariantes = await polera(owner, catalog, { name: "Taza" });
    const otro = await polera(owner, catalog, { name: "Gorro" });
    const withVariants = await addVariant(owner, catalog, product.id, { name: "L", priceAmount: 10990, stock: 3 });
    await addVariant(owner, catalog, product.id, { name: "XL", active: false });
    const l = withVariants.variants[0]!;
    const xl = (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id, name: "XL" } })).id;
    const gorro = (await addVariant(owner, catalog, otro.id, { name: "Único" })).variants[0]!;

    const missing = await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(product.id)).expect(400);
    expect(missing.body.issues).toEqual([{ path: "variantId", message: "Elige una opción del producto." }]);
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(product.id, { variantId: xl })).expect(404);
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(product.id, { variantId: gorro.id })).expect(404);
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(sinVariantes.id, { variantId: l.id })).expect(404);

    const res = await request(httpServer)
      .post(`${publicCatalog}/orders`)
      .set(CSRF)
      .send(orderBody(product.id, { variantId: l.id, quantity: 2, priceAmount: 1 }))
      .expect(201);
    expect(publicOrderConfirmationResponse.strict().parse(res.body)).toMatchObject({ productName: "Polera (L)", unitPriceAmount: 10990, totalAmount: 21980 });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: l.id } })).stock).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(50);

    const listed = orderListResponse.strict().parse((await owner.get(orders).expect(200)).body);
    expect(listed.items[0]).toMatchObject({ productName: "Polera (L)", quantity: 2, totalAmount: 21980 });
    expect(listed.items[0]!.items).toEqual([
      { productId: product.id, variantId: l.id, productName: "Polera", variantName: "L", productKind: "PHYSICAL", unitPriceAmount: 10990, quantity: 2, lineTotalAmount: 21980 },
    ]);
    // El correo al comprador nombra la variante.
    expect(emailAdapter.messages.some((m) => m.text.includes("Polera (L)"))).toBe(true);

    // Sin variantes, un pedido sigue igual que siempre y también guarda su línea.
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(sinVariantes.id)).expect(201);
    const taza = await prisma.order.findFirstOrThrow({ where: { productId: sinVariantes.id }, include: { items: true } });
    expect(taza.items).toMatchObject([{ productName: "Taza", variantName: null, stockSource: "product", quantity: 1 }]);
  });

  it("dos pedidos simultáneos por la última unidad de una variante: uno gana y el stock nunca queda negativo", async () => {
    const { owner, catalog, publicCatalog } = await setup();
    const product = await polera(owner, catalog);
    const variant = (await addVariant(owner, catalog, product.id, { name: "M", stock: 1 })).variants[0]!;
    const results = await Promise.all([1, 2, 3].map(() => request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(product.id, { variantId: variant.id }))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(0);
    expect(await prisma.orderItem.count({ where: { variantId: variant.id } })).toBe(1);
  });

  it("cancelar devuelve el stock a la variante; reabrir lo vuelve a reservar o responde 409; borrar la variante conserva la línea", async () => {
    const { owner, catalog, publicCatalog, orders } = await setup();
    const product = await polera(owner, catalog, { stock: 10 });
    const variant = (await addVariant(owner, catalog, product.id, { name: "M", stock: 2 })).variants[0]!;
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(product.id, { variantId: variant.id, quantity: 2 })).expect(201);
    const order = await prisma.order.findFirstOrThrow({ where: { productId: product.id } });
    const stockOf = async () => (await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock;
    expect(await stockOf()).toBe(0);

    await owner.patch(`${orders}/${order.id}`).set(CSRF).send({ status: "CANCELLED" }).expect(200);
    expect(await stockOf()).toBe(2);
    expect((await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).stockSource).toBeNull();
    await owner.patch(`${orders}/${order.id}`).set(CSRF).send({ status: "NEW" }).expect(200);
    expect(await stockOf()).toBe(0);
    expect((await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).stockSource).toBe("variant");

    // Cancelar, vender lo devuelto y reabrir → 409, sin tocar nada.
    await owner.patch(`${orders}/${order.id}`).set(CSRF).send({ status: "CANCELLED" }).expect(200);
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(product.id, { variantId: variant.id })).expect(201);
    await owner.patch(`${orders}/${order.id}`).set(CSRF).send({ status: "NEW" }).expect(409);
    expect(await stockOf()).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    // El stock del producto nunca se tocó: con variantes, cuenta el de la variante.
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(10);

    // Borrar la variante: el pedido conserva nombre y precio; reabrir no reserva en ningún lado.
    await owner.delete(`${catalog}/products/${product.id}/variants/${variant.id}`).set(CSRF).expect(200);
    const kept = orderListResponse.parse((await owner.get(`${orders}?status=CANCELLED`).expect(200)).body).items[0]!;
    expect(kept.items[0]).toMatchObject({ variantId: null, variantName: "M", productName: "Polera" });
    await owner.patch(`${orders}/${order.id}`).set(CSRF).send({ status: "NEW" }).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(10);
  });
});
