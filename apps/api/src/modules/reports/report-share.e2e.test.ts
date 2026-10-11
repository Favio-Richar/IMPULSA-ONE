import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { createdReportShareLinkResponse, publicReportResponse, reportShareLinkResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { MAX_ACTIVE_SHARE_LINKS, hashShareToken } from "./report-share.service.js";

// F9.8b (ADR-028 §6) — enlace compartido del informe: token que no se guarda, solo lectura, vence, se revoca, sin datos personales y sin
// cruzarse entre organizaciones.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@report-share-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;
interface Person {
  email: string;
  userId: string;
  agent: Agent;
}

function day(offset: number): string {
  return new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

describe("Enlace compartido del informe (e2e) — F9.8b / ADR-028", () => {
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

  async function person(label = "u"): Promise<Person> {
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
    const email = `${unique(label)}${DOMAIN}`;
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(http);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { email, userId: user.id, agent };
  }

  async function business(name = "Negocio Compartido") {
    const owner = await person("owner");
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name, slug: unique("share-e2e") }).expect(201);
    const orgId = org.body.id as string;
    await assignRoomyPlan(prisma, orgId);
    const site = await owner.agent.post(`/api/v1/organizations/${orgId}/sites`).set(CSRF).send({ name: "Sitio", slug: unique("share-e2e-s") }).expect(201);
    await prisma.analyticsAggregate.create({ data: { organizationId: orgId, siteId: site.body.id, period: day(-1), metric: "page_view", value: 123 } });
    const base = `/api/v1/organizations/${orgId}/reports`;
    return { owner, orgId, base, links: `${base}/share-links` };
  }

  const create = (w: Awaited<ReturnType<typeof business>>, body: object = {}) =>
    w.owner.agent.post(w.links).set(CSRF).send({ from: day(-6), to: day(0), ...body });

  it("crea un enlace: el token viaja una vez, no se guarda y la lista no lo trae", async () => {
    const w = await business();
    const created = await create(w, { label: "Octubre", expiresInDays: 7 }).expect(201);
    createdReportShareLinkResponse.parse(created.body);
    expect(created.headers["cache-control"]).toBe("no-store");
    const token = created.body.token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.body).toMatchObject({ label: "Octubre", active: true, period: { from: day(-6), to: day(0) }, accessCount: 0 });

    // En la base solo está el hash.
    const row = await prisma.reportShareLink.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.tokenHash).toBe(hashShareToken(token));
    expect(JSON.stringify(row)).not.toContain(token);

    const list = await w.owner.agent.get(w.links).expect(200);
    list.body.forEach((item: unknown) => reportShareLinkResponse.parse(item));
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(JSON.stringify(list.body)).not.toContain(row.tokenHash);

    // Ni la auditoría lleva el token ni su hash.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: w.orgId, action: "report.share_created" } });
    expect(JSON.stringify(audit.metadata)).not.toContain(token);
    expect(JSON.stringify(audit.metadata)).not.toContain(row.tokenHash);
  });

  it("quien abre el enlace ve el informe del periodo fijado, con la marca, sin sesión y sin datos personales", async () => {
    const w = await business("Café Compartido");
    await prisma.contact.create({ data: { organizationId: w.orgId, name: "Ana Pérez", email: "ana.perez@example.test", phone: "+56911112222" } });
    const created = await create(w).expect(201);
    const token = created.body.token as string;

    const res = await request(http).get(`/api/v1/public/reports/${token}`).expect(200);
    publicReportResponse.parse(res.body);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-robots-tag"]).toContain("noindex");
    const views = (res.body.report.metrics as Array<{ key: string; value: number }>).find((item) => item.key === "pageViews")!;
    expect(views.value).toBe(123);
    expect(res.body.report.period).toEqual({ from: day(-6), to: day(0) });
    expect(res.body.brand.displayName).toBe("Café Compartido");
    // Cifras agregadas: ni el contacto, ni ids internos de la organización o del enlace.
    const text = JSON.stringify(res.body);
    for (const secret of ["ana.perez@example.test", "+56911112222", "Ana Pérez", w.orgId, created.body.id]) {
      expect(text).not.toContain(secret);
    }

    const csv = await request(http).get(`/api/v1/public/reports/${token}/csv`).expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("Visitas;123;");
    expect(csv.text).not.toContain("ana.perez@example.test");

    const row = await prisma.reportShareLink.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.accessCount).toBe(1);
    expect(row.lastAccessedAt).not.toBeNull();
  });

  it("un enlace desconocido o mal formado responde 404; uno vencido o revocado, 410", async () => {
    const w = await business();
    const created = await create(w).expect(201);
    const token = created.body.token as string;
    const urls = (value: string) => [`/api/v1/public/reports/${value}`, `/api/v1/public/reports/${value}/csv`];

    for (const bad of ["A".repeat(43), "corto", "../../etc/passwd", `${token}x`, token.slice(0, 42)]) {
      for (const url of urls(encodeURIComponent(bad))) await request(http).get(url).expect(404);
    }

    // Vencido.
    await prisma.reportShareLink.update({ where: { id: created.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    for (const url of urls(token)) {
      const res = await request(http).get(url).expect(410);
      expect(res.body.code).toBe("LINK_EXPIRED");
    }
    const listed = await w.owner.agent.get(w.links).expect(200);
    expect(listed.body[0].active).toBe(false);

    // Revocado (un enlace nuevo, revocado por la API).
    const second = await create(w).expect(201);
    await request(http).get(`/api/v1/public/reports/${second.body.token}`).expect(200);
    const revoked = await w.owner.agent.delete(`${w.links}/${second.body.id}`).set(CSRF).expect(200);
    expect(revoked.body).toMatchObject({ active: false });
    expect(revoked.body.revokedAt).not.toBeNull();
    for (const url of urls(second.body.token)) {
      const res = await request(http).get(url).expect(410);
      expect(res.body.code).toBe("LINK_REVOKED");
    }
    // Revocar dos veces es inofensivo.
    await w.owner.agent.delete(`${w.links}/${second.body.id}`).set(CSRF).expect(200);
    expect(await prisma.auditLog.count({ where: { organizationId: w.orgId, action: "report.share_revoked" } })).toBe(1);
  });

  it("el enlace de un cliente no sirve datos de otro, y nadie ajeno lo lista, crea ni revoca", async () => {
    const a = await business("Negocio A");
    const b = await business("Negocio B");
    await prisma.analyticsAggregate.deleteMany({ where: { organizationId: b.orgId } });
    await prisma.analyticsAggregate.create({ data: { organizationId: b.orgId, siteId: (await prisma.site.findFirstOrThrow({ where: { organizationId: b.orgId } })).id, period: day(-1), metric: "page_view", value: 9999 } });
    const linkA = await create(a).expect(201);

    const served = await request(http).get(`/api/v1/public/reports/${linkA.body.token}`).expect(200);
    const views = (served.body.report.metrics as Array<{ key: string; value: number }>).find((item) => item.key === "pageViews")!;
    expect(views.value).toBe(123);
    expect(JSON.stringify(served.body)).not.toContain("9999");

    // B no ve, no crea ni revoca nada de A (por la ruta de A: 403; por la propia: 404).
    await b.owner.agent.get(a.links).expect(403);
    await b.owner.agent.post(a.links).set(CSRF).send({ from: day(-6), to: day(0) }).expect(403);
    await b.owner.agent.delete(`${a.links}/${linkA.body.id}`).set(CSRF).expect(403);
    await b.owner.agent.delete(`${b.links}/${linkA.body.id}`).set(CSRF).expect(404);
    expect((await b.owner.agent.get(b.links).expect(200)).body).toEqual([]);
    expect((await prisma.reportShareLink.findUniqueOrThrow({ where: { id: linkA.body.id } })).revokedAt).toBeNull();
  });

  it("valida el periodo y el vencimiento, respeta el plan y el permiso, y limita los enlaces vigentes", async () => {
    const w = await business();
    await create(w, { expiresInDays: 0 }).expect(400);
    await create(w, { expiresInDays: 91 }).expect(400);
    await create(w, { from: day(0), to: day(-5) }).expect(400);
    await create(w, { label: "x".repeat(81) }).expect(400);

    // Sin permiso: un analista no comparte.
    const analyst = await person("analista");
    const invite = await w.owner.agent.post(`/api/v1/organizations/${w.orgId}/members`).set(CSRF).send({ email: analyst.email, role: "ANALYST" }).expect(201);
    await analyst.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
    await analyst.agent.post(w.links).set(CSRF).send({ from: day(-6), to: day(0) }).expect(403);
    await analyst.agent.get(w.links).expect(403);
    await request(http).get(w.links).expect(401);

    // Tope de enlaces vigentes (se limpia el límite de peticiones: aquí se prueba el tope, no la tasa).
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
    for (let index = 0; index < MAX_ACTIVE_SHARE_LINKS; index += 1) await create(w).expect(201);
    expect((await create(w).expect(409)).body.code).toBe("SHARE_LINK_LIMIT");

    // Un periodo fuera del historial del plan (Gratis: 30 días) responde 402 como el informe.
    const free = await business("Negocio Gratis");
    await prisma.organization.update({ where: { id: free.orgId }, data: { planId: null } });
    await create(free, { from: day(-90), to: day(-80) }).expect(402);
  });

  it("una organización bloqueada o con su sitio oculto deja de servir sus enlaces", async () => {
    const w = await business();
    const created = await create(w).expect(201);
    const url = `/api/v1/public/reports/${created.body.token}`;
    await request(http).get(url).expect(200);

    await prisma.organization.update({ where: { id: w.orgId }, data: { status: "BLOCKED", blockedAt: new Date(), blockedReason: "prueba" } });
    await request(http).get(url).expect(404);
    await prisma.organization.update({ where: { id: w.orgId }, data: { status: "ACTIVE", blockedAt: null, blockedReason: null, publicHiddenAt: new Date() } });
    await request(http).get(url).expect(404);
    await prisma.organization.update({ where: { id: w.orgId }, data: { publicHiddenAt: null } });
    await request(http).get(url).expect(200);
  });
});
