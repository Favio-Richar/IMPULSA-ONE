import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AiProviderError, FakeProvider, type AiRequest, type FakeStep } from "@impulza/ai";
import { aiInsightsResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
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
import { AI_PROVIDER_FACTORY } from "./ai.service.js";

// F6.4 — IA comercial: métricas agregadas del sitio + salud de página → explicación y hasta 3
// acciones. El servidor decide si hay muestra suficiente y qué períodos entran (historial del plan);
// el modelo nunca recibe datos personales. Proveedor falso: sin red.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@site-insights-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const PREFIX = `e2e-insights-${Date.now().toString(36)}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const CONTACT_EMAIL = "cliente.secreta@correo-privado.test";

function isoDay(offset: number): string {
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  return new Date(today - offset * DAY_MS).toISOString().slice(0, 10);
}

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const VALID_OUTPUT = {
  summary: "Tu página recibe visitas y algunos clics.",
  actions: [{ title: "Publica tu página", reason: "Todavía no está publicada.", kind: "fix_page", findingCode: "page_not_published" }],
};

describe("IA comercial (e2e) — F6.4", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let httpServer: Parameters<typeof request>[0];
  const emailAdapter = new FakeEmailAdapter();
  let fake = new FakeProvider();
  let savedRoutes: Array<{ id: string; task: string; position: number; connectionId: string }> = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(AI_PROVIDER_FACTORY)
      .useValue(() => fake)
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    httpServer = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
    savedRoutes = await prisma.aiRoute.findMany();
    await prisma.aiRoute.deleteMany({});
    await prisma.aiConnection.create({
      data: { name: `${PREFIX}-local`, kind: "OPENAI_COMPATIBLE", baseUrl: "http://ia.interna:11434/v1", model: "modelo-local", routes: { create: { task: "insights", position: 0 } } },
    });
  });

  afterAll(async () => {
    await prisma.aiConnection.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.aiRoute.deleteMany({});
    await prisma.aiRoute.createMany({ data: savedRoutes });
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await prisma.plan.deleteMany({ where: { code: { startsWith: PREFIX } } });
    await app.close();
  });

  beforeEach(async () => {
    fake = new FakeProvider();
    const keys = [...(await redis.keys("ratelimit:*")), ...(await redis.keys("ai:quota:*"))];
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  const lastPrompt = (): string => (fake.requests.at(-1) as AiRequest<unknown>).prompt;
  const respond = (...steps: FakeStep[]) => fake.enqueue(...steps);

  async function register() {
    const email = `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password: "password1234" }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password: "password1234" }).expect(201);
    return { agent, email };
  }

  async function createSite() {
    const { agent } = await register();
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org Métricas", slug: uniqueSlug("org") }).expect(201);
    await assignRoomyPlan(prisma, org.body.id);
    const site = await agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF_HEADERS).send({ name: "Estudio", slug: uniqueSlug("site") }).expect(201);
    const organizationId = org.body.id as string;
    const siteId = site.body.id as string;
    return { agent, organizationId, siteId, path: `/api/v1/organizations/${organizationId}/sites/${siteId}/ai/insights` };
  }

  /** Agregados diarios como los escribe el worker (F3.6): un día con esas cantidades. */
  async function seedDay(organizationId: string, siteId: string, offset: number, values: { visitors: number; clicks?: number; leads?: number }) {
    const period = isoDay(offset);
    const rows = [
      ["page_view", values.visitors * 2],
      ["page_view:visitors", values.visitors],
      ["page_view:device:mobile", values.visitors * 2],
      ["block_click", values.clicks ?? 0],
      ["lead_created", values.leads ?? 0],
    ] as const;
    await prisma.analyticsAggregate.createMany({ data: rows.map(([metric, value]) => ({ organizationId, siteId, period, metric, value })) });
  }

  it("sin muestra suficiente lo dice el servidor y el modelo no recibe el período anterior ni desgloses", async () => {
    const { agent, organizationId, siteId, path } = await createSite();
    await seedDay(organizationId, siteId, 0, { visitors: 12, clicks: 3 });
    await seedDay(organizationId, siteId, 30, { visitors: 5 });
    respond({ output: VALID_OUTPUT });

    const response = await agent.post(path).set(CSRF_HEADERS).send({ days: 30 }).expect(200);
    const body = aiInsightsResponse.parse(response.body);
    expect(body.sample).toEqual({ enough: false, visitors: 12, minimum: 50, comparable: false });
    expect(body.comparedTo).toBeNull();
    expect(body.range).toEqual({ from: isoDay(29), to: isoDay(0) });
    expect(body.health?.score).toBeGreaterThanOrEqual(0);

    const prompt = lastPrompt();
    expect(prompt).toContain('"muestraSuficiente":false');
    expect(prompt).not.toContain("metricasAnteriores");
    expect(prompt).not.toContain("variacionPorcentual");
    expect(prompt).not.toContain("dispositivos");
  });

  it("con muestra en los dos períodos compara con el anterior", async () => {
    const { agent, organizationId, siteId, path } = await createSite();
    await seedDay(organizationId, siteId, 1, { visitors: 200, clicks: 80, leads: 10 });
    await seedDay(organizationId, siteId, 8, { visitors: 100, clicks: 20, leads: 5 });
    respond({ output: VALID_OUTPUT });

    const body = aiInsightsResponse.parse((await agent.post(path).set(CSRF_HEADERS).send({ days: 7 }).expect(200)).body);
    expect(body.sample).toMatchObject({ enough: true, comparable: true, visitors: 200 });
    expect(body.comparedTo).toEqual({ from: isoDay(13), to: isoDay(7) });
    expect(lastPrompt()).toContain('"variacionPorcentual":{"visitantes":100,"clics":300,"leads":100}');
    expect(lastPrompt()).toContain("dispositivos");
  });

  it("una acción que apunta a un hallazgo que la página no tiene es salida inválida", async () => {
    const { agent, path } = await createSite();
    const invented = { ...VALID_OUTPUT, actions: [{ ...VALID_OUTPUT.actions[0], findingCode: "seo_missing_everything" }] };
    respond({ output: invented }, { output: invented });
    await agent.post(path).set(CSRF_HEADERS).send({ days: 7 }).expect(503);
  });

  it("el modelo no recibe datos personales ni ids, aunque haya contactos y bloques", async () => {
    const { agent, organizationId, siteId, path } = await createSite();
    await prisma.contact.create({ data: { organizationId, email: CONTACT_EMAIL, name: "Clienta Secreta", phone: "+56911112222" } });
    await seedDay(organizationId, siteId, 0, { visitors: 80, clicks: 10, leads: 1 });
    respond({ output: VALID_OUTPUT });
    await agent.post(path).set(CSRF_HEADERS).send({ days: 7 }).expect(200);

    const prompt = lastPrompt();
    expect(prompt).not.toContain(CONTACT_EMAIL);
    expect(prompt).not.toContain("Clienta Secreta");
    expect(prompt).not.toContain("+56911112222");
    expect(prompt).not.toContain(organizationId);
    expect(prompt).not.toContain(siteId);
    expect(prompt).toContain('"contactosNuevos":1');
  });

  it("el historial del plan limita el período (402 sin llamar al modelo) y la comparación", async () => {
    const { agent, organizationId, siteId, path } = await createSite();
    const base = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
    const short = await prisma.plan.create({
      data: { code: `${PREFIX}-corto`, name: "Corto", priceMonthly: 0, currency: "CLP", limits: { ...(base.limits as object), analyticsHistoryDays: 30 } },
    });
    await prisma.organization.update({ where: { id: organizationId }, data: { planId: short.id } });

    const denied = await agent.post(path).set(CSRF_HEADERS).send({ days: 90 }).expect(402);
    expect(denied.body.code).toBe("PLAN_LIMIT_REACHED");
    expect(fake.requests).toHaveLength(0);

    await seedDay(organizationId, siteId, 0, { visitors: 300 });
    await seedDay(organizationId, siteId, 40, { visitors: 300 });
    respond({ output: VALID_OUTPUT });
    const body = aiInsightsResponse.parse((await agent.post(path).set(CSRF_HEADERS).send({ days: 30 }).expect(200)).body);
    expect(body.sample).toMatchObject({ enough: true, comparable: false });
    expect(lastPrompt()).not.toContain("metricasAnteriores");
  });

  it("un ANALYST puede pedir la lectura; un período fuera de la lista es 400", async () => {
    const { agent, organizationId, path } = await createSite();
    const analyst = await register();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: analyst.email } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "ANALYST" } });
    await prisma.membership.create({ data: { organizationId, userId: user.id, roleId: role.id, status: "ACTIVE" } });
    respond({ output: VALID_OUTPUT });
    await analyst.agent.post(path).set(CSRF_HEADERS).send({ days: 7 }).expect(200);
    await agent.post(path).set(CSRF_HEADERS).send({ days: 365 }).expect(400);
  });

  it("si el modelo falla, 503 y la cuota no se consume", async () => {
    const { agent, organizationId, path } = await createSite();
    respond(new AiProviderError("auth_error", false, "clave mala"));
    await agent.post(path).set(CSRF_HEADERS).send({ days: 7 }).expect(503);
    const status = await agent.get(`/api/v1/organizations/${organizationId}/ai/status`).expect(200);
    expect(status.body.quota.used).toBe(0);
  });
});
