import { createHash, randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { signBookingLinkToken, signOrderDownloadToken, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { productFileUploadResponse, productResponse, publicDownloadResponse, publicDownloadUrlResponse, publicOrderStatusResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { cleanupAbandonedProductFiles, MemoryStorageAdapter, productFileKey } from "@impulza/storage";
import { MAX_DOWNLOADS_PER_ORDER } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { PRIVATE_STORAGE } from "../../storage/storage.module.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F5.11b (ADR-015) — archivos en venta: subida al bucket privado con verificación, reemplazo y
// cuota; descarga solo tras el pago, con URL firmada de pocos minutos y tope por pedido.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@downloads-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const PDF = new TextEncoder().encode("%PDF-1.7\nguía de cerámica\n");

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Descargas pagadas (e2e) — F5.11b, ADR-015", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let storage: MemoryStorageAdapter;
  let httpServer: Parameters<typeof request>[0];
  const secret = env.BOOKING_LINK_SECRET!;

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    storage = new MemoryStorageAdapter("https://privado.test");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(PRIVATE_STORAGE)
      .useValue(storage)
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

  async function shop(options: { roomy?: boolean } = {}) {
    const owner = await loggedIn();
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Taller", slug: unique("org") }).expect(201);
    const organizationId = org.body.id as string;
    if (options.roomy !== false) await assignRoomyPlan(prisma, organizationId);
    const siteSlug = unique("sitio");
    const site = await owner.agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Taller Barro", slug: siteSlug }).expect(201);
    const catalog = `/api/v1/organizations/${organizationId}/sites/${site.body.id}/catalog`;
    const product = await owner.agent
      .post(`${catalog}/products`)
      .set(CSRF)
      .send({ name: "Guía de cerámica", kind: "DIGITAL", priceAmount: 9_990, priceCurrency: "CLP", paymentUrl: "https://pago.ejemplo.cl/guia" })
      .expect(201);
    emailAdapter.messages = [];
    return {
      owner: owner.agent,
      ownerEmail: owner.email,
      organizationId,
      catalog,
      productId: product.body.id as string,
      fileBase: `${catalog}/products/${product.body.id}/file`,
      orders: `/api/v1/organizations/${organizationId}/orders`,
      publicCatalog: `/api/v1/public/sites/${siteSlug}/catalog`,
    };
  }

  /** Sube y confirma un archivo; devuelve el producto y el id del archivo. */
  async function upload(agent: ReturnType<typeof request.agent>, fileBase: string, body = PDF, contentType = "application/pdf", fileName = "Guía de cerámica.pdf") {
    const requested = productFileUploadResponse.parse(
      (await agent.post(fileBase).set(CSRF).send({ fileName, contentType, sizeBytes: body.byteLength }).expect(201)).body,
    );
    storage.simulateUpload(requested.upload.url, body, contentType);
    return { fileId: requested.fileId, confirm: () => agent.post(`${fileBase}/${requested.fileId}/confirm`).set(CSRF) };
  }

  async function order(publicCatalog: string, productId: string) {
    const customerEmail = `cliente.${unique("c")}${TEST_EMAIL_DOMAIN}`;
    await request(httpServer).post(`${publicCatalog}/orders`).set(CSRF).send({ productId, quantity: 1, name: "Ana", email: customerEmail, consent: true }).expect(201);
    const created = await prisma.order.findFirstOrThrow({ where: { customerEmail } });
    return { orderId: created.id, customerEmail, token: signOrderDownloadToken(created.id, secret) };
  }

  it("sube al bucket privado, verifica el archivo, lo reemplaza y lo quita", async () => {
    const s = await shop();
    const first = await upload(s.owner, s.fileBase);
    const ready = productResponse.parse((await first.confirm().expect(200)).body);
    expect(ready.downloadFile).toMatchObject({ id: first.fileId, fileName: "Guía de cerámica.pdf", contentType: "application/pdf", sizeBytes: PDF.byteLength });
    // Confirmar dos veces no es un error.
    await first.confirm().expect(200);
    const firstKey = productFileKey(s.organizationId, s.productId, first.fileId);
    expect(storage.objects.has(firstKey)).toBe(true);

    // Reemplazo: el nuevo queda listo y el anterior se borra del bucket y de la base.
    const second = await upload(s.owner, s.fileBase, new TextEncoder().encode("%PDF-1.7\nsegunda edición\n"), "application/pdf", "Guía v2.pdf");
    expect(productResponse.parse((await second.confirm().expect(200)).body).downloadFile?.fileName).toBe("Guía v2.pdf");
    expect(storage.objects.has(firstKey)).toBe(false);
    expect(await prisma.productFile.count({ where: { productId: s.productId, status: "READY" } })).toBe(1);
    const listed = (await s.owner.get(`${s.catalog}/products`).expect(200)).body as Array<{ id: string; downloadFile: { fileName: string } | null }>;
    expect(listed.find((item) => item.id === s.productId)?.downloadFile?.fileName).toBe("Guía v2.pdf");

    // Con archivo, el producto no deja de ser digital.
    await s.owner.patch(`${s.catalog}/products/${s.productId}`).set(CSRF).send({ kind: "SERVICE" }).expect(422);

    expect(productResponse.parse((await s.owner.delete(s.fileBase).set(CSRF).expect(200)).body).downloadFile).toBeNull();
    expect(storage.keysWithPrefix(`org/${s.organizationId}/products/${s.productId}/`)).toHaveLength(0);
    await s.owner.delete(s.fileBase).set(CSRF).expect(404);
  });

  it("rechaza en el servidor: un archivo que no es lo que dice, otro tamaño, un producto no digital y formatos no admitidos", async () => {
    const s = await shop();
    const fake = await upload(s.owner, s.fileBase, new TextEncoder().encode("<!doctype html><script>alert(1)</script>"), "application/pdf", "virus.pdf");
    await fake.confirm().expect(422);
    expect(await prisma.productFile.findUniqueOrThrow({ where: { id: fake.fileId } })).toMatchObject({ status: "FAILED" });
    expect(storage.objects.has(productFileKey(s.organizationId, s.productId, fake.fileId))).toBe(false);

    const requested = productFileUploadResponse.parse((await s.owner.post(s.fileBase).set(CSRF).send({ fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 999 }).expect(201)).body);
    storage.simulateUpload(requested.upload.url, PDF, "application/pdf");
    await s.owner.post(`${s.fileBase}/${requested.fileId}/confirm`).set(CSRF).expect(422);

    await s.owner.post(s.fileBase).set(CSRF).send({ fileName: "x.exe", contentType: "application/x-msdownload", sizeBytes: 10 }).expect(400);
    await s.owner.post(s.fileBase).set(CSRF).send({ fileName: "../../etc/passwd", contentType: "application/pdf", sizeBytes: 10 }).expect(400);
    await s.owner.post(s.fileBase).set(CSRF).send({ fileName: "grande.zip", contentType: "application/zip", sizeBytes: 300 * 1024 * 1024 }).expect(400);

    const physical = await s.owner.post(`${s.catalog}/products`).set(CSRF).send({ name: "Taza", kind: "PHYSICAL", priceAmount: 5_000, priceCurrency: "CLP" }).expect(201);
    await s.owner.post(`${s.catalog}/products/${physical.body.id}/file`).set(CSRF).send({ fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }).expect(422);
  });

  it("el archivo cuenta para la cuota de almacenamiento del plan", async () => {
    const s = await shop({ roomy: false });
    // Plan Gratis: 200 MB. Una subida pedida reserva su tamaño.
    await s.owner.post(s.fileBase).set(CSRF).send({ fileName: "curso.mp4", contentType: "video/mp4", sizeBytes: 150 * 1024 * 1024 }).expect(201);
    await s.owner.post(s.fileBase).set(CSRF).send({ fileName: "extra.mp4", contentType: "video/mp4", sizeBytes: 100 * 1024 * 1024 }).expect(402);
  });

  it("la descarga solo se entrega pagado: antes no, al pagar llega el enlace y cada URL cuenta", async () => {
    const s = await shop();
    await (await upload(s.owner, s.fileBase)).confirm().expect(200);
    const { orderId, customerEmail, token } = await order(s.publicCatalog, s.productId);

    expect(publicDownloadResponse.parse((await request(httpServer).get(`/api/v1/public/downloads/${token}`).set(CSRF).expect(200)).body)).toMatchObject({
      status: "awaiting_payment",
      fileName: "Guía de cerámica.pdf",
      downloadsLeft: MAX_DOWNLOADS_PER_ORDER,
    });
    await request(httpServer).post(`/api/v1/public/downloads/${token}/url`).set(CSRF).expect(409);
    // El correo de "recibido" no trae el enlace de descarga: todavía no está pagado.
    expect(emailAdapter.messages.find((m) => m.to === customerEmail)?.text).not.toContain("/pedido/descarga/");

    emailAdapter.messages = [];
    await s.owner.patch(`${s.orders}/${orderId}`).set(CSRF).send({ status: "PAID" }).expect(200);
    const paidEmail = emailAdapter.messages.find((m) => m.to === customerEmail);
    expect(paidEmail?.text).toContain(`${env.PUBLIC_SITE_BASE_URL}/pedido/descarga/${token}`);

    const view = publicDownloadResponse.parse((await request(httpServer).get(`/api/v1/public/downloads/${token}`).set(CSRF).expect(200)).body);
    expect(view).toMatchObject({ status: "ready", siteName: "Taller Barro", productName: "Guía de cerámica" });
    // Ver no cuenta.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).downloadCount).toBe(0);

    const url = publicDownloadUrlResponse.parse((await request(httpServer).post(`/api/v1/public/downloads/${token}/url`).set(CSRF).expect(200)).body);
    expect(url.url).toContain(`memory://download/org/${s.organizationId}/products/${s.productId}/`);
    expect(decodeURIComponent(url.url)).toContain("attachment;");
    expect(Date.parse(url.expiresAt) - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    expect(url.downloadsLeft).toBe(MAX_DOWNLOADS_PER_ORDER - 1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).downloadCount).toBe(1);

    // Un enlace alterado, de otro pedido o de otro propósito no sirve.
    await request(httpServer).get(`/api/v1/public/downloads/${token.slice(0, -2)}xx`).set(CSRF).expect(404);
    await request(httpServer).get(`/api/v1/public/downloads/${signBookingLinkToken(orderId, secret)}`).set(CSRF).expect(404);
    await request(httpServer).get(`/api/v1/public/downloads/${signOrderDownloadToken(orderId, "otro-secreto-de-32-caracteres-000")}`).set(CSRF).expect(404);
  });

  it("tope por pedido: nunca más descargas que el tope, aunque lleguen a la vez", async () => {
    const s = await shop();
    await (await upload(s.owner, s.fileBase)).confirm().expect(200);
    const { orderId, token } = await order(s.publicCatalog, s.productId);
    await s.owner.patch(`${s.orders}/${orderId}`).set(CSRF).send({ status: "PAID" }).expect(200);
    await prisma.order.update({ where: { id: orderId }, data: { downloadCount: MAX_DOWNLOADS_PER_ORDER - 1 } });

    const responses = await Promise.all([0, 1, 2].map(() => request(httpServer).post(`/api/v1/public/downloads/${token}/url`).set(CSRF)));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(2);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).downloadCount).toBe(MAX_DOWNLOADS_PER_ORDER);
    expect(publicDownloadResponse.parse((await request(httpServer).get(`/api/v1/public/downloads/${token}`).set(CSRF).expect(200)).body)).toMatchObject({
      status: "limit_reached",
      downloadsLeft: 0,
    });
  });

  it("cancelar, devolver todo o un contracargo cortan la descarga; borrar el producto borra su archivo", async () => {
    const s = await shop();
    const file = await upload(s.owner, s.fileBase);
    await file.confirm().expect(200);
    const view = async (token: string) => publicDownloadResponse.parse((await request(httpServer).get(`/api/v1/public/downloads/${token}`).set(CSRF).expect(200)).body).status;

    const cancelled = await order(s.publicCatalog, s.productId);
    await s.owner.patch(`${s.orders}/${cancelled.orderId}`).set(CSRF).send({ status: "PAID" }).expect(200);
    await s.owner.patch(`${s.orders}/${cancelled.orderId}`).set(CSRF).send({ status: "CANCELLED" }).expect(200);
    expect(await view(cancelled.token)).toBe("revoked");

    const refunded = await order(s.publicCatalog, s.productId);
    await s.owner.patch(`${s.orders}/${refunded.orderId}`).set(CSRF).send({ status: "PAID" }).expect(200);
    await prisma.order.update({ where: { id: refunded.orderId }, data: { refundedAmount: 9_990, paymentStatus: "refunded" } });
    expect(await view(refunded.token)).toBe("revoked");

    const disputed = await order(s.publicCatalog, s.productId);
    await s.owner.patch(`${s.orders}/${disputed.orderId}`).set(CSRF).send({ status: "PAID" }).expect(200);
    await prisma.order.update({ where: { id: disputed.orderId }, data: { paymentStatus: "charged_back" } });
    expect(await view(disputed.token)).toBe("revoked");
    await request(httpServer).post(`/api/v1/public/downloads/${disputed.token}/url`).set(CSRF).expect(409);

    const paid = await order(s.publicCatalog, s.productId);
    await s.owner.patch(`${s.orders}/${paid.orderId}`).set(CSRF).send({ status: "DELIVERED" }).expect(200);
    expect(await view(paid.token)).toBe("ready");
    await s.owner.delete(`${s.catalog}/products/${s.productId}`).set(CSRF).expect(204);
    expect(storage.objects.has(productFileKey(s.organizationId, s.productId, file.fileId))).toBe(false);
    expect(await view(paid.token)).toBe("unavailable");
  });

  it("'Tu pedido' muestra el enlace de descarga solo cuando el pedido ya lo entrega", async () => {
    const s = await shop();
    await (await upload(s.owner, s.fileBase)).confirm().expect(200);
    const { orderId } = await order(s.publicCatalog, s.productId);
    const statusToken = randomBytes(32).toString("base64url");
    await prisma.order.update({ where: { id: orderId }, data: { statusTokenHash: createHash("sha256").update(statusToken).digest("hex") } });
    const status = async () => publicOrderStatusResponse.parse((await request(httpServer).get(`/api/v1/public/orders/${statusToken}`).set(CSRF).expect(200)).body);
    expect((await status()).downloadUrl).toBeNull();
    await s.owner.patch(`${s.orders}/${orderId}`).set(CSRF).send({ status: "PAID" }).expect(200);
    expect((await status()).downloadUrl).toBe(`${env.PUBLIC_SITE_BASE_URL}/pedido/descarga/${signOrderDownloadToken(orderId, secret)}`);
  });

  it("la limpieza del worker borra subidas abandonadas y rechazadas viejas, nunca un archivo listo", async () => {
    const s = await shop();
    const ready = await upload(s.owner, s.fileBase);
    await ready.confirm().expect(200);
    const abandoned = await upload(s.owner, s.fileBase);
    const failed = await upload(s.owner, s.fileBase, new TextEncoder().encode("no soy un pdf"));
    await failed.confirm().expect(422);
    // Pasado el plazo: la subida pendiente ya no puede confirmarse y la rechazada dejó de mostrarse.
    const later = new Date(Date.now() + 8 * 24 * 3_600_000);
    // Con alcance: el reloj adelantado no debe tocar archivos de otras suites que corren a la vez.
    const removed = await cleanupAbandonedProductFiles(prisma, storage, later, { organizationId: s.organizationId });
    expect(removed).toBe(2);
    expect(await prisma.productFile.findUnique({ where: { id: abandoned.fileId } })).toBeNull();
    expect(await prisma.productFile.findUnique({ where: { id: failed.fileId } })).toBeNull();
    expect(storage.objects.has(productFileKey(s.organizationId, s.productId, abandoned.fileId))).toBe(false);
    expect(await prisma.productFile.findUniqueOrThrow({ where: { id: ready.fileId } })).toMatchObject({ status: "READY" });
    expect(storage.objects.has(productFileKey(s.organizationId, s.productId, ready.fileId))).toBe(true);
  });

  it("permisos y aislamiento: un ANALYST no sube; otra organización no toca el archivo ajeno", async () => {
    const s = await shop();
    const analyst = await loggedIn();
    const invite = await s.owner.post(`/api/v1/organizations/${s.organizationId}/members`).set(CSRF).send({ email: analyst.email, role: "ANALYST" }).expect(201);
    await analyst.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
    await analyst.agent.post(s.fileBase).set(CSRF).send({ fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }).expect(403);

    const other = await shop();
    const crossed = s.fileBase.replace(`/organizations/${s.organizationId}/`, `/organizations/${other.organizationId}/`);
    await other.owner.post(crossed).set(CSRF).send({ fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }).expect(404);
    await other.owner.post(s.fileBase).set(CSRF).send({ fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }).expect(403);
  });
});
