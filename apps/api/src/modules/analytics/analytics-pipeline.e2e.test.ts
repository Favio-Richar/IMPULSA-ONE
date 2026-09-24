import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { processAnalyticsEvent, purgeExpiredAnalyticsEvents, VISITOR_PROXY_HEADERS } from "@impulza/analytics";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { BROWSER_USER_AGENT, startAnalyticsTestWorker } from "../../test-support/analytics-pipeline.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@analytics-pipeline-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Pipeline de analítica (e2e) — F3.6", () => {
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

  async function createPublishedSite() {
    const email = uniqueEmail();
    const password = "password1234";
    const agent = request.agent(httpServer);

    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);

    const org = await agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org Pipeline", slug: uniqueSlug("org") })
      .expect(201);
    const siteSlug = uniqueSlug("site");
    const site = await agent
      .post(`/api/v1/organizations/${org.body.id}/sites`)
      .set(CSRF_HEADERS)
      .send({ name: "Sitio", slug: siteSlug })
      .expect(201);

    const pagesPath = `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/pages`;
    const pages = await agent.get(pagesPath).expect(200);
    const home = pages.body[0] as { id: string; slug: string };

    const firstBlock = await agent
      .post(`${pagesPath}/${home.id}/blocks`)
      .set(CSRF_HEADERS)
      .send({ type: "link", config: { label: "Primero", url: "https://ejemplo.com/uno" } })
      .expect(201);
    const secondBlock = await agent
      .post(`${pagesPath}/${home.id}/blocks`)
      .set(CSRF_HEADERS)
      .send({ type: "link", config: { label: "Segundo", url: "https://ejemplo.com/dos" } })
      .expect(201);
    await agent.post(`${pagesPath}/${home.id}/publish`).set(CSRF_HEADERS).expect(201);

    return {
      agent,
      organizationId: org.body.id as string,
      siteId: site.body.id as string,
      siteSlug,
      home,
      blockIds: [firstBlock.body.id as string, secondBlock.body.id as string],
    };
  }

  function sendEvent(siteSlug: string, body: Record<string, unknown>, userAgent = BROWSER_USER_AGENT) {
    return request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/events`)
      .set(CSRF_HEADERS)
      .set("User-Agent", userAgent)
      .send(body);
  }

  async function aggregates(organizationId: string): Promise<Record<string, number>> {
    const rows = await prisma.analyticsAggregate.findMany({ where: { organizationId } });
    return Object.fromEntries(rows.map((row) => [row.metric, row.value]));
  }

  it("un page_view recorre endpoint → cola → worker y termina en evento crudo y agregados", async () => {
    const { siteSlug, organizationId, home } = await createPublishedSite();

    await sendEvent(siteSlug, {
      type: "page_view",
      pageSlug: home.slug,
      utm: { source: "instagram", campaign: "primavera" },
    }).expect(204);
    await pipeline.drain();

    const events = await prisma.analyticsEvent.findMany({ where: { organizationId, type: "page_view" } });
    expect(events).toHaveLength(1);
    expect(events[0]?.device).toBe("mobile");
    expect(events[0]?.anonymizedVisitorId).toMatch(/^[a-f0-9]{64}$/);

    expect(await aggregates(organizationId)).toMatchObject({
      page_view: 1,
      "page_view:visitors": 1,
      "page_view:device:mobile": 1,
      "page_view:utm_source:instagram": 1,
      "page_view:utm_campaign:primavera": 1,
      [`page_view:subject:${home.id}`]: 1,
    });
  });

  it("un bot conocido no genera AnalyticsEvent ni incrementa agregados (ADR-004 punto 2)", async () => {
    const { siteSlug, organizationId, home } = await createPublishedSite();

    // 204 igual: avisarle al bot que se lo descartó solo le enseña a disfrazarse.
    await sendEvent(siteSlug, { type: "page_view", pageSlug: home.slug }, GOOGLEBOT).expect(204);
    await sendEvent(siteSlug, { type: "page_view", pageSlug: home.slug }, "").expect(204);
    await pipeline.drain();

    expect(await prisma.analyticsEvent.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.analyticsAggregate.count({ where: { organizationId } })).toBe(0);
  });

  it("idempotencia: el mismo eventId entregado dos veces cuenta una sola vez", async () => {
    const { siteSlug, organizationId, home } = await createPublishedSite();
    const eventId = crypto.randomUUID();

    await sendEvent(siteSlug, { type: "page_view", pageSlug: home.slug, eventId }).expect(204);
    await pipeline.drain();
    await sendEvent(siteSlug, { type: "page_view", pageSlug: home.slug, eventId }).expect(204);
    await pipeline.drain();

    expect(await prisma.analyticsEvent.count({ where: { organizationId, type: "page_view" } })).toBe(1);
    expect((await aggregates(organizationId)).page_view).toBe(1);
  });

  it("idempotencia en el procesador: reintentar el mismo job no duplica evento ni agregado", async () => {
    const { organizationId, siteId } = await createPublishedSite();
    const job = {
      organizationId,
      siteId,
      type: "form_submit" as const,
      anonymizedVisitorId: null,
      device: null,
      geoCountry: null,
      geoCity: null,
      utm: null,
      subjectId: null,
      idempotencyKey: `form_submit:${crypto.randomUUID()}`,
      occurredAt: new Date().toISOString(),
    };

    expect(await processAnalyticsEvent(prisma, job)).toBe("recorded");
    expect(await processAnalyticsEvent(prisma, job)).toBe("duplicate");

    expect(await prisma.analyticsEvent.count({ where: { organizationId } })).toBe(1);
    expect((await aggregates(organizationId)).form_submit).toBe(1);
  });

  it("visitantes únicos: el mismo visitante dos veces suma vistas pero no visitantes", async () => {
    const { siteSlug, organizationId, home } = await createPublishedSite();

    await sendEvent(siteSlug, { type: "page_view", pageSlug: home.slug }).expect(204);
    await sendEvent(siteSlug, { type: "page_view", pageSlug: home.slug }).expect(204);
    await sendEvent(siteSlug, { type: "page_view", pageSlug: home.slug }, `${BROWSER_USER_AGENT} otro`).expect(204);
    await pipeline.drain();

    const metrics = await aggregates(organizationId);
    expect(metrics.page_view).toBe(3);
    expect(metrics["page_view:visitors"]).toBe(2);
  });

  it("atribuye un clic a su bloque por posición en la versión publicada, sin exponer ids", async () => {
    const { siteSlug, organizationId, home, blockIds } = await createPublishedSite();

    await sendEvent(siteSlug, { type: "block_click", pageSlug: home.slug, blockPosition: 1 }).expect(204);
    // Posición inexistente: cuenta en el total, pero no crea una fila de atribución inventada.
    await sendEvent(siteSlug, { type: "block_click", pageSlug: home.slug, blockPosition: 99 }).expect(204);
    await pipeline.drain();

    const metrics = await aggregates(organizationId);
    expect(metrics.block_click).toBe(2);
    expect(metrics[`block_click:subject:${blockIds[1]}`]).toBe(1);
    expect(Object.keys(metrics).filter((metric) => metric.startsWith("block_click:subject:"))).toHaveLength(1);
  });

  it("form_submit y lead_created nacen del servidor, una vez por envío y por lead nuevo", async () => {
    const { agent, siteSlug, organizationId, siteId } = await createPublishedSite();
    const form = await agent
      .post(`/api/v1/organizations/${organizationId}/sites/${siteId}/forms`)
      .set(CSRF_HEADERS)
      .send({
        name: "Contacto",
        fields: [
          { type: "EMAIL", label: "Correo", required: true },
          { type: "CONSENT", label: "Acepto ser contactado" },
        ],
      })
      .expect(201);
    const [emailField, consentField] = form.body.fields as Array<{ id: string }>;
    const email = `lead-${Date.now()}${TEST_EMAIL_DOMAIN}`;

    for (let i = 0; i < 2; i++) {
      await request(httpServer)
        .post(`/api/v1/public/sites/${siteSlug}/forms/${form.body.id}/submissions`)
        .set(CSRF_HEADERS)
        .set("User-Agent", BROWSER_USER_AGENT)
        .send({ [emailField!.id]: email, [consentField!.id]: true })
        .expect(201);
    }
    await pipeline.drain();

    const metrics = await aggregates(organizationId);
    expect(metrics.form_submit).toBe(2);
    // El segundo envío con el mismo correo es el mismo contacto: no es un lead nuevo.
    expect(metrics.lead_created).toBe(1);
    expect(metrics[`form_submit:subject:${form.body.id}`]).toBe(2);
  });

  it("el cliente no puede fabricar eventos de servidor como lead_created", async () => {
    const { siteSlug } = await createPublishedSite();
    await sendEvent(siteSlug, { type: "lead_created" }).expect(400);
    await sendEvent(siteSlug, { type: "form_submit" }).expect(400);
  });

  it("los agregados de nivel organización (sin sitio) se suman en una sola fila", async () => {
    const { agent, organizationId } = await createPublishedSite();
    const slug = uniqueSlug("enl");
    await agent
      .post(`/api/v1/organizations/${organizationId}/short-links`)
      .set(CSRF_HEADERS)
      .send({ slug, destinationUrl: "https://ejemplo.com" })
      .expect(201);

    for (let i = 0; i < 2; i++) {
      await request(httpServer).get(`/api/v1/public/short-links/${slug}`).set("User-Agent", BROWSER_USER_AGENT).expect(200);
    }
    // La vista previa automática de un chat: recibe el destino igual, pero no cuenta.
    await request(httpServer).get(`/api/v1/public/short-links/${slug}`).set("User-Agent", "WhatsApp/2.23.20.0").expect(200);
    await pipeline.drain();

    const rows = await prisma.analyticsAggregate.findMany({ where: { organizationId, metric: "short_link_click" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.siteId).toBeNull();
    expect(rows[0]?.value).toBe(2);
    const link = await prisma.shortLink.findUnique({ where: { slug } });
    expect(link?.clickCountCached).toBe(2);
  });

  it("aislamiento: los eventos de la organización B nunca aparecen en los agregados de A", async () => {
    const a = await createPublishedSite();
    const b = await createPublishedSite();

    await sendEvent(a.siteSlug, { type: "page_view", pageSlug: a.home.slug }).expect(204);
    for (let i = 0; i < 3; i++) {
      await sendEvent(b.siteSlug, { type: "page_view", pageSlug: b.home.slug }).expect(204);
    }
    await pipeline.drain();

    const rowsA = await prisma.analyticsAggregate.findMany({ where: { organizationId: a.organizationId } });
    expect(rowsA.every((row) => row.siteId === a.siteId)).toBe(true);
    expect((await aggregates(a.organizationId)).page_view).toBe(1);
    expect((await aggregates(b.organizationId)).page_view).toBe(3);
    expect(Object.keys(await aggregates(a.organizationId))).not.toContain(`page_view:subject:${b.home.id}`);
  });

  it("retención: el evento crudo vencido se purga y su agregado sobrevive (ADR-004 punto 4)", async () => {
    const { organizationId, siteId } = await createPublishedSite();
    const now = new Date("2026-09-23T12:00:00.000Z");
    const expired = new Date("2025-06-01T12:00:00.000Z"); // 15 meses antes
    const recent = new Date("2026-09-01T12:00:00.000Z");

    for (const occurredAt of [expired, recent]) {
      await processAnalyticsEvent(prisma, {
        organizationId,
        siteId,
        type: "page_view",
        anonymizedVisitorId: null,
        device: null,
        geoCountry: null,
        geoCity: null,
        utm: null,
        subjectId: null,
        idempotencyKey: null,
        occurredAt: occurredAt.toISOString(),
      });
    }

    await purgeExpiredAnalyticsEvents(prisma, { retentionMonths: 14, now, batchSize: 1 });

    const remaining = await prisma.analyticsEvent.findMany({ where: { organizationId } });
    expect(remaining.map((event) => event.createdAt.toISOString())).toEqual([recent.toISOString()]);
    const expiredAggregate = await prisma.analyticsAggregate.findFirst({
      where: { organizationId, period: "2025-06-01", metric: "page_view" },
    });
    expect(expiredAggregate?.value).toBe(1);
  });

  describe("datos del visitante reenviados por apps/web", () => {
    function viaProxy(siteSlug: string, visitorIp: string, secret: string) {
      return request(httpServer)
        .post(`/api/v1/public/sites/${siteSlug}/events`)
        .set(CSRF_HEADERS)
        .set(VISITOR_PROXY_HEADERS.secret, secret)
        .set(VISITOR_PROXY_HEADERS.ip, visitorIp)
        .set(VISITOR_PROXY_HEADERS.userAgent, BROWSER_USER_AGENT)
        .set(VISITOR_PROXY_HEADERS.country, "cl")
        .send({ type: "whatsapp_click" });
    }

    it("con el secreto, el rate limit cuenta por visitante real y no por el servidor de apps/web", async () => {
      const { siteSlug, organizationId } = await createPublishedSite();

      for (let i = 0; i < 60; i++) {
        await viaProxy(siteSlug, "203.0.113.10", env.INTERNAL_PROXY_SECRET).expect(204);
      }
      await viaProxy(siteSlug, "203.0.113.10", env.INTERNAL_PROXY_SECRET).expect(429);
      // Otro visitante detrás del mismo apps/web no queda bloqueado por el primero.
      await viaProxy(siteSlug, "203.0.113.20", env.INTERNAL_PROXY_SECRET).expect(204);
      await pipeline.drain();

      const event = await prisma.analyticsEvent.findFirst({ where: { organizationId, type: "whatsapp_click" } });
      expect(event?.geoCountry).toBe("CL");
    });

    it("sin el secreto correcto, las cabeceras se ignoran (no sirven para saltarse el rate limit)", async () => {
      const { siteSlug } = await createPublishedSite();

      for (let i = 0; i < 60; i++) {
        await viaProxy(siteSlug, `198.51.100.${i}`, "x".repeat(env.INTERNAL_PROXY_SECRET.length)).expect(204);
      }
      await viaProxy(siteSlug, "198.51.100.200", "secreto-inventado").expect(429);
    });
  });
});
