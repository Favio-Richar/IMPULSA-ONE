import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { orderListResponse, orderResponse, productResponse, publicCatalogResponse, publicOrderConfirmationResponse } from "@impulza/contracts";
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

// F5.5 — catálogo (productos, categorías, stock) y pedidos (página pública y panel).

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@catalog-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Catálogo y pedidos (e2e) — F5.5", () => {
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
    const catalog = `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/catalog`;
    return {
      owner: owner.agent,
      ownerEmail: owner.email,
      organizationId: org.body.id as string,
      siteId: site.body.id as string,
      siteSlug,
      catalog,
      orders: `/api/v1/organizations/${org.body.id}/orders`,
      publicCatalog: `/api/v1/public/sites/${siteSlug}/catalog`,
    };
  }

  async function product(agent: ReturnType<typeof request.agent>, catalog: string, body: Record<string, unknown>) {
    const res = await agent
      .post(`${catalog}/products`)
      .set(CSRF)
      .send({ name: "Vela de soya", priceAmount: 7990, priceCurrency: "CLP", paymentUrl: "https://pago.ejemplo.cl/vela", ...body })
      .expect(201);
    return productResponse.strict().parse(res.body);
  }

  function orderBody(productId: string, extra: Record<string, unknown> = {}) {
    return { productId, quantity: 1, name: "Ana Pérez", email: `Ana.${unique("c")}${TEST_EMAIL_DOMAIN}`, address: "Av. Siempre Viva 742", consent: true, ...extra };
  }

  it("el negocio arma su catálogo: categorías, productos, edición y borrado; un ANALYST solo mira", async () => {
    const { owner, catalog, organizationId } = await setup();
    const category = await owner.post(`${catalog}/categories`).set(CSRF).send({ name: "Velas" }).expect(201);
    const created = await product(owner, catalog, { categoryId: category.body.id, stock: 3, image: { url: "https://cdn.ejemplo.cl/vela.webp", alt: "Vela encendida" } });
    expect(created).toMatchObject({ kind: "PHYSICAL", stock: 3, categoryId: category.body.id, image: { alt: "Vela encendida" } });

    // Imagen sin texto alternativo: la regla de escritura la rechaza (PP2).
    await owner.post(`${catalog}/products`).set(CSRF).send({ name: "Sin alt", priceAmount: 1, priceCurrency: "CLP", image: { url: "https://cdn.ejemplo.cl/x.webp", alt: " " } }).expect(422);

    const edited = await owner.patch(`${catalog}/products/${created.id}`).set(CSRF).send({ stock: null, image: null, priceAmount: 8990 }).expect(200);
    expect(edited.body).toMatchObject({ stock: null, image: null, priceAmount: 8990 });

    // Borrar la categoría deja el producto sin categoría.
    await owner.delete(`${catalog}/categories/${category.body.id}`).set(CSRF).expect(204);
    const list = await owner.get(`${catalog}/products`).expect(200);
    expect(list.body[0].categoryId).toBeNull();

    const analyst = await member(owner, organizationId, "ANALYST");
    await analyst.get(`${catalog}/products`).expect(200);
    await analyst.post(`${catalog}/products`).set(CSRF).send({ name: "No", priceAmount: 1, priceCurrency: "CLP" }).expect(403);
    await analyst.patch(`${catalog}/products/${created.id}`).set(CSRF).send({ name: "No" }).expect(403);
    await analyst.delete(`${catalog}/products/${created.id}`).set(CSRF).expect(403);

    await owner.delete(`${catalog}/products/${created.id}`).set(CSRF).expect(204);
    expect((await owner.get(`${catalog}/products`).expect(200)).body).toEqual([]);
  });

  it("el catálogo público muestra solo productos activos, sin enlace de pago ni stock exacto", async () => {
    const { owner, catalog, publicCatalog } = await setup();
    await product(owner, catalog, { stock: 2 });
    await product(owner, catalog, { name: "Agotado", stock: 0 });
    await product(owner, catalog, { name: "Pausado", active: false });
    const body = publicCatalogResponse.strict().parse((await request(httpServer).get(publicCatalog).expect(200)).body);
    expect(body.products.map((p) => p.name)).toEqual(["Vela de soya", "Agotado"]);
    expect(body.products[0]).toMatchObject({ available: true, maxQuantity: 2 });
    expect(body.products[1]).toMatchObject({ available: false, maxQuantity: 0 });
    expect(JSON.stringify(body)).not.toContain("pago.ejemplo.cl");
    await request(httpServer).get(`/api/v1/public/sites/${unique("no-existe")}/catalog`).expect(404);
  });

  it("un pedido público usa el precio guardado, descuenta stock, crea el contacto y avisa por correo", async () => {
    const { owner, catalog, publicCatalog, organizationId, ownerEmail } = await setup();
    const vela = await product(owner, catalog, { stock: 3 });
    const email = `Compra.${unique("c")}${TEST_EMAIL_DOMAIN}`;
    const res = await request(httpServer)
      .post(`${publicCatalog}/orders`)
      .set(CSRF)
      .send(orderBody(vela.id, { quantity: 2, email, priceAmount: 1, totalAmount: 2 }))
      .expect(201);
    const confirmation = publicOrderConfirmationResponse.strict().parse(res.body);
    expect(confirmation).toEqual({ productName: "Vela de soya", quantity: 2, unitPriceAmount: 7990, totalAmount: 15980, priceCurrency: "CLP", paymentUrl: "https://pago.ejemplo.cl/vela", checkoutUrl: null });

    expect((await prisma.product.findUniqueOrThrow({ where: { id: vela.id } })).stock).toBe(1);
    const order = await prisma.order.findFirstOrThrow({ where: { productId: vela.id } });
    expect(order).toMatchObject({ status: "NEW", stockReserved: true, totalAmount: 15980, customerEmail: email.toLowerCase(), deliveryAddress: "Av. Siempre Viva 742" });
    const contact = await prisma.contact.findFirstOrThrow({ where: { organizationId, email: email.toLowerCase() } });
    expect(contact.consentStatus).toBe("GRANTED");
    expect(order.contactId).toBe(contact.id);
    expect(await prisma.contactEvent.count({ where: { contactId: contact.id, type: "PURCHASE" } })).toBe(1);

    const toCustomer = emailAdapter.messages.find((m) => m.to === email.toLowerCase());
    expect(toCustomer?.text).toContain("Total: $15.980");
    expect(toCustomer?.text).toContain("https://pago.ejemplo.cl/vela");
    const toOwner = emailAdapter.messages.find((m) => m.to === ownerEmail && m.subject.startsWith("Nuevo pedido"));
    expect(toOwner?.subject).toContain("Nuevo pedido: 2 × Vela de soya");
  });

  it("valida en el servidor: dirección para productos físicos, consentimiento, producto pausado y stock", async () => {
    const { owner, catalog, publicCatalog } = await setup();
    const vela = await product(owner, catalog, { stock: 1 });
    const ebook = await product(owner, catalog, { name: "Guía PDF", kind: "DIGITAL" });
    const pausado = await product(owner, catalog, { name: "Pausado", active: false });

    const noAddress = await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(vela.id, { address: undefined })).expect(400);
    expect(noAddress.body.issues).toEqual([{ path: "address", message: "Escribe la dirección de entrega." }]);
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(vela.id, { consent: false })).expect(400);
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(pausado.id)).expect(404);
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(vela.id, { quantity: 2 })).expect(409);
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(ebook.id, { address: undefined })).expect(201);
    // Un producto digital no guarda dirección aunque el visitante la mande.
    expect((await prisma.order.findFirstOrThrow({ where: { productId: ebook.id } })).deliveryAddress).toBeNull();
    await request(httpServer).post(`${publicCatalog}/orders`).send(orderBody(vela.id)).expect(403);
  });

  it("dos pedidos simultáneos por la última unidad: uno gana, el otro recibe 409 y el stock nunca queda negativo", async () => {
    const { owner, catalog, publicCatalog } = await setup();
    const vela = await product(owner, catalog, { stock: 1 });
    const results = await Promise.all([1, 2, 3].map(() => request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(vela.id))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: vela.id } })).stock).toBe(0);
    expect(await prisma.order.count({ where: { productId: vela.id } })).toBe(1);
  });

  it("el campo trampa responde como éxito sin guardar ni descontar", async () => {
    const { owner, catalog, publicCatalog } = await setup();
    const vela = await product(owner, catalog, { stock: 5 });
    emailAdapter.messages = [];
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(vela.id, { website: "http://spam" })).expect(201);
    expect(await prisma.order.count({ where: { productId: vela.id } })).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: vela.id } })).stock).toBe(5);
    expect(emailAdapter.messages).toEqual([]);
  });

  it("el panel lista y avanza pedidos: pagado y entregado a mano, cancelar devuelve stock, reabrir lo vuelve a reservar", async () => {
    const { owner, catalog, publicCatalog, orders, organizationId } = await setup();
    const vela = await product(owner, catalog, { stock: 2 });
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(vela.id)).expect(201);
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(vela.id)).expect(201);
    const listed = orderListResponse.strict().parse((await owner.get(orders).expect(200)).body);
    expect(listed.total).toBe(2);
    expect(listed.counts).toEqual({ NEW: 2, PAID: 0, DELIVERED: 0, CANCELLED: 0 });
    const first = listed.items[0]!;
    const second = listed.items[1]!;

    const paid = orderResponse.parse((await owner.patch(`${orders}/${first.id}`).set(CSRF).send({ status: "PAID" }).expect(200)).body);
    expect(paid.paidAt).not.toBeNull();
    expect(emailAdapter.messages.at(-1)?.subject).toContain("Confirmamos el pago");
    const delivered = await owner.patch(`${orders}/${first.id}`).set(CSRF).send({ status: "DELIVERED" }).expect(200);
    expect(delivered.body.deliveredAt).not.toBeNull();
    // Entregado no se reabre ni se cancela.
    await owner.patch(`${orders}/${first.id}`).set(CSRF).send({ status: "CANCELLED" }).expect(422);

    await owner.patch(`${orders}/${second.id}`).set(CSRF).send({ status: "CANCELLED" }).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: vela.id } })).stock).toBe(1);
    await owner.patch(`${orders}/${second.id}`).set(CSRF).send({ status: "NEW" }).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: vela.id } })).stock).toBe(0);

    // Sin stock no se reabre: cancelar, vender la unidad devuelta y reabrir → 409.
    await owner.patch(`${orders}/${second.id}`).set(CSRF).send({ status: "CANCELLED" }).expect(200);
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(vela.id)).expect(201);
    await owner.patch(`${orders}/${second.id}`).set(CSRF).send({ status: "NEW" }).expect(409);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: vela.id } })).stock).toBe(0);

    const filtered = orderListResponse.parse((await owner.get(`${orders}?status=CANCELLED`).expect(200)).body);
    expect(filtered.items.map((o) => o.id)).toEqual([second.id]);
    expect(filtered.counts).toEqual({ NEW: 1, PAID: 0, DELIVERED: 1, CANCELLED: 1 });

    expect(await prisma.auditLog.count({ where: { organizationId, action: "order.status_changed" } })).toBe(5);

    // SUPPORT gestiona pedidos pero no el catálogo; ANALYST solo mira.
    const support = await member(owner, organizationId, "SUPPORT");
    await support.post(`${catalog}/products`).set(CSRF).send({ name: "No", priceAmount: 1, priceCurrency: "CLP" }).expect(403);
    await support.patch(`${orders}/${second.id}`).set(CSRF).send({ status: "CANCELLED" }).expect(200);
    const analyst = await member(owner, organizationId, "ANALYST");
    await analyst.get(orders).expect(200);
    await analyst.patch(`${orders}/${second.id}`).set(CSRF).send({ status: "NEW" }).expect(403);
  });

  it("borrar un producto conserva sus pedidos con su foto de datos", async () => {
    const { owner, catalog, publicCatalog, orders } = await setup();
    const vela = await product(owner, catalog, {});
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send(orderBody(vela.id)).expect(201);
    await owner.delete(`${catalog}/products/${vela.id}`).set(CSRF).expect(204);
    const listed = orderListResponse.parse((await owner.get(orders).expect(200)).body);
    expect(listed.items[0]).toMatchObject({ productId: null, productName: "Vela de soya", totalAmount: 7990 });
  });
});
