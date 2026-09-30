import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { webhookDeliveryDetailResponse, webhookDeliveryResponse, webhookEndpointResponse, webhookSecretResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import { MAX_WEBHOOK_ENDPOINTS, WEBHOOK_API_VERSION } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F7.2 — webhooks salientes (ADR-017): destinos con permisos, validación y tope; el secreto se ve
// una sola vez y se guarda cifrado; cada evento real crea una entrega por destino suscrito con la
// carga útil del momento; registro, prueba y reenvío; nada cruza de organización. La entrega en sí
// (firma, envío, reintentos, desactivación) la prueban el paquete y el worker.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@webhooks-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
// Dominio que no resuelve: si el worker de desarrollo toma una entrega, falla sin salir a internet.
const HOOK_HOST = "sink.impulza-webhooks-e2e-nx.com";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Webhooks salientes (e2e) — F7.2", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let httpServer: Parameters<typeof request>[0];
  const emailAdapter = new FakeEmailAdapter();

  beforeAll(async () => {
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
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function register() {
    const email = `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password: "password1234" }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password: "password1234" }).expect(201);
    return { agent, email };
  }

  async function setup() {
    const { agent } = await register();
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org Hooks", slug: unique("org") }).expect(201);
    await assignRoomyPlan(prisma, org.body.id);
    const organizationId = org.body.id as string;
    return { agent, organizationId, path: `/api/v1/organizations/${organizationId}/webhooks` };
  }

  async function addMember(organizationId: string, roleName: string) {
    const member = await register();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: member.email } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.membership.create({ data: { organizationId, userId: user.id, roleId: role.id, status: "ACTIVE" } });
    return member.agent;
  }

  const hookUrl = (path = unique("h")) => `https://${HOOK_HOST}/${path}`;

  async function createEndpoint(agent: ReturnType<typeof request.agent>, path: string, events: string[], url = hookUrl()) {
    return webhookSecretResponse.parse((await agent.post(path).set(CSRF_HEADERS).send({ url, description: "Zapier", events }).expect(201)).body);
  }

  it("crea un destino con el secreto una sola vez, cifrado en la base; edita, pausa, reanuda, rota y borra, todo auditado", async () => {
    const { agent, path, organizationId } = await setup();
    const created = await createEndpoint(agent, path, ["order.paid", "contact.created", "contact.created"]);
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.endpoint).toMatchObject({ active: true, events: ["contact.created", "order.paid"], secretHint: created.secret.slice(-4), consecutiveFailures: 0 });

    const stored = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: created.endpoint.id } });
    expect(stored.secretEncrypted).not.toContain(created.secret);

    const list = z.array(webhookEndpointResponse.strict()).parse((await agent.get(path).expect(200)).body);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(created.secret);

    const endpointPath = `${path}/${created.endpoint.id}`;
    const paused = webhookEndpointResponse.parse((await agent.patch(endpointPath).set(CSRF_HEADERS).send({ active: false, description: null }).expect(200)).body);
    expect(paused).toMatchObject({ active: false, disabledReason: null, description: null });
    // Un destino que el sistema desactivó por fallas se reanuda con la cuenta en cero.
    await prisma.webhookEndpoint.update({ where: { id: created.endpoint.id }, data: { disabledReason: "too_many_failures", disabledAt: new Date(), consecutiveFailures: 15 } });
    const resumed = webhookEndpointResponse.parse((await agent.patch(endpointPath).set(CSRF_HEADERS).send({ active: true }).expect(200)).body);
    expect(resumed).toMatchObject({ active: true, disabledReason: null, disabledAt: null, consecutiveFailures: 0 });

    const rotated = webhookSecretResponse.parse((await agent.post(`${endpointPath}/rotate-secret`).set(CSRF_HEADERS).expect(201)).body);
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.endpoint.secretHint).toBe(rotated.secret.slice(-4));

    await agent.delete(endpointPath).set(CSRF_HEADERS).expect(204);
    expect((await agent.get(path).expect(200)).body).toEqual([]);
    const audit = await prisma.auditLog.findMany({ where: { organizationId, targetId: created.endpoint.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((row) => row.action)).toEqual(["webhook.created", "webhook.paused", "webhook.resumed", "webhook.secret_rotated", "webhook.deleted"]);
    // La auditoría guarda el host, nunca la URL completa (puede llevar un token) ni el secreto.
    expect(JSON.stringify(audit)).not.toContain(created.endpoint.url);
    expect(JSON.stringify(audit)).not.toContain(created.secret);
  });

  it("valida en el servidor: solo https público, sin IPs, puertos ni credenciales; eventos del catálogo; sin URLs repetidas; tope de 10", async () => {
    const { agent, path, organizationId } = await setup();
    for (const url of [
      "http://hooks.zapier.com/x",
      "https://127.0.0.1/x",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/x",
      "https://localhost/x",
      "https://intranet/x",
      "https://user:pass@hooks.zapier.com/x",
      "https://hooks.zapier.com:8443/x",
      "https://servidor.local/x",
      "javascript:alert(1)",
    ]) {
      const res = await agent.post(path).set(CSRF_HEADERS).send({ url, events: ["contact.created"] });
      expect(res.status, url).toBe(400);
    }
    await agent.post(path).set(CSRF_HEADERS).send({ url: hookUrl(), events: [] }).expect(400);
    await agent.post(path).set(CSRF_HEADERS).send({ url: hookUrl(), events: ["user.deleted"] }).expect(400);

    const url = hookUrl("repetida");
    await createEndpoint(agent, path, ["contact.created"], url);
    expect((await agent.post(path).set(CSRF_HEADERS).send({ url, events: ["order.paid"] }).expect(409)).body.code).toBe("WEBHOOK_URL_TAKEN");

    for (let i = 1; i < MAX_WEBHOOK_ENDPOINTS; i++) {
      await prisma.webhookEndpoint.create({ data: { organizationId, url: hookUrl(`relleno-${i}`), events: ["contact.created"], secretEncrypted: "x" } });
    }
    expect((await agent.post(path).set(CSRF_HEADERS).send({ url: hookUrl(), events: ["contact.created"] }).expect(422)).body.code).toBe("WEBHOOK_LIMIT_REACHED");
    // Y la base misma rechaza una URL que no sea https (CHECK).
    await expect(prisma.webhookEndpoint.create({ data: { organizationId, url: "http://x.com", events: [], secretEncrypted: "x" } })).rejects.toThrow();
  });

  it("solo OWNER y ADMIN (`webhooks.manage`): un EDITOR o un ANALYST no ven ni las URLs", async () => {
    const { agent, path, organizationId } = await setup();
    const { endpoint } = await createEndpoint(agent, path, ["contact.created"]);
    const admin = await addMember(organizationId, "ADMIN");
    await admin.get(path).expect(200);
    await admin.post(`${path}/${endpoint.id}/test`).set(CSRF_HEADERS).expect(201);
    for (const roleName of ["EDITOR", "ANALYST"]) {
      const member = await addMember(organizationId, roleName);
      await member.get(path).expect(403);
      await member.post(path).set(CSRF_HEADERS).send({ url: hookUrl(), events: ["contact.created"] }).expect(403);
      await member.get(`${path}/${endpoint.id}/deliveries`).expect(403);
      await member.post(`${path}/${endpoint.id}/rotate-secret`).set(CSRF_HEADERS).expect(403);
      await member.delete(`${path}/${endpoint.id}`).set(CSRF_HEADERS).expect(403);
    }
    await request(httpServer).get(path).expect(401);
  });

  it("aislamiento (ADR-002): otra organización no ve, edita, prueba ni reenvía destinos o entregas ajenos", async () => {
    const a = await setup();
    const b = await setup();
    const { endpoint } = await createEndpoint(a.agent, a.path, ["contact.created"]);
    const delivery = webhookDeliveryResponse.parse((await a.agent.post(`${a.path}/${endpoint.id}/test`).set(CSRF_HEADERS).expect(201)).body);
    await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED" } });

    const foreign = `${b.path}/${endpoint.id}`;
    expect((await b.agent.get(b.path).expect(200)).body).toEqual([]);
    await b.agent.patch(foreign).set(CSRF_HEADERS).send({ active: false }).expect(404);
    await b.agent.delete(foreign).set(CSRF_HEADERS).expect(404);
    await b.agent.post(`${foreign}/rotate-secret`).set(CSRF_HEADERS).expect(404);
    await b.agent.post(`${foreign}/test`).set(CSRF_HEADERS).expect(404);
    await b.agent.get(`${foreign}/deliveries`).expect(404);
    await b.agent.get(`${foreign}/deliveries/${delivery.id}`).expect(404);
    await b.agent.post(`${foreign}/deliveries/${delivery.id}/redeliver`).set(CSRF_HEADERS).expect(404);
    // Tampoco con la ruta de su propia organización pero el id ajeno en la entrega.
    const own = await createEndpoint(b.agent, b.path, ["contact.created"]);
    await b.agent.get(`${b.path}/${own.endpoint.id}/deliveries/${delivery.id}`).expect(404);
    // Y la organización ajena de la ruta exige ser miembro.
    await b.agent.get(a.path).expect(403);

    expect(await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } })).toMatchObject({ active: true });
  });

  it("prueba (ping), registro con filtro y detalle, y reenvío: el mismo evento, y no mientras se intenta", async () => {
    const { agent, path } = await setup();
    const { endpoint } = await createEndpoint(agent, path, ["contact.created"]);
    const base = `${path}/${endpoint.id}`;
    const ping = webhookDeliveryResponse.strict().parse((await agent.post(`${base}/test`).set(CSRF_HEADERS).expect(201)).body);
    expect(ping).toMatchObject({ eventType: "ping", status: "PENDING", attempts: 0 });

    const detail = webhookDeliveryDetailResponse.parse((await agent.get(`${base}/deliveries/${ping.id}`).expect(200)).body);
    expect(detail.payload).toMatchObject({ id: ping.eventId, type: "ping", apiVersion: WEBHOOK_API_VERSION, test: true, data: { message: expect.any(String) } });

    // El ejemplo de un evento, para que Zapier o Make aprendan sus campos: marcado como prueba.
    const sample = webhookDeliveryResponse.parse((await agent.post(`${base}/test`).set(CSRF_HEADERS).send({ eventType: "order.paid" }).expect(201)).body);
    const sampleDetail = webhookDeliveryDetailResponse.parse((await agent.get(`${base}/deliveries/${sample.id}`).expect(200)).body);
    expect(sampleDetail.payload).toMatchObject({ type: "order.paid", test: true, data: { order: { status: "PAID" } } });
    await agent.post(`${base}/test`).set(CSRF_HEADERS).send({ eventType: "user.deleted" }).expect(400);
    await prisma.webhookDelivery.deleteMany({ where: { id: sample.id } });

    // Si el worker de desarrollo ya la tomó, se deja en un estado final conocido.
    await prisma.webhookDelivery.update({ where: { id: ping.id }, data: { status: "PENDING", attempts: 0 } });
    expect((await agent.post(`${base}/deliveries/${ping.id}/redeliver`).set(CSRF_HEADERS).expect(409)).body.code).toBe("WEBHOOK_DELIVERY_PENDING");
    await prisma.webhookDelivery.update({ where: { id: ping.id }, data: { status: "FAILED", attempts: 8, lastStatusCode: 500, lastError: "http_500" } });

    const failed = z.array(webhookDeliveryResponse).parse((await agent.get(`${base}/deliveries`).query({ status: "FAILED" }).expect(200)).body);
    expect(failed.map((row) => row.id)).toEqual([ping.id]);
    expect((await agent.get(`${base}/deliveries`).query({ status: "SUCCEEDED" }).expect(200)).body).toEqual([]);
    await agent.get(`${base}/deliveries`).query({ status: "NOPE" }).expect(400);

    const again = webhookDeliveryResponse.parse((await agent.post(`${base}/deliveries/${ping.id}/redeliver`).set(CSRF_HEADERS).expect(201)).body);
    expect(again).toMatchObject({ id: ping.id, eventId: ping.eventId });
    const row = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: ping.id } });
    expect(row.eventId).toBe(ping.eventId);

    await agent.patch(base).set(CSRF_HEADERS).send({ active: false }).expect(200);
    expect((await agent.post(`${base}/test`).set(CSRF_HEADERS).expect(422)).body.code).toBe("WEBHOOK_ENDPOINT_INACTIVE");
  });

  it("cada evento real crea una entrega por destino activo suscrito, con los datos del momento; ninguno para pausados o no suscritos", async () => {
    const { agent, path, organizationId } = await setup();
    const contacts = await createEndpoint(agent, path, ["contact.created"]);
    const everything = await createEndpoint(agent, path, ["booking.cancelled", "booking.created", "contact.created", "order.created", "order.paid"]);
    const paused = await createEndpoint(agent, path, ["contact.created"]);
    await agent.patch(`${path}/${paused.endpoint.id}`).set(CSRF_HEADERS).send({ active: false }).expect(200);

    const deliveriesOf = (endpointId: string, eventType: string) => prisma.webhookDelivery.findMany({ where: { endpointId, eventType } });

    // contact.created
    const email = `ana-${Date.now()}@example.com`;
    const contact = (await agent.post(`/api/v1/organizations/${organizationId}/contacts`).set(CSRF_HEADERS).send({ name: "Ana Pérez", email }).expect(201)).body;
    const [toContacts] = await deliveriesOf(contacts.endpoint.id, "contact.created");
    const [toEverything] = await deliveriesOf(everything.endpoint.id, "contact.created");
    expect(await deliveriesOf(paused.endpoint.id, "contact.created")).toEqual([]);
    // El mismo evento (mismo id) para cada destino.
    expect(toContacts!.eventId).toBe(toEverything!.eventId);
    expect(toContacts!.payload).toMatchObject({
      id: toContacts!.eventId,
      type: "contact.created",
      apiVersion: WEBHOOK_API_VERSION,
      organizationId,
      test: false,
      data: { contact: { id: contact.id, name: "Ana Pérez", email, phone: null, marketingConsent: false } },
    });

    // booking.created (anotada por el negocio) y booking.cancelled
    const siteSlug = unique("site");
    const site = (await agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF_HEADERS).send({ name: "Barbería", slug: siteSlug }).expect(201)).body;
    const booking = await prisma.booking.create({
      data: {
        organizationId,
        siteId: site.id,
        serviceName: "Corte",
        durationMinutes: 30,
        startsAt: new Date(Date.now() + 3 * 24 * 3_600_000),
        endsAt: new Date(Date.now() + 3 * 24 * 3_600_000 + 30 * 60_000),
        timeZone: "America/Santiago",
        customerName: "Luis",
        customerEmail: "luis@example.com",
      },
    });
    await agent.patch(`/api/v1/organizations/${organizationId}/bookings/${booking.id}`).set(CSRF_HEADERS).send({ status: "CANCELLED" }).expect(200);
    const [cancelled] = await deliveriesOf(everything.endpoint.id, "booking.cancelled");
    expect(cancelled!.payload).toMatchObject({ data: { booking: { id: booking.id, status: "CANCELLED", serviceName: "Corte", customer: { name: "Luis", email: "luis@example.com", phone: null }, deposit: null } } });
    expect(await deliveriesOf(contacts.endpoint.id, "booking.cancelled")).toEqual([]);

    // order.created (pedido público) y order.paid (marcado a mano)
    const catalog = `/api/v1/organizations/${organizationId}/sites/${site.id}/catalog`;
    const product = (await agent.post(`${catalog}/products`).set(CSRF_HEADERS).send({ name: "Vela", priceAmount: 7990, priceCurrency: "CLP", paymentUrl: "https://pago.ejemplo.cl/vela" }).expect(201)).body;
    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/catalog/orders`)
      .set(CSRF_HEADERS)
      .send({ productId: product.id, quantity: 2, name: "Eva", email: `eva-${Date.now()}@example.com`, address: "Av. Siempre Viva 742", consent: true })
      .expect(201);
    const order = await prisma.order.findFirstOrThrow({ where: { organizationId } });
    const [orderCreated] = await deliveriesOf(everything.endpoint.id, "order.created");
    expect(orderCreated!.payload).toMatchObject({ data: { order: { id: order.id, productName: "Vela", quantity: 2, totalAmount: 15980, status: "NEW", paidAt: null, onlinePayment: null } } });
    // Nunca datos internos: ni el enlace de pago, ni el hash del enlace del comprador.
    expect(JSON.stringify(orderCreated!.payload)).not.toContain("pago.ejemplo.cl");
    expect(JSON.stringify(orderCreated!.payload)).not.toContain("statusToken");

    await agent.patch(`/api/v1/organizations/${organizationId}/orders/${order.id}`).set(CSRF_HEADERS).send({ status: "PAID" }).expect(200);
    const [orderPaid] = await deliveriesOf(everything.endpoint.id, "order.paid");
    expect(orderPaid!.payload).toMatchObject({ data: { order: { id: order.id, status: "PAID", paidAt: expect.any(String) } } });
    expect(await deliveriesOf(contacts.endpoint.id, "order.paid")).toEqual([]);
  });

  it("una reserva desde la página pública emite booking.created con el cliente y la hora", async () => {
    const { agent, path, organizationId } = await setup();
    const { endpoint } = await createEndpoint(agent, path, ["booking.created"]);
    const siteSlug = unique("site");
    const site = (await agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF_HEADERS).send({ name: "Barbería", slug: siteSlug }).expect(201)).body;
    const booking = `/api/v1/organizations/${organizationId}/sites/${site.id}/booking`;
    const allDay = [{ start: "00:00", end: "24:00" }];
    await agent
      .put(`${booking}/settings`)
      .set(CSRF_HEADERS)
      .send({ enabled: true, timeZone: "America/Santiago", minNoticeMinutes: 0, maxAdvanceDays: 30, bufferMinutes: 0, slotIntervalMinutes: 30, weeklyHours: { mon: allDay, tue: allDay, wed: allDay, thu: allDay, fri: allDay, sat: allDay, sun: allDay } })
      .expect(200);
    const service = (await agent.post(`${booking}/services`).set(CSRF_HEADERS).send({ name: "Corte", durationMinutes: 30, priceAmount: 12000, priceCurrency: "CLP" }).expect(201)).body;
    const from = new Date(Date.now() + 2 * 24 * 3_600_000).toISOString().slice(0, 10);
    const slots = await request(httpServer).get(`/api/v1/public/sites/${siteSlug}/booking/availability`).set(CSRF_HEADERS).query({ serviceId: service.id, from, days: 1 }).expect(200);
    const startsAt = slots.body.days[0].slots[0] as string;
    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/booking`)
      .set(CSRF_HEADERS)
      .send({ serviceId: service.id, startsAt, name: "Luis", email: `luis-${Date.now()}@example.com`, phone: "+56912345678", consent: true })
      .expect(201);

    const created = await prisma.booking.findFirstOrThrow({ where: { organizationId } });
    const [delivery] = await prisma.webhookDelivery.findMany({ where: { endpointId: endpoint.id, eventType: "booking.created" } });
    expect(delivery!.payload).toMatchObject({
      type: "booking.created",
      data: { booking: { id: created.id, siteId: site.id, serviceName: "Corte", startsAt, timeZone: "America/Santiago", status: "CONFIRMED", priceAmount: 12000, priceCurrency: "CLP", customer: { name: "Luis", phone: "+56912345678" } } },
    });
  });

  it("sin destinos no se crea nada, y un evento nunca hace fallar la operación que lo originó", async () => {
    const { agent, path, organizationId } = await setup();
    await agent.post(`/api/v1/organizations/${organizationId}/contacts`).set(CSRF_HEADERS).send({ name: "Sin destinos" }).expect(201);
    expect(await prisma.webhookDelivery.count({ where: { organizationId } })).toBe(0);

    // Un destino con el secreto ilegible no afecta la creación (se lee solo al entregar).
    await createEndpoint(agent, path, ["contact.created"]);
    await prisma.webhookEndpoint.updateMany({ where: { organizationId }, data: { secretEncrypted: "roto" } });
    await agent.post(`/api/v1/organizations/${organizationId}/contacts`).set(CSRF_HEADERS).send({ name: "Con destino" }).expect(201);
    expect(await prisma.webhookDelivery.count({ where: { organizationId } })).toBe(1);
    // Y el listado lo sigue mostrando (sin pista del secreto) en vez de fallar.
    expect((await agent.get(path).expect(200)).body[0].secretHint).toBe("····");
  });
});
