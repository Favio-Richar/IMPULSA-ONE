import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { VISITOR_PROXY_HEADERS } from "@impulza/analytics";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { abuseReportAckResponse } from "@impulza/contracts";
import { AbuseReportStatus, OrganizationStatus, type PrismaClient } from "@impulza/database";
import { ABUSE_REPORT_OPEN_PER_SITE_MAX } from "@impulza/validation";
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

// F9.9a (ADR-028 §7) — reporte público de abuso: catálogo cerrado, texto plano, sin datos del denunciante más allá de lo
// necesario, límite por IP, una vez por visitante y sitio, tope por sitio y NUNCA una despublicación automática.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@abuse-reports-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

describe("Reporte público de abuso (e2e) — F9.9a / ADR-028", () => {
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
    const keys = [...(await redis.keys("ratelimit:*")), ...(await redis.keys("abuse-report:*"))];
    if (keys.length > 0) await redis.del(...keys);
  });

  async function publishedSite() {
    const email = `${unique("owner")}${DOMAIN}`;
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(http);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const org = await agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio Reportado", slug: unique("abuse-org") }).expect(201);
    const siteSlug = unique("abuse-site");
    const site = await agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF).send({ name: "Sitio", slug: siteSlug }).expect(201);
    return { agent, organizationId: org.body.id as string, siteId: site.body.id as string, siteSlug, url: `/api/v1/public/sites/${siteSlug}/abuse-reports` };
  }

  /** Un visitante distinto: la IP real llega por la cabecera de confianza que reenvía `apps/web`. */
  function asVisitor(url: string, ip: string) {
    return request(http)
      .post(url)
      .set(CSRF)
      .set(VISITOR_PROXY_HEADERS.secret, env.INTERNAL_PROXY_SECRET)
      .set(VISITOR_PROXY_HEADERS.ip, ip);
  }

  it("guarda el reporte con motivo, sitio y organización, y responde solo «recibido»", async () => {
    const s = await publishedSite();
    const res = await asVisitor(s.url, "203.0.113.10").send({ reason: "SPAM", details: "  Vende cosas que no existen.  ", email: "Persona@Correo.com" }).expect(201);
    expect(abuseReportAckResponse.parse(res.body)).toEqual({ received: true });

    const rows = await prisma.abuseReport.findMany({ where: { siteId: s.siteId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: s.organizationId,
      reason: "SPAM",
      details: "Vende cosas que no existen.",
      reporterEmail: "persona@correo.com",
      status: AbuseReportStatus.OPEN,
      resolution: null,
    });
    // Del denunciante no hay IP ni agente en ningún campo.
    expect(JSON.stringify(rows[0])).not.toContain("203.0.113.10");
  });

  it("funciona sin texto ni correo: no exige datos personales", async () => {
    const s = await publishedSite();
    await asVisitor(s.url, "203.0.113.11").send({ reason: "FRAUD" }).expect(201);
    const row = await prisma.abuseReport.findFirstOrThrow({ where: { siteId: s.siteId } });
    expect(row.details).toBeNull();
    expect(row.reporterEmail).toBeNull();
  });

  it("valida en el servidor: motivo fuera del catálogo, «otro» sin explicación, texto largo, campos extra y sin cabecera anti-CSRF", async () => {
    const s = await publishedSite();
    await asVisitor(s.url, "203.0.113.101").send({ reason: "ODIO" }).expect(400);
    await asVisitor(s.url, "203.0.113.102").send({}).expect(400);
    await asVisitor(s.url, "203.0.113.103").send({ reason: "OTHER" }).expect(400);
    await asVisitor(s.url, "203.0.113.104").send({ reason: "SPAM", details: "a".repeat(501) }).expect(400);
    await asVisitor(s.url, "203.0.113.105").send({ reason: "SPAM", email: "no-es-correo" }).expect(400);
    await asVisitor(s.url, "203.0.113.106").send({ reason: "SPAM", siteId: "otro", status: "DISMISSED" }).expect(400);
    await request(http).post(s.url).send({ reason: "SPAM" }).expect(403);
    expect(await prisma.abuseReport.count({ where: { siteId: s.siteId } })).toBe(0);
  });

  it("guarda el texto como texto plano: sin HTML interpretado y sin caracteres de control", async () => {
    const s = await publishedSite();
    const dirty = `<img src=x onerror="alert(1)">${String.fromCharCode(0)}${String.fromCharCode(0x202e)} fin`;
    await asVisitor(s.url, "203.0.113.13").send({ reason: "OTHER", details: dirty }).expect(201);
    const row = await prisma.abuseReport.findFirstOrThrow({ where: { siteId: s.siteId } });
    expect(row.details).toBe('<img src=x onerror="alert(1)"> fin');
  });

  it("un sitio que no se sirve responde 404 igual que uno inexistente: archivado, organización bloqueada, despublicado por moderación", async () => {
    await asVisitor("/api/v1/public/sites/no-existe-jamas/abuse-reports", "203.0.113.14").send({ reason: "SPAM" }).expect(404);

    const archived = await publishedSite();
    await prisma.site.update({ where: { id: archived.siteId }, data: { status: "ARCHIVED" } });
    await asVisitor(archived.url, "203.0.113.14").send({ reason: "SPAM" }).expect(404);

    const blocked = await publishedSite();
    await prisma.organization.update({ where: { id: blocked.organizationId }, data: { status: OrganizationStatus.BLOCKED } });
    await asVisitor(blocked.url, "203.0.113.14").send({ reason: "SPAM" }).expect(404);

    const hidden = await publishedSite();
    await prisma.site.update({ where: { id: hidden.siteId }, data: { moderationHiddenAt: new Date() } });
    await asVisitor(hidden.url, "203.0.113.14").send({ reason: "SPAM" }).expect(404);

    expect(await prisma.abuseReport.count({ where: { siteId: { in: [archived.siteId, blocked.siteId, hidden.siteId] } } })).toBe(0);
  });

  it("el mismo visitante no inunda: el segundo reporte del mismo sitio se confirma pero no se guarda; otro visitante sí cuenta", async () => {
    const s = await publishedSite();
    await asVisitor(s.url, "203.0.113.20").send({ reason: "SPAM" }).expect(201);
    const again = await asVisitor(s.url, "203.0.113.20").send({ reason: "FRAUD", details: "otra vez" }).expect(201);
    expect(again.body).toEqual({ received: true });
    expect(await prisma.abuseReport.count({ where: { siteId: s.siteId } })).toBe(1);

    await asVisitor(s.url, "203.0.113.21").send({ reason: "SPAM" }).expect(201);
    expect(await prisma.abuseReport.count({ where: { siteId: s.siteId } })).toBe(2);
  });

  it("límite de tasa por IP: la sexta petición en la ventana responde 429", async () => {
    const s = await publishedSite();
    for (let i = 0; i < 5; i += 1) {
      await asVisitor(s.url, "203.0.113.30").send({ reason: "SPAM" }).expect(201);
    }
    await asVisitor(s.url, "203.0.113.30").send({ reason: "SPAM" }).expect(429);
    // Otra IP no queda afectada.
    await asVisitor(s.url, "203.0.113.31").send({ reason: "SPAM" }).expect(201);
  });

  it("un sitio con muchos reportes abiertos deja de guardar más, y nunca se despublica solo", async () => {
    const s = await publishedSite();
    await prisma.abuseReport.createMany({
      data: Array.from({ length: ABUSE_REPORT_OPEN_PER_SITE_MAX }, () => ({ organizationId: s.organizationId, siteId: s.siteId, reason: "SPAM" as const })),
    });

    await asVisitor(s.url, "203.0.113.40").send({ reason: "FRAUD" }).expect(201);
    expect(await prisma.abuseReport.count({ where: { siteId: s.siteId } })).toBe(ABUSE_REPORT_OPEN_PER_SITE_MAX);

    // Con cientos de reportes sigue publicado y activo: la decisión es siempre de una persona.
    const site = await prisma.site.findUniqueOrThrow({ where: { id: s.siteId }, include: { organization: true } });
    expect(site.moderationHiddenAt).toBeNull();
    expect(site.status).not.toBe("ARCHIVED");
    expect(site.organization.status).toBe(OrganizationStatus.ACTIVE);
    await request(http).get(`/api/v1/public/sites/${s.siteSlug}`).expect((res) => expect(res.status).not.toBe(404));
  });

  it("la marca de repetición vence y no contiene la IP del visitante", async () => {
    const s = await publishedSite();
    await asVisitor(s.url, "203.0.113.50").send({ reason: "SPAM" }).expect(201);
    const keys = await redis.keys(`abuse-report:seen:${s.siteId}:*`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("203.0.113.50");
    const ttl = await redis.ttl(keys[0] as string);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);
  });
});
