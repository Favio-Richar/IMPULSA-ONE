import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { publicSiteResponse, siteMeasurementResponse } from "@impulza/contracts";
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
import { RevalidateWebService } from "../public-sites/revalidate-web.service.js";

// F7.1 (ADR-016) — GA4 y píxel de Meta por sitio: solo identificadores validados, permisos,
// auditoría sin valores, página pública actualizada y aislamiento entre organizaciones.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

class RecordingRevalidate {
  sites: string[] = [];
  async revalidateSite(siteId: string): Promise<void> {
    this.sites.push(siteId);
  }
}

const TEST_EMAIL_DOMAIN = "@site-measurement-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Medición de terceros del sitio (e2e) — F7.1, ADR-016", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let revalidate: RecordingRevalidate;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    revalidate = new RecordingRevalidate();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(RevalidateWebService)
      .useValue(revalidate)
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

  async function siteOf() {
    const owner = await loggedIn();
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio", slug: unique("org") }).expect(201);
    await assignRoomyPlan(prisma, org.body.id);
    const slug = unique("sitio");
    const site = await owner.agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF).send({ name: "Mi negocio", slug }).expect(201);
    return {
      owner: owner.agent,
      organizationId: org.body.id as string,
      siteId: site.body.id as string,
      slug,
      base: `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/measurement`,
    };
  }

  async function member(owner: ReturnType<typeof request.agent>, organizationId: string, role: string) {
    const user = await loggedIn();
    const invite = await owner.post(`/api/v1/organizations/${organizationId}/members`).set(CSRF).send({ email: user.email, role }).expect(201);
    await user.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
    return user.agent;
  }

  it("guarda los identificadores normalizados, actualiza la página pública y los quita con null", async () => {
    const s = await siteOf();
    expect(siteMeasurementResponse.parse((await s.owner.get(s.base).expect(200)).body)).toEqual({ ga4MeasurementId: null, metaPixelId: null });

    revalidate.sites = [];
    const saved = siteMeasurementResponse.parse((await s.owner.put(s.base).set(CSRF).send({ ga4MeasurementId: "g-ab12cd34ef", metaPixelId: "1234567890123456" }).expect(200)).body);
    expect(saved).toEqual({ ga4MeasurementId: "G-AB12CD34EF", metaPixelId: "1234567890123456" });
    expect(revalidate.sites).toEqual([s.siteId]);

    const publicSite = publicSiteResponse.parse((await request(httpServer).get(`/api/v1/public/sites/${s.slug}`).expect(200)).body);
    expect(publicSite.measurement).toEqual({ ga4MeasurementId: "G-AB12CD34EF", metaPixelId: "1234567890123456" });

    await s.owner.put(s.base).set(CSRF).send({ ga4MeasurementId: null, metaPixelId: "1234567890123456" }).expect(200);
    const after = publicSiteResponse.parse((await request(httpServer).get(`/api/v1/public/sites/${s.slug}`).expect(200)).body);
    expect(after.measurement).toEqual({ ga4MeasurementId: null, metaPixelId: "1234567890123456" });
  });

  it("valida en el servidor: nunca código, URLs ni formatos ajenos", async () => {
    const s = await siteOf();
    const bad = [
      { ga4MeasurementId: "<script>alert(1)</script>", metaPixelId: null },
      { ga4MeasurementId: "UA-1234567-1", metaPixelId: null },
      { ga4MeasurementId: "https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF", metaPixelId: null },
      { ga4MeasurementId: null, metaPixelId: "fbq('init', '1234567890')" },
      { ga4MeasurementId: null, metaPixelId: "123" },
      { ga4MeasurementId: "G-AB12CD34EF" },
      {},
    ];
    for (const body of bad) {
      await s.owner.put(s.base).set(CSRF).send(body).expect(400);
    }
    expect(siteMeasurementResponse.parse((await s.owner.get(s.base).expect(200)).body)).toEqual({ ga4MeasurementId: null, metaPixelId: null });
  });

  it("queda auditado sin los valores; un EDITOR lo configura, un ANALYST solo lo mira", async () => {
    const s = await siteOf();
    await s.owner.put(s.base).set(CSRF).send({ ga4MeasurementId: "G-AB12CD34EF", metaPixelId: null }).expect(200);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: s.organizationId, action: "site.measurement_changed", targetId: s.siteId } });
    expect(log.metadata).toEqual({ ga4: { before: false, after: true }, metaPixel: { before: false, after: false } });
    expect(JSON.stringify(log.metadata)).not.toContain("AB12CD34EF");

    const editor = await member(s.owner, s.organizationId, "EDITOR");
    await editor.put(s.base).set(CSRF).send({ ga4MeasurementId: "G-ZZ99YY88", metaPixelId: null }).expect(200);
    const analyst = await member(s.owner, s.organizationId, "ANALYST");
    await analyst.get(s.base).expect(200);
    await analyst.put(s.base).set(CSRF).send({ ga4MeasurementId: null, metaPixelId: null }).expect(403);
  });

  it("aislamiento (ADR-002): otra organización no lee ni cambia la medición ajena", async () => {
    const a = await siteOf();
    const b = await siteOf();
    await b.owner.put(b.base).set(CSRF).send({ ga4MeasurementId: "G-BBBB1111", metaPixelId: null }).expect(200);
    await a.owner.get(b.base).expect(403);
    await a.owner.put(b.base).set(CSRF).send({ ga4MeasurementId: "G-AAAA2222", metaPixelId: null }).expect(403);
    const crossed = `/api/v1/organizations/${a.organizationId}/sites/${b.siteId}/measurement`;
    await a.owner.get(crossed).expect(404);
    await a.owner.put(crossed).set(CSRF).send({ ga4MeasurementId: "G-AAAA2222", metaPixelId: null }).expect(404);
    expect((await prisma.site.findUniqueOrThrow({ where: { id: b.siteId } })).ga4MeasurementId).toBe("G-BBBB1111");
  });
});
