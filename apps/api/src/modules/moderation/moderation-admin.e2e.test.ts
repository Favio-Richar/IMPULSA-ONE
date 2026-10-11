import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { adminAbuseReportDetailResponse, adminAbuseReportListResponse } from "@impulza/contracts";
import { OrganizationStatus, type PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import { generate } from "otplib";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { grantSuperAdmin } from "../admin/superadmin-grants.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F9.9b (ADR-028 §7) — cola de moderación: solo superadministración, acciones con motivo, auditadas y reversibles.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@moderation-admin-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const REASON = "Contenido verificado por el equipo.";

describe("Cola de moderación (e2e) — F9.9b / ADR-028", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let http: Parameters<typeof request>[0];
  let admin: { agent: ReturnType<typeof request.agent>; adminId: string; email: string };

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
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const ids = users.map((user) => user.id);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    const keys = [...(await redis.keys("ratelimit:*")), ...(await redis.keys("admin-totp-used:*"))];
    if (keys.length > 0) await redis.del(...keys);
    if (!admin) {
      const email = await createUser();
      const grant = await grantSuperAdmin(prisma, email, env.AUTH_ENCRYPTION_KEY);
      const agent = request.agent(http);
      const code = await generate({ secret: grant.twoFactorEnrollment!.secret });
      const res = await agent.post("/api/v1/admin/auth/login").set(CSRF).send({ email, password: PASSWORD, code }).expect(201);
      admin = { agent, adminId: res.body.admin.id as string, email };
    }
  });

  async function createUser(): Promise<string> {
    const email = `${unique("user")}${DOMAIN}`;
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    return email;
  }

  async function business() {
    const email = await createUser();
    const agent = request.agent(http);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const org = await agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio Moderado", slug: unique("mod-org") }).expect(201);
    const siteSlug = unique("mod-site");
    const site = await agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF).send({ name: "Sitio", slug: siteSlug }).expect(201);
    return { agent, organizationId: org.body.id as string, siteId: site.body.id as string, siteSlug };
  }

  async function report(b: { organizationId: string; siteId: string }, extra: Record<string, unknown> = {}) {
    return prisma.abuseReport.create({ data: { organizationId: b.organizationId, siteId: b.siteId, reason: "FRAUD", details: "Detalle", reporterEmail: "denunciante@example.com", ...extra } });
  }

  const act = (id: string, action: string, body: Record<string, unknown> = { reason: REASON }) =>
    admin.agent.post(`/api/v1/admin/abuse-reports/${id}/${action}`).set(CSRF).send(body);
  const siteStatus = async (slug: string) => (await request(http).get(`/api/v1/public/sites/${slug}`)).status;

  it("solo superadministración entra: sin sesión de administración, todo es 401 (incluida una sesión de usuario común)", async () => {
    const b = await business();
    const r = await report(b);
    await request(http).get("/api/v1/admin/abuse-reports").expect(401);
    await b.agent.get("/api/v1/admin/abuse-reports").expect(401);
    await b.agent.get(`/api/v1/admin/abuse-reports/${r.id}`).expect(401);
    await b.agent.post(`/api/v1/admin/abuse-reports/${r.id}/unpublish`).set(CSRF).send({ reason: REASON }).expect(401);
    expect((await prisma.abuseReport.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("OPEN");
  });

  it("la cola prioriza al sitio con más reportes abiertos, filtra y pagina", async () => {
    const hot = await business();
    const calm = await business();
    for (let i = 0; i < 3; i += 1) await report(hot, { reason: "SPAM" });
    const single = await report(calm, { reason: "FRAUD" });

    const res = await admin.agent.get(`/api/v1/admin/abuse-reports?organizationId=${hot.organizationId}&sort=priority`).expect(200);
    adminAbuseReportListResponse.parse(res.body);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items.every((item: { siteOpenReports: number }) => item.siteOpenReports === 3)).toBe(true);
    expect(res.body.queueSize).toBeGreaterThanOrEqual(4);

    const both = await admin.agent.get("/api/v1/admin/abuse-reports?pageSize=100&sort=priority").expect(200);
    const ours = both.body.items.filter((item: { site: { id: string } }) => [hot.siteId, calm.siteId].includes(item.site.id));
    expect(ours.map((item: { site: { id: string } }) => item.site.id)).toEqual([hot.siteId, hot.siteId, hot.siteId, calm.siteId]);

    const byReason = await admin.agent.get(`/api/v1/admin/abuse-reports?siteId=${hot.siteId}&reason=FRAUD`).expect(200);
    expect(byReason.body.items).toHaveLength(0);
    const page = await admin.agent.get(`/api/v1/admin/abuse-reports?organizationId=${hot.organizationId}&pageSize=2&page=2`).expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBe(3);
    expect(single.status).toBe("OPEN");
    await admin.agent.get("/api/v1/admin/abuse-reports?pageSize=500").expect(400);
    await admin.agent.get("/api/v1/admin/abuse-reports?status=BORRADO").expect(400);
  });

  it("abrir un reporte muestra el correo del denunciante y queda auditado; el historial no lleva esa lectura", async () => {
    const b = await business();
    const r = await report(b);
    const res = await admin.agent.get(`/api/v1/admin/abuse-reports/${r.id}`).expect(200);
    adminAbuseReportDetailResponse.parse(res.body);
    expect(res.body.reporterEmail).toBe("denunciante@example.com");
    expect(res.body.availableActions).toEqual(["dismiss", "warn", "unpublish", "suspend"]);
    expect(res.body.history).toEqual([]);
    const audit = await prisma.auditLog.findMany({ where: { action: "admin.abuse_report_viewed", targetId: r.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(admin.adminId);
    await admin.agent.get("/api/v1/admin/abuse-reports/00000000-0000-4000-8000-000000000000").expect(404);
    await admin.agent.get("/api/v1/admin/abuse-reports/no-es-uuid").expect(400);
  });

  it("toda acción exige motivo; descartar cierra el caso, queda auditado y no se repite", async () => {
    const b = await business();
    const r = await report(b);
    await act(r.id, "dismiss", {}).expect(400);
    await act(r.id, "dismiss", { reason: "ok" }).expect(400);
    await request(http).post(`/api/v1/admin/abuse-reports/${r.id}/dismiss`).send({ reason: REASON }).expect(403);

    const res = await act(r.id, "dismiss").expect(200);
    expect(res.body).toMatchObject({ status: "DISMISSED", resolution: REASON, availableActions: [] });
    expect(res.body.history[0]).toMatchObject({ action: "admin.abuse_report_dismiss", actorEmail: admin.email, reason: REASON });
    await act(r.id, "dismiss").expect(409);
    await act(r.id, "unpublish").expect(409);
    expect(await siteStatus(b.siteSlug)).toBe(200);
  });

  it("advertir no toca el sitio; despublicar lo apaga y restaurar lo vuelve a servir", async () => {
    const b = await business();
    expect(await siteStatus(b.siteSlug)).toBe(200);
    const warned = await report(b);
    await act(warned.id, "warn").expect(200);
    expect(await siteStatus(b.siteSlug)).toBe(200);

    const r = await report(b);
    const res = await act(r.id, "unpublish").expect(200);
    expect(res.body).toMatchObject({ status: "SITE_UNPUBLISHED", site: { hidden: true } });
    expect(await siteStatus(b.siteSlug)).toBe(404);
    // El propietario conserva su sitio y su contenido: no se borró nada ni se archivó.
    const site = await prisma.site.findUniqueOrThrow({ where: { id: b.siteId } });
    expect(site.status).not.toBe("ARCHIVED");
    await b.agent.get(`/api/v1/organizations/${b.organizationId}/sites/${b.siteId}`).expect(200);

    const restored = await act(r.id, "restore", { reason: "Apelación aceptada: el contenido es legítimo." }).expect(200);
    expect(restored.body).toMatchObject({ status: "DISMISSED", site: { hidden: false } });
    expect(await siteStatus(b.siteSlug)).toBe(200);
    const actions = (await prisma.auditLog.findMany({ where: { targetId: r.id }, orderBy: { createdAt: "asc" } })).map((entry) => entry.action);
    expect(actions).toEqual(["admin.abuse_report_unpublish", "admin.abuse_report_restore"]);
  });

  it("dos reportes sobre el mismo sitio: restaurar uno no lo reabre mientras el otro siga vigente", async () => {
    const b = await business();
    const first = await report(b);
    const second = await report(b);
    await act(first.id, "unpublish").expect(200);
    await act(second.id, "unpublish").expect(200);
    await act(first.id, "restore").expect(200);
    expect(await siteStatus(b.siteSlug)).toBe(404);
    await act(second.id, "restore").expect(200);
    expect(await siteStatus(b.siteSlug)).toBe(200);
  });

  it("suspender bloquea la organización (panel en solo lectura) y restaurar la devuelve; no suspende dos veces", async () => {
    const b = await business();
    const r = await report(b);
    const res = await act(r.id, "suspend").expect(200);
    expect(res.body).toMatchObject({ status: "ORG_SUSPENDED", organization: { blocked: true } });
    expect(await siteStatus(b.siteSlug)).toBe(404);
    const write = await b.agent.post(`/api/v1/organizations/${b.organizationId}/sites`).set(CSRF).send({ name: "Otro", slug: unique("x") });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe("ORGANIZATION_BLOCKED");
    await b.agent.get(`/api/v1/organizations/${b.organizationId}/sites/${b.siteId}`).expect(200);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: b.organizationId } });
    expect(org.blockedReason).toContain(r.id);

    await act(r.id, "restore").expect(200);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: b.organizationId } })).status).toBe(OrganizationStatus.ACTIVE);
    expect(await siteStatus(b.siteSlug)).toBe(200);

    // Una organización ya bloqueada por otra vía: no se suspende ni se registra un cambio de estado.
    const other = await report(b);
    await prisma.organization.update({ where: { id: b.organizationId }, data: { status: OrganizationStatus.BLOCKED } });
    await act(other.id, "suspend").expect(409);
    expect((await prisma.abuseReport.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("OPEN");
  });

  it("dos decisiones simultáneas sobre el mismo reporte: una gana, la otra recibe 409 y no deja efectos a medias", async () => {
    const b = await business();
    const r = await report(b);
    const results = await Promise.all([act(r.id, "dismiss"), act(r.id, "unpublish")]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const final = await prisma.abuseReport.findUniqueOrThrow({ where: { id: r.id } });
    const site = await prisma.site.findUniqueOrThrow({ where: { id: b.siteId } });
    // El sitio está oculto si y solo si el caso quedó con la despublicación vigente.
    expect(site.moderationHiddenAt !== null).toBe(final.status === "SITE_UNPUBLISHED");
  });

  it("si el efecto falla, la decisión no queda registrada (se deshace la reclamación)", async () => {
    const b = await business();
    const r = await report(b);
    await prisma.organization.update({ where: { id: b.organizationId }, data: { status: OrganizationStatus.BLOCKED } });
    await act(r.id, "suspend").expect(409);
    const after = await prisma.abuseReport.findUniqueOrThrow({ where: { id: r.id } });
    expect(after).toMatchObject({ status: "OPEN", resolution: null, resolvedById: null, resolvedAt: null });
    expect(await prisma.auditLog.count({ where: { targetId: r.id, action: "admin.abuse_report_suspend" } })).toBe(0);
  });

  it("nada despublica solo: la cola no cambia el estado del sitio por tener muchos reportes", async () => {
    const b = await business();
    for (let i = 0; i < 5; i += 1) await report(b);
    await admin.agent.get(`/api/v1/admin/abuse-reports?siteId=${b.siteId}`).expect(200);
    expect(await siteStatus(b.siteSlug)).toBe(200);
  });
});
