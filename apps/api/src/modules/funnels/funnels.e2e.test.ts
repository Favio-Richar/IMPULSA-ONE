import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { funnelReportResponse, funnelResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { SUGGESTED_FUNNEL } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F7.6 (ADR-021) — embudos de conversión contra NestJS + Postgres reales. Los eventos se insertan
// directo con su visita e instante exactos: lo que se prueba acá es el cálculo (orden, abandono,
// pago cruzado, filtros, aislamiento), no el pipeline, que tiene sus propias pruebas.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@funnels-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const FROM = "2026-09-01";
const TO = "2026-09-07";

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Instante dentro del rango: 3 de septiembre a mediodía UTC más `seconds`. */
function at(seconds: number): Date {
  return new Date(Date.parse("2026-09-03T12:00:00.000Z") + seconds * 1000);
}

describe("Embudos de conversión (e2e) — F7.6", () => {
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

  async function setup(options: { roomy?: boolean } = {}) {
    const { agent, email } = await register();
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org embudos", slug: uniqueSlug("org") }).expect(201);
    const organizationId = org.body.id as string;
    if (options.roomy !== false) {
      await assignRoomyPlan(prisma, organizationId);
    }
    const site = await agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF_HEADERS).send({ name: "Café", slug: uniqueSlug("site") }).expect(201);
    const siteId = site.body.id as string;
    const pages = await agent.get(`/api/v1/organizations/${organizationId}/sites/${siteId}/pages`).expect(200);
    const homeId = (pages.body as Array<{ id: string; isHome: boolean }>).find((page) => page.isHome)!.id;
    const funnelsPath = `/api/v1/organizations/${organizationId}/sites/${siteId}/funnels`;
    return { agent, email, organizationId, siteId, homeId, funnelsPath };
  }

  async function events(organizationId: string, siteId: string, rows: Array<{ v: string; type: string; t: Date; device?: string; subjectId?: string; key?: string }>) {
    await prisma.analyticsEvent.createMany({
      data: rows.map((row) => ({
        organizationId,
        siteId,
        type: row.type,
        anonymizedVisitorId: row.v,
        device: row.device ?? "desktop",
        subjectId: row.subjectId ?? null,
        idempotencyKey: row.key ?? null,
        createdAt: row.t,
      })),
    });
  }

  async function order(organizationId: string, siteId: string, paidAt: Date | null): Promise<string> {
    const created = await prisma.order.create({
      data: {
        organizationId,
        siteId,
        productName: "Producto",
        productKind: "PHYSICAL",
        unitPriceAmount: 1000,
        priceCurrency: "CLP",
        quantity: 1,
        totalAmount: 1000,
        customerName: "Cliente",
        customerEmail: "cliente@ejemplo.test",
        ...(paidAt ? { status: "PAID" as const, paidAt } : {}),
      },
    });
    return created.id;
  }

  async function booking(organizationId: string, siteId: string, depositPaidAt: Date | null): Promise<string> {
    const created = await prisma.booking.create({
      data: {
        organizationId,
        siteId,
        serviceName: "Servicio",
        durationMinutes: 30,
        startsAt: at(86_400),
        endsAt: at(86_400 + 1800),
        timeZone: "America/Santiago",
        customerName: "Cliente",
        customerEmail: "cliente@ejemplo.test",
        depositPaidAt,
      },
    });
    return created.id;
  }

  /**
   * Escenario de referencia, con el resultado calculado a mano para el embudo sugerido
   * (visita → interacción → contacto/reserva/pedido → pago):
   * - v1 (teléfono): vista, clic a los 60 s, contacto a los 300 s, pedido **pagado** a los 600 s.
   * - v2: vista, clic a los 120 s, pedido **sin pagar**.
   * - v3: solo vista.
   * - v4: clic **antes** de la vista: entra al embudo pero no avanza (orden estricto).
   * - v5: vista, WhatsApp a los 30 s, reserva con seña pagada **después** del rango.
   * Esperado: 5 → 3 → 3 → 2; medianas del paso 2: (60, 120, 30) → 60 s.
   */
  async function referenceScenario(organizationId: string, siteId: string) {
    const paidOrder = await order(organizationId, siteId, at(900));
    const unpaidOrder = await order(organizationId, siteId, null);
    const paidBooking = await booking(organizationId, siteId, new Date("2026-09-20T10:00:00.000Z"));
    await events(organizationId, siteId, [
      { v: "v1", type: "page_view", t: at(0), device: "mobile" },
      { v: "v1", type: "block_click", t: at(60), device: "mobile" },
      { v: "v1", type: "lead_created", t: at(300), device: "mobile" },
      { v: "v1", type: "order_created", t: at(600), device: "mobile", key: `order_created:${paidOrder}` },
      { v: "v2", type: "page_view", t: at(0) },
      { v: "v2", type: "block_click", t: at(120) },
      { v: "v2", type: "order_created", t: at(500), key: `order_created:${unpaidOrder}` },
      { v: "v3", type: "page_view", t: at(10) },
      { v: "v4", type: "block_click", t: at(0) },
      { v: "v4", type: "page_view", t: at(10) },
      { v: "v5", type: "page_view", t: at(0) },
      { v: "v5", type: "whatsapp_click", t: at(30) },
      { v: "v5", type: "booking_created", t: at(200), key: `booking_created:${paidBooking}` },
      // Fuera del rango: no cuenta.
      { v: "v6", type: "page_view", t: new Date("2026-08-15T12:00:00.000Z") },
    ]);
  }

  async function createSuggested(agent: request.Agent, funnelsPath: string) {
    return funnelResponse.parse((await agent.post(funnelsPath).set(CSRF_HEADERS).send(SUGGESTED_FUNNEL).expect(201)).body);
  }

  it("cuenta solo a quien avanza en orden, con conversión, abandono, tiempo mediano y el pago cruzado", async () => {
    const { agent, organizationId, siteId, funnelsPath } = await setup();
    await referenceScenario(organizationId, siteId);
    const funnel = await createSuggested(agent, funnelsPath);

    const report = funnelReportResponse.parse(
      (await agent.get(`${funnelsPath}/${funnel.id}/report`).query({ from: FROM, to: TO }).expect(200)).body,
    );

    expect(report.steps.map((step) => step.visitors)).toEqual([5, 3, 3, 2]);
    expect(report.steps[0]).toMatchObject({ conversionFromPrevious: null, dropOff: 0, dropOffRate: null, medianSecondsFromPrevious: null });
    expect(report.steps[1]).toMatchObject({ conversionFromPrevious: 0.6, conversionFromStart: 0.6, dropOff: 2, dropOffRate: 0.4, medianSecondsFromPrevious: 60 });
    expect(report.steps[2]).toMatchObject({ conversionFromPrevious: 1, dropOff: 0 });
    expect(report.steps[3]).toMatchObject({ conversionFromPrevious: 0.6667, conversionFromStart: 0.4, dropOff: 1 });
    expect(report.overallConversion).toBe(0.4);
    expect(report.biggestDropOffStep).toBe(1);
  });

  it("filtra por el dispositivo de entrada y por una página concreta (sujeto del evento)", async () => {
    const { agent, organizationId, siteId, homeId, funnelsPath } = await setup();
    await referenceScenario(organizationId, siteId);
    const funnel = await createSuggested(agent, funnelsPath);

    const mobile = funnelReportResponse.parse(
      (await agent.get(`${funnelsPath}/${funnel.id}/report`).query({ from: FROM, to: TO, device: "mobile" }).expect(200)).body,
    );
    expect(mobile.steps.map((step) => step.visitors)).toEqual([1, 1, 1, 1]);
    expect(mobile.device).toBe("mobile");

    await events(organizationId, siteId, [
      { v: "p1", type: "page_view", t: at(0), subjectId: homeId },
      { v: "p1", type: "form_submit", t: at(50) },
      { v: "p2", type: "page_view", t: at(0), subjectId: randomUUID() },
      { v: "p2", type: "form_submit", t: at(50) },
    ]);
    const onHome = funnelResponse.parse(
      (
        await agent
          .post(funnelsPath)
          .set(CSRF_HEADERS)
          .send({
            name: "Inicio a formulario",
            steps: [
              { label: "Vio el inicio", events: ["page_view"], subjectId: homeId },
              { label: "Envió el formulario", events: ["form_submit"] },
            ],
          })
          .expect(201)
      ).body,
    );
    expect(onHome.steps[0]!.subjectLabel).toBe("Inicio");
    const report = funnelReportResponse.parse((await agent.get(`${funnelsPath}/${onHome.id}/report`).query({ from: FROM, to: TO }).expect(200)).body);
    expect(report.steps.map((step) => step.visitors)).toEqual([1, 1]);
  });

  it("valida en el servidor: catálogo de eventos, sujetos del mismo sitio y tope de 10 por sitio", async () => {
    const { agent, funnelsPath } = await setup();
    const other = await setup();

    await agent.post(funnelsPath).set(CSRF_HEADERS).send({ name: "X", steps: [{ label: "a", events: ["page_view"] }] }).expect(400);
    await agent
      .post(funnelsPath)
      .set(CSRF_HEADERS)
      .send({ name: "Malo", steps: [{ label: "a", events: ["purchase"] }, { label: "b", events: ["page_view"] }] })
      .expect(400);
    const foreignPage = await agent
      .post(funnelsPath)
      .set(CSRF_HEADERS)
      .send({ name: "Página ajena", steps: [{ label: "a", events: ["page_view"], subjectId: other.homeId }, { label: "b", events: ["form_submit"] }] })
      .expect(422);
    expect(foreignPage.body).toMatchObject({ code: "FUNNEL_SUBJECT_INVALID", issues: [{ path: "steps.0.subjectId" }] });

    for (let index = 0; index < 10; index += 1) {
      await agent.post(funnelsPath).set(CSRF_HEADERS).send({ ...SUGGESTED_FUNNEL, name: `Embudo ${index}` }).expect(201);
    }
    const eleventh = await agent.post(funnelsPath).set(CSRF_HEADERS).send(SUGGESTED_FUNNEL).expect(422);
    expect(eleventh.body.code).toBe("FUNNEL_LIMIT_REACHED");
  });

  it("edita, reordena y borra, con auditoría de cada cambio", async () => {
    const { agent, organizationId, funnelsPath } = await setup();
    const funnel = await createSuggested(agent, funnelsPath);
    const reordered = [...SUGGESTED_FUNNEL.steps].reverse();

    const updated = funnelResponse.parse(
      (await agent.patch(`${funnelsPath}/${funnel.id}`).set(CSRF_HEADERS).send({ name: "Al revés", steps: reordered }).expect(200)).body,
    );
    expect(updated.name).toBe("Al revés");
    expect(updated.steps.map((step) => step.label)).toEqual(reordered.map((step) => step.label));
    await agent.patch(`${funnelsPath}/${funnel.id}`).set(CSRF_HEADERS).send({}).expect(400);

    await agent.delete(`${funnelsPath}/${funnel.id}`).set(CSRF_HEADERS).expect(204);
    await agent.get(`${funnelsPath}/${funnel.id}`).expect(404);

    const actions = (await prisma.auditLog.findMany({ where: { organizationId, targetId: funnel.id }, orderBy: { createdAt: "asc" } })).map((row) => row.action);
    expect(actions).toEqual(["funnel.created", "funnel.updated", "funnel.deleted"]);
  });

  it("un ANALYST lee embudos e informes pero no los crea, edita ni borra", async () => {
    const { agent, organizationId, siteId, funnelsPath } = await setup();
    const funnel = await createSuggested(agent, funnelsPath);
    const analyst = await register();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: analyst.email } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "ANALYST" } });
    await prisma.membership.create({ data: { organizationId, userId: user.id, roleId: role.id, status: "ACTIVE" } });
    void siteId;

    expect((await analyst.agent.get(funnelsPath).expect(200)).body).toHaveLength(1);
    await analyst.agent.get(`${funnelsPath}/${funnel.id}/report`).query({ from: FROM, to: TO }).expect(200);
    await analyst.agent.post(funnelsPath).set(CSRF_HEADERS).send(SUGGESTED_FUNNEL).expect(403);
    await analyst.agent.patch(`${funnelsPath}/${funnel.id}`).set(CSRF_HEADERS).send({ name: "No" }).expect(403);
    await analyst.agent.delete(`${funnelsPath}/${funnel.id}`).set(CSRF_HEADERS).expect(403);
  });

  it("respeta el historial del plan (402) y el rango máximo (400)", async () => {
    const { agent, funnelsPath } = await setup({ roomy: false });
    const funnel = await createSuggested(agent, funnelsPath);
    const denied = await agent.get(`${funnelsPath}/${funnel.id}/report`).query({ from: "2026-01-01", to: "2026-01-31" }).expect(402);
    expect(denied.body).toMatchObject({ code: "PLAN_LIMIT_REACHED", limit: { key: "analyticsHistoryDays" } });
    await agent.get(`${funnelsPath}/${funnel.id}/report`).query({ from: "2026-09-07", to: "2026-09-01" }).expect(400);
    await agent.get(`${funnelsPath}/${funnel.id}/report`).query({ from: FROM, to: TO, device: "tv" }).expect(400);
  });

  it("aislamiento (ADR-002): nada de otra organización se ve, se toca ni se cuenta", async () => {
    const victim = await setup();
    const attacker = await setup();
    await referenceScenario(victim.organizationId, victim.siteId);
    const funnel = await createSuggested(victim.agent, victim.funnelsPath);
    // El atacante tiene eventos con las mismas visitas en su propio sitio: no deben mezclarse.
    await events(attacker.organizationId, attacker.siteId, [
      { v: "v3", type: "block_click", t: at(100) },
      { v: "v3", type: "lead_created", t: at(200) },
    ]);
    const before = (await victim.agent.get(`${victim.funnelsPath}/${funnel.id}/report`).query({ from: FROM, to: TO }).expect(200)).body;

    // Con su propia organización en la ruta y el sitio o el embudo ajenos: 404.
    const crossSite = `/api/v1/organizations/${attacker.organizationId}/sites/${victim.siteId}/funnels`;
    await attacker.agent.get(crossSite).expect(404);
    await attacker.agent.post(crossSite).set(CSRF_HEADERS).send(SUGGESTED_FUNNEL).expect(404);
    await attacker.agent.get(`${attacker.funnelsPath}/${funnel.id}`).expect(404);
    await attacker.agent.get(`${attacker.funnelsPath}/${funnel.id}/report`).query({ from: FROM, to: TO }).expect(404);
    await attacker.agent.patch(`${attacker.funnelsPath}/${funnel.id}`).set(CSRF_HEADERS).send({ name: "Mío" }).expect(404);
    await attacker.agent.delete(`${attacker.funnelsPath}/${funnel.id}`).set(CSRF_HEADERS).expect(404);
    // Con la organización ajena en la ruta: no es miembro.
    await attacker.agent.get(victim.funnelsPath).expect(403);

    const after = (await victim.agent.get(`${victim.funnelsPath}/${funnel.id}/report`).query({ from: FROM, to: TO }).expect(200)).body;
    expect(after).toEqual(before);
    expect(after.steps.map((step: { visitors: number }) => step.visitors)).toEqual([5, 3, 3, 2]);
    expect((await victim.agent.get(`${victim.funnelsPath}/${funnel.id}`).expect(200)).body.name).toBe(SUGGESTED_FUNNEL.name);
  });
});
