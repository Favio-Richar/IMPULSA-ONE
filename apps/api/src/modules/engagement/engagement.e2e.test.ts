import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { processAnalyticsEvent, VISITOR_PROXY_HEADERS } from "@impulza/analytics";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { publicEngagementResponse, siteEngagementResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F10 — vistas y «me gusta» públicos de cada página: el contador de vistas lo suma el procesador de analítica en la misma
// transacción que el evento; el «me gusta» es uno por visitante y página, sin guardar la IP.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@engagement-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

describe("Vistas y «me gusta» (e2e) — F10", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let http: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EMAIL_ADAPTER).useValue(emailAdapter).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  async function business(options: { publish?: boolean } = {}) {
    const email = `${unique("owner")}${DOMAIN}`;
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(http);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const org = await agent.post("/api/v1/organizations").set(CSRF).send({ name: "Portal", slug: unique("eng-org") }).expect(201);
    const organizationId = org.body.id as string;
    const siteSlug = unique("eng-site");
    const site = await agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Portal", slug: siteSlug }).expect(201);
    const siteId = site.body.id as string;
    const pagesPath = `/api/v1/organizations/${organizationId}/sites/${siteId}/pages`;
    const home = (await agent.get(pagesPath).expect(200)).body[0] as { id: string; slug: string };
    await agent.post(`${pagesPath}/${home.id}/blocks`).set(CSRF).send({ type: "engagement", config: {} }).expect(201);
    if (options.publish !== false) await agent.post(`${pagesPath}/${home.id}/publish`).set(CSRF).expect(201);
    return { agent, organizationId, siteId, siteSlug, pageId: home.id, pageSlug: home.slug, url: `/api/v1/public/sites/${siteSlug}/pages/${home.slug}/engagement` };
  }

  const asVisitor = (method: "get" | "put" | "delete", url: string, ip: string) =>
    request(http)[method](url).set(CSRF).set(VISITOR_PROXY_HEADERS.secret, env.INTERNAL_PROXY_SECRET).set(VISITOR_PROXY_HEADERS.ip, ip);

  it("el bloque se guarda con sus valores por defecto", async () => {
    const b = await business();
    const blocks = (await b.agent.get(`/api/v1/organizations/${b.organizationId}/sites/${b.siteId}/pages/${b.pageId}/blocks`).expect(200)).body as Array<{ type: string; config: unknown }>;
    expect(blocks.find((block) => block.type === "engagement")?.config).toEqual({ showViews: true, showLikes: true, likeLabel: "Me gusta" });
  });

  it("parte en cero, suma un «me gusta» por visitante y no cuenta dos veces al mismo", async () => {
    const b = await business();
    expect(publicEngagementResponse.parse((await asVisitor("get", b.url, "198.51.100.1").expect(200)).body)).toEqual({ views: 0, likes: 0, liked: false });

    const first = await asVisitor("put", b.url, "198.51.100.1").expect(200);
    expect(publicEngagementResponse.parse(first.body)).toMatchObject({ likes: 1, liked: true });
    // Repetirlo (o dos a la vez) no suma.
    await Promise.all([asVisitor("put", b.url, "198.51.100.1"), asVisitor("put", b.url, "198.51.100.1"), asVisitor("put", b.url, "198.51.100.1")]);
    expect(publicEngagementResponse.parse((await asVisitor("get", b.url, "198.51.100.1").expect(200)).body)).toMatchObject({ likes: 1, liked: true });

    // Otro visitante suma y ve que él todavía no.
    await asVisitor("put", b.url, "198.51.100.2").expect(200);
    expect(publicEngagementResponse.parse((await asVisitor("get", b.url, "198.51.100.3").expect(200)).body)).toMatchObject({ likes: 2, liked: false });

    // Quitar el suyo baja uno y es idempotente.
    expect(publicEngagementResponse.parse((await asVisitor("delete", b.url, "198.51.100.1").expect(200)).body)).toMatchObject({ likes: 1, liked: false });
    expect(publicEngagementResponse.parse((await asVisitor("delete", b.url, "198.51.100.1").expect(200)).body)).toMatchObject({ likes: 1, liked: false });

    // De la IP del visitante no queda rastro en la base.
    const stored = await prisma.pageLike.findMany({ where: { pageId: b.pageId } });
    expect(JSON.stringify(stored)).not.toContain("198.51.100");
    expect(response(stored)).toBe(1);
  });

  it("las vistas las suma el procesador de analítica en la misma transacción, una vez por evento", async () => {
    const b = await business();
    const job = {
      type: "page_view" as const,
      organizationId: b.organizationId,
      siteId: b.siteId,
      subjectId: b.pageId,
      anonymizedVisitorId: "visitante-1",
      device: "desktop" as const,
      geoCountry: "CL",
      geoCity: null,
      utm: null,
      occurredAt: new Date().toISOString(),
      idempotencyKey: unique("view"),
    };
    expect(await processAnalyticsEvent(prisma, job)).toBe("recorded");
    // El mismo evento reintentado no vuelve a contar.
    expect(await processAnalyticsEvent(prisma, job)).toBe("duplicate");
    await processAnalyticsEvent(prisma, { ...job, idempotencyKey: unique("view"), anonymizedVisitorId: "visitante-2" });
    // Un id de página que no es de este sitio no crea ni suma ningún contador.
    await processAnalyticsEvent(prisma, { ...job, idempotencyKey: unique("view"), subjectId: "00000000-0000-4000-8000-000000000000" });

    expect(publicEngagementResponse.parse((await asVisitor("get", b.url, "198.51.100.9").expect(200)).body)).toMatchObject({ views: 2 });
  });

  it("un borrador o una página inexistente no revelan nada (404) y no admiten «me gusta»", async () => {
    const b = await business({ publish: false });
    await asVisitor("get", b.url, "198.51.100.20").expect(404);
    await asVisitor("put", b.url, "198.51.100.20").expect(404);
    await asVisitor("get", `/api/v1/public/sites/${b.siteSlug}/pages/no-existe/engagement`, "198.51.100.20").expect(404);
    await asVisitor("get", `/api/v1/public/sites/sitio-que-no-existe/pages/${b.pageSlug}/engagement`, "198.51.100.20").expect(404);
    expect(await prisma.pageLike.count({ where: { pageId: b.pageId } })).toBe(0);
  });

  it("exige la cabecera anti-CSRF y no se cachea", async () => {
    const b = await business();
    await request(http).put(b.url).expect(403);
    const res = await asVisitor("get", b.url, "198.51.100.30").expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("el panel ve las cifras de cada página de su sitio y nadie las ve de otra organización", async () => {
    const mine = await business();
    await asVisitor("put", mine.url, "198.51.100.40").expect(200);
    const res = await mine.agent.get(`/api/v1/organizations/${mine.organizationId}/sites/${mine.siteId}/engagement`).expect(200);
    const body = siteEngagementResponse.parse(res.body);
    expect(body.totals).toEqual({ views: 0, likes: 1 });
    expect(body.pages.find((page) => page.pageId === mine.pageId)).toMatchObject({ isHome: true, likes: 1 });

    const other = await business();
    // Mi sesión no puede pedir el sitio de otra organización, ni con su id ni con la mía.
    await mine.agent.get(`/api/v1/organizations/${other.organizationId}/sites/${other.siteId}/engagement`).expect(403);
    await mine.agent.get(`/api/v1/organizations/${mine.organizationId}/sites/${other.siteId}/engagement`).expect(404);
  });
});

function response(rows: unknown[]): number {
  return rows.length;
}
