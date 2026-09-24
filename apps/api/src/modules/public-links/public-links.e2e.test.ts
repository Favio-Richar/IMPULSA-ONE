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

// F3.5 — resolución pública: enlace corto y QR cuentan su propio contador y su propio evento.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@public-links-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(prefix = "pl35"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Public links resolution (e2e) — F3.5", () => {
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

  async function createOrgWithOwner(): Promise<{
    organizationId: string;
    agent: ReturnType<typeof request.agent>;
  }> {
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
      .send({ name: "Org Resolución", slug: uniqueSlug("org") })
      .expect(201);

    return { organizationId: org.body.id, agent };
  }

  it("resuelve un enlace corto, incrementa su contador y registra short_link_click", async () => {
    const { agent, organizationId } = await createOrgWithOwner();
    const slug = uniqueSlug("s");
    await agent
      .post(`/api/v1/organizations/${organizationId}/short-links`)
      .set(CSRF_HEADERS)
      .send({ slug, destinationUrl: "https://ejemplo.cl/destino" })
      .expect(201);

    const resolved = await request(httpServer).get(`/api/v1/public/short-links/${slug}`).set("User-Agent", BROWSER_USER_AGENT).expect(200);
    expect(resolved.body).toEqual({ destinationUrl: "https://ejemplo.cl/destino" });

    const link = await prisma.shortLink.findUnique({ where: { slug } });
    expect(link?.clickCountCached).toBe(1);

    await pipeline.drain();

    const events = await prisma.analyticsEvent.findMany({ where: { organizationId, type: "short_link_click" } });
    expect(events).toHaveLength(1);
    expect(events[0]?.siteId).toBeNull();
  });

  it("un slug inexistente da 404", async () => {
    await request(httpServer).get("/api/v1/public/short-links/no-existe-nunca").expect(404);
  });

  it("resuelve un QR con URL directa, incrementa su propio contador y registra qr_visit", async () => {
    const { agent, organizationId } = await createOrgWithOwner();
    const qr = await agent
      .post(`/api/v1/organizations/${organizationId}/qr-codes`)
      .set(CSRF_HEADERS)
      .send({ directUrl: "https://ejemplo.cl/folleto", styleKey: "clasico" })
      .expect(201);

    const resolved = await request(httpServer).get(`/api/v1/public/qr/${qr.body.id}`).set("User-Agent", BROWSER_USER_AGENT).expect(200);
    expect(resolved.body).toEqual({ destinationUrl: "https://ejemplo.cl/folleto" });

    const stored = await prisma.qrCode.findUnique({ where: { id: qr.body.id } });
    expect(stored?.scanCountCached).toBe(1);

    await pipeline.drain();

    const events = await prisma.analyticsEvent.findMany({ where: { organizationId, type: "qr_visit" } });
    expect(events).toHaveLength(1);
  });

  it("resuelve un QR enlazado a un ShortLink usando el destino del enlace", async () => {
    const { agent, organizationId } = await createOrgWithOwner();
    const link = await agent
      .post(`/api/v1/organizations/${organizationId}/short-links`)
      .set(CSRF_HEADERS)
      .send({ slug: uniqueSlug("s"), destinationUrl: "https://ejemplo.cl/via-enlace" })
      .expect(201);
    const qr = await agent
      .post(`/api/v1/organizations/${organizationId}/qr-codes`)
      .set(CSRF_HEADERS)
      .send({ shortLinkId: link.body.id, styleKey: "clasico" })
      .expect(201);

    const resolved = await request(httpServer).get(`/api/v1/public/qr/${qr.body.id}`).set("User-Agent", BROWSER_USER_AGENT).expect(200);
    expect(resolved.body).toEqual({ destinationUrl: "https://ejemplo.cl/via-enlace" });

    // El escaneo cuenta para el QR, no para el enlace corto — son canales distintos.
    const storedLink = await prisma.shortLink.findUnique({ where: { id: link.body.id } });
    expect(storedLink?.clickCountCached).toBe(0);
  });
});
