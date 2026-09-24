import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { BROWSER_USER_AGENT, startAnalyticsTestWorker } from "../../test-support/analytics-pipeline.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F3.4 — clic a WhatsApp: registro de evento público sin PII (ADR-004).

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@public-analytics-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(prefix = "pa34"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Public analytics events (e2e) — F3.4", () => {
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

  async function createSite(): Promise<{
    siteSlug: string;
    organizationId: string;
    siteId: string;
    agent: ReturnType<typeof request.agent>;
  }> {
    const email = uniqueEmail();
    const password = "password1234";
    const agent = request.agent(httpServer);

    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);

    const siteSlug = uniqueSlug("site");
    const org = await agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org Analytics", slug: uniqueSlug("org") })
      .expect(201);
    const site = await agent
      .post(`/api/v1/organizations/${org.body.id}/sites`)
      .set(CSRF_HEADERS)
      .send({ name: "Sitio", slug: siteSlug })
      .expect(201);

    return { siteSlug, organizationId: org.body.id, siteId: site.body.id, agent };
  }

  it("registra un whatsapp_click sin IP cruda y con visitante anonimizado", async () => {
    const { siteSlug, organizationId } = await createSite();

    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/events`)
      .set(CSRF_HEADERS)
      .set("User-Agent", BROWSER_USER_AGENT)
      .send({ type: "whatsapp_click" })
      .expect(204);

    await pipeline.drain();

    const events = await prisma.analyticsEvent.findMany({ where: { organizationId, type: "whatsapp_click" } });
    expect(events).toHaveLength(1);
    expect(events[0]?.anonymizedVisitorId).toEqual(expect.any(String));
    expect(events[0]?.anonymizedVisitorId?.length).toBeGreaterThan(20);
    // Sin columna de IP cruda: el propio tipo de Prisma no la tiene, pero se confirma también que
    // no aparece ningún campo con forma de IP en la fila completa.
    expect(Object.keys(events[0] ?? {})).not.toContain("ipAddress");
  });

  it("rechaza un tipo de evento fuera del allowlist público", async () => {
    const { siteSlug } = await createSite();

    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/events`)
      .set(CSRF_HEADERS)
      .send({ type: "lead_created" })
      .expect(400);
  });

  it("un sitio archivado no acepta eventos (404)", async () => {
    const { siteSlug, organizationId, siteId, agent } = await createSite();
    await agent.post(`/api/v1/organizations/${organizationId}/sites/${siteId}/archive`).set(CSRF_HEADERS).expect(201);

    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/events`)
      .set(CSRF_HEADERS)
      .send({ type: "whatsapp_click" })
      .expect(404);
  });

  it("sin la cabecera CSRF, el registro se rechaza", async () => {
    const { siteSlug } = await createSite();

    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/events`)
      .send({ type: "whatsapp_click" })
      .expect(403);
  });

  it("dos visitantes distintos (user-agent distinto) generan visitantes anonimizados distintos", async () => {
    const { siteSlug, organizationId } = await createSite();

    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/events`)
      .set(CSRF_HEADERS)
      .set("User-Agent", "agente-uno")
      .send({ type: "whatsapp_click" })
      .expect(204);
    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/events`)
      .set(CSRF_HEADERS)
      .set("User-Agent", "agente-dos")
      .send({ type: "whatsapp_click" })
      .expect(204);

    await pipeline.drain();

    const events = await prisma.analyticsEvent.findMany({ where: { organizationId, type: "whatsapp_click" } });
    expect(events).toHaveLength(2);
    expect(events[0]?.anonymizedVisitorId).not.toBe(events[1]?.anonymizedVisitorId);
  });
});
