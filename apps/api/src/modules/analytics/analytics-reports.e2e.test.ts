import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { analyticsOverviewResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { BROWSER_USER_AGENT, startAnalyticsTestWorker } from "../../test-support/analytics-pipeline.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@analytics-reports-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function today(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe("Dashboard de conversión (e2e) — F3.7", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let httpServer: Parameters<typeof request>[0];
  let pipeline: ReturnType<typeof startAnalyticsTestWorker>;

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();

    httpServer = app.getHttpServer();
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
    pipeline = startAnalyticsTestWorker(prisma);
  });

  afterAll(async () => {
    await pipeline.drain();
    await pipeline.close();
    await prisma.organization.deleteMany({
      where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } },
    });
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

  /** Una organización con un sitio publicado de dos bloques y actividad real pasada por el
   *  pipeline completo (endpoint → cola → worker). */
  async function organizationWithActivity(visits: number) {
    const email = `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
    const password = "password1234";
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);

    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org", slug: uniqueSlug("org") }).expect(201);
    const siteSlug = uniqueSlug("site");
    const site = await agent
      .post(`/api/v1/organizations/${org.body.id}/sites`)
      .set(CSRF_HEADERS)
      .send({ name: "Sitio Demo", slug: siteSlug })
      .expect(201);
    const pagesPath = `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/pages`;
    const home = (await agent.get(pagesPath).expect(200)).body[0] as { id: string; slug: string };
    const block = await agent
      .post(`${pagesPath}/${home.id}/blocks`)
      .set(CSRF_HEADERS)
      .send({ type: "link", config: { label: "Ver catálogo", url: "https://ejemplo.com" } })
      .expect(201);
    await agent.post(`${pagesPath}/${home.id}/publish`).set(CSRF_HEADERS).expect(201);

    for (let i = 0; i < visits; i++) {
      await request(httpServer)
        .post(`/api/v1/public/sites/${siteSlug}/events`)
        .set(CSRF_HEADERS)
        .set("User-Agent", `${BROWSER_USER_AGENT} visitante-${i}`)
        .send({ type: "page_view", pageSlug: home.slug, utm: { source: "instagram" } })
        .expect(204);
    }
    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/events`)
      .set(CSRF_HEADERS)
      .set("User-Agent", BROWSER_USER_AGENT)
      .send({ type: "block_click", pageSlug: home.slug, blockPosition: 0 })
      .expect(204);
    await pipeline.drain();

    return {
      agent,
      organizationId: org.body.id as string,
      siteId: site.body.id as string,
      homeId: home.id,
      blockId: block.body.id as string,
    };
  }

  function overviewPath(organizationId: string, query: Record<string, string>): string {
    return `/api/v1/organizations/${organizationId}/analytics/overview?${new URLSearchParams(query).toString()}`;
  }

  it("devuelve totales, serie sin huecos, embudo y rankings con nombres resueltos", async () => {
    const { agent, organizationId, homeId, blockId } = await organizationWithActivity(3);

    const response = await agent.get(overviewPath(organizationId, { from: today(-6), to: today() })).expect(200);
    const body = analyticsOverviewResponse.parse(response.body);

    expect(body.totals.pageViews).toBe(3);
    expect(body.totals.visitors).toBe(3);
    expect(body.totals.blockClicks).toBe(1);
    expect(body.conversionRate).toBe(0);
    // Siete días pedidos, siete puntos — aunque seis valgan cero.
    expect(body.series).toHaveLength(7);
    expect(body.series.at(-1)?.pageViews).toBe(3);
    expect(body.series.slice(0, 6).every((point) => point.pageViews === 0)).toBe(true);
    expect(body.funnel.map((step) => step.value)).toEqual([3, 1, 0, 0]);
    expect(body.devices).toEqual([{ key: "mobile", label: "Móvil", value: 3 }]);
    expect(body.utmSources).toEqual([{ key: "instagram", label: "instagram", value: 3 }]);
    expect(body.topPages[0]).toMatchObject({ id: homeId, label: "Inicio", value: 3, deleted: false });
    expect(body.topBlocks[0]).toMatchObject({ id: blockId, label: "Ver catálogo", kind: "link", value: 1 });
  });

  it("sin actividad en el rango, todo en cero y la tasa de conversión nula (no 0 %)", async () => {
    const { agent, organizationId } = await organizationWithActivity(0);
    // Plan con cupo: enero de 2025 queda fuera de los 30 días de historial de Gratis.
    await assignRoomyPlan(prisma, organizationId);

    const response = await agent.get(overviewPath(organizationId, { from: "2025-01-01", to: "2025-01-31" })).expect(200);
    const body = analyticsOverviewResponse.parse(response.body);
    expect(body.totals.pageViews).toBe(0);
    expect(body.conversionRate).toBeNull();
    expect(body.series).toHaveLength(31);
  });

  it("el historial visible depende del plan (F4.3): Gratis ve 30 días, más atrás es 402", async () => {
    const { agent, organizationId } = await organizationWithActivity(0);

    await agent.get(overviewPath(organizationId, { from: today(-29), to: today() })).expect(200);
    const response = await agent.get(overviewPath(organizationId, { from: today(-89), to: today() })).expect(402);
    expect(response.body).toMatchObject({
      code: "PLAN_LIMIT_REACHED",
      limit: { key: "analyticsHistoryDays", max: 30, used: 90 },
    });

    await assignRoomyPlan(prisma, organizationId);
    await agent.get(overviewPath(organizationId, { from: today(-89), to: today() })).expect(200);
  });

  it("valida el rango de fechas en el servidor", async () => {
    const { agent, organizationId } = await organizationWithActivity(0);

    await agent.get(overviewPath(organizationId, { from: today(), to: today(-1) })).expect(400);
    await agent.get(overviewPath(organizationId, { from: "2024-01-01", to: "2025-12-31" })).expect(400);
    await agent.get(overviewPath(organizationId, { from: "ayer", to: today() })).expect(400);
    await agent.get(overviewPath(organizationId, { to: today() })).expect(400);
  });

  describe("aislamiento multi-tenant (ADR-002)", () => {
    it("los datos de B no aparecen en el resumen de A", async () => {
      const a = await organizationWithActivity(1);
      await organizationWithActivity(4);

      const body = analyticsOverviewResponse.parse(
        (await a.agent.get(overviewPath(a.organizationId, { from: today(-1), to: today() })).expect(200)).body,
      );
      expect(body.totals.pageViews).toBe(1);
      expect(body.topPages.map((page) => page.id)).toEqual([a.homeId]);
    });

    it("un siteId de otra organización en la query devuelve 404, sin datos", async () => {
      const a = await organizationWithActivity(0);
      const b = await organizationWithActivity(2);

      const response = await a.agent
        .get(overviewPath(a.organizationId, { from: today(-1), to: today(), siteId: b.siteId }))
        .expect(404);
      expect(JSON.stringify(response.body)).not.toContain(b.homeId);
    });

    it("el resumen de otra organización no es alcanzable cambiando el id de la ruta", async () => {
      const a = await organizationWithActivity(0);
      const b = await organizationWithActivity(2);

      const response = await a.agent.get(overviewPath(b.organizationId, { from: today(-1), to: today() }));
      expect([403, 404]).toContain(response.status);
      expect(JSON.stringify(response.body)).not.toContain(b.homeId);
    });

    it("sin sesión, 401", async () => {
      const a = await organizationWithActivity(0);
      await request(httpServer).get(overviewPath(a.organizationId, { from: today(-1), to: today() })).expect(401);
    });
  });

  it("filtrar por sitio conserva los enlaces cortos, que son de toda la organización", async () => {
    const { agent, organizationId, siteId } = await organizationWithActivity(1);
    const slug = uniqueSlug("enl");
    await agent
      .post(`/api/v1/organizations/${organizationId}/short-links`)
      .set(CSRF_HEADERS)
      .send({ slug, destinationUrl: "https://ejemplo.com" })
      .expect(201);
    await request(httpServer).get(`/api/v1/public/short-links/${slug}`).set("User-Agent", BROWSER_USER_AGENT).expect(200);
    await pipeline.drain();

    const body = analyticsOverviewResponse.parse(
      (await agent.get(overviewPath(organizationId, { from: today(-1), to: today(), siteId })).expect(200)).body,
    );
    expect(body.siteId).toBe(siteId);
    expect(body.totals.pageViews).toBe(1);
    expect(body.totals.shortLinkClicks).toBe(1);
    expect(body.shortLinks[0]).toMatchObject({ label: `/s/${slug}`, value: 1 });
  });
});
