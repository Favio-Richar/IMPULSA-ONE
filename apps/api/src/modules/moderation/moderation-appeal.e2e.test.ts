import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { moderationCaseListResponse, moderationCaseResponse } from "@impulza/contracts";
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
import { assignRoomyPlan } from "../../test-support/plans.js";
import { grantSuperAdmin } from "../admin/superadmin-grants.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F9.9c (ADR-028 §7) — aviso al propietario con motivo y vía de apelación; la apelación reabre el caso, la medida sigue
// vigente mientras se revisa y funciona aun con la organización suspendida.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@moderation-appeal-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const STATEMENT = "El sitio ofrece productos que no existen según la verificación del equipo.";
const APPEAL = "Los productos existen y tengo las facturas; pido que se revise la medida.";
type Agent = ReturnType<typeof request.agent>;

describe("Aviso y apelación de moderación (e2e) — F9.9c / ADR-028", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let http: Parameters<typeof request>[0];
  let admin: { agent: Agent; adminId: string };

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
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map((user) => user.id) } } });
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
      admin = { agent, adminId: res.body.admin.id as string };
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
    const org = await agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio Apelante", slug: unique("appeal-org") }).expect(201);
    const siteSlug = unique("appeal-site");
    const site = await agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF).send({ name: "Sitio Apelado", slug: siteSlug }).expect(201);
    return { email, agent, organizationId: org.body.id as string, siteId: site.body.id as string, siteSlug };
  }

  async function editorOf(b: { agent: Agent; organizationId: string }) {
    await assignRoomyPlan(prisma, b.organizationId);
    const email = await createUser();
    const agent = request.agent(http);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const invite = await b.agent.post(`/api/v1/organizations/${b.organizationId}/members`).set(CSRF).send({ email, role: "EDITOR" }).expect(201);
    await agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
    return agent;
  }

  const report = (b: { organizationId: string; siteId: string }) =>
    prisma.abuseReport.create({ data: { organizationId: b.organizationId, siteId: b.siteId, reason: "FRAUD", details: "DETALLE-SECRETO-DEL-REPORTE", reporterEmail: "denunciante@example.com" } });
  const act = (id: string, action: string, reason = STATEMENT) => admin.agent.post(`/api/v1/admin/abuse-reports/${id}/${action}`).set(CSRF).send({ reason });
  const casesUrl = (b: { organizationId: string }) => `/api/v1/organizations/${b.organizationId}/moderation/cases`;
  const siteStatus = async (slug: string) => (await request(http).get(`/api/v1/public/sites/${slug}`)).status;
  const mailTo = (email: string) => emailAdapter.messages.filter((message) => message.to === email);

  it("al despublicar, el propietario recibe motivo, explicación y vía de apelación, sin datos del reporte ni del denunciante", async () => {
    const b = await business();
    const r = await report(b);
    emailAdapter.messages = [];
    await act(r.id, "unpublish").expect(200);

    const mails = mailTo(b.email);
    expect(mails).toHaveLength(1);
    const text = mails[0]!.text ?? "";
    expect(mails[0]!.subject).toContain("despublicada");
    expect(text).toContain("Fraude o estafa");
    expect(text).toContain(STATEMENT);
    expect(text).toContain("/configuracion/moderacion");
    expect(text.toLowerCase()).toContain("apelar");
    expect(text).not.toContain("DETALLE-SECRETO-DEL-REPORTE");
    expect(text).not.toContain("denunciante@example.com");
  });

  it("descartar un reporte no avisa al propietario (no hubo medida)", async () => {
    const b = await business();
    const r = await report(b);
    emailAdapter.messages = [];
    await act(r.id, "dismiss").expect(200);
    expect(mailTo(b.email)).toHaveLength(0);
  });

  it("el propietario ve sus medidas con la explicación, y nada del reporte ni de quien denunció", async () => {
    const b = await business();
    const other = await business();
    const open = await report(b); // sin decisión: no aparece
    const decided = await report(b);
    await act(decided.id, "warn").expect(200);
    const foreign = await report(other);
    await act(foreign.id, "warn").expect(200);

    const res = await b.agent.get(casesUrl(b)).expect(200);
    moderationCaseListResponse.parse(res.body);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: decided.id, status: "WARNED", measure: "WARNED", statement: STATEMENT, canAppeal: true, reason: "FRAUD" });
    expect(Object.keys(res.body[0]).sort()).toEqual(
      ["appealText", "appealedAt", "canAppeal", "createdAt", "decidedAt", "id", "measure", "reason", "site", "statement", "status"].sort(),
    );
    expect(JSON.stringify(res.body)).not.toContain("DETALLE-SECRETO-DEL-REPORTE");
    expect(JSON.stringify(res.body)).not.toContain("denunciante@example.com");
    expect(open.status).toBe("OPEN");
  });

  it("apelar reabre el caso, la medida sigue vigente y el equipo ve el texto y la medida de origen", async () => {
    const b = await business();
    const r = await report(b);
    await act(r.id, "unpublish").expect(200);
    expect(await siteStatus(b.siteSlug)).toBe(404);

    const res = await b.agent.post(`${casesUrl(b)}/${r.id}/appeal`).set(CSRF).send({ text: APPEAL }).expect(200);
    moderationCaseResponse.parse(res.body);
    expect(res.body).toMatchObject({ status: "APPEALED", measure: "SITE_UNPUBLISHED", canAppeal: false, appealText: APPEAL });
    // Mientras se revisa, el sitio sigue sin mostrarse.
    expect(await siteStatus(b.siteSlug)).toBe(404);

    const detail = await admin.agent.get(`/api/v1/admin/abuse-reports/${r.id}`).expect(200);
    expect(detail.body).toMatchObject({ status: "APPEALED", appealedFrom: "SITE_UNPUBLISHED", appealText: APPEAL, availableActions: ["suspend", "restore", "uphold"] });
    const queue = await admin.agent.get(`/api/v1/admin/abuse-reports?organizationId=${b.organizationId}`).expect(200);
    expect(queue.body.items.map((item: { id: string }) => item.id)).toContain(r.id);

    const audit = await prisma.auditLog.findFirst({ where: { action: "moderation.appealed", targetId: r.id } });
    expect(audit?.actorId).not.toBeNull();
    expect(JSON.stringify(audit?.metadata)).not.toContain(APPEAL);

    // Una sola apelación por decisión.
    await b.agent.post(`${casesUrl(b)}/${r.id}/appeal`).set(CSRF).send({ text: APPEAL }).expect(409);
  });

  it("mantener la medida avisa al propietario y no admite una segunda apelación", async () => {
    const b = await business();
    const r = await report(b);
    await act(r.id, "unpublish").expect(200);
    await b.agent.post(`${casesUrl(b)}/${r.id}/appeal`).set(CSRF).send({ text: APPEAL }).expect(200);
    emailAdapter.messages = [];

    const held = await act(r.id, "uphold", "Verificamos que los productos no existen; la medida se mantiene.").expect(200);
    expect(held.body).toMatchObject({ status: "SITE_UNPUBLISHED", appealedFrom: null, availableActions: ["suspend", "restore"] });
    expect(await siteStatus(b.siteSlug)).toBe(404);
    expect(mailTo(b.email)[0]?.text).toContain("mantenemos la medida");

    const mine = await b.agent.get(casesUrl(b)).expect(200);
    expect(mine.body[0]).toMatchObject({ status: "SITE_UNPUBLISHED", canAppeal: false });
    await b.agent.post(`${casesUrl(b)}/${r.id}/appeal`).set(CSRF).send({ text: APPEAL }).expect(409);
    // `uphold` fuera de una apelación no procede.
    await act(r.id, "uphold").expect(409);
  });

  it("restaurar tras la apelación devuelve el sitio, cierra el caso y lo avisa", async () => {
    const b = await business();
    const r = await report(b);
    await act(r.id, "unpublish").expect(200);
    await b.agent.post(`${casesUrl(b)}/${r.id}/appeal`).set(CSRF).send({ text: APPEAL }).expect(200);
    emailAdapter.messages = [];

    // Con una medida que deshacer, «descartar» no está disponible: se restaura.
    await act(r.id, "dismiss").expect(409);
    const res = await act(r.id, "restore", "Apelación aceptada: la documentación respalda al negocio.").expect(200);
    expect(res.body).toMatchObject({ status: "DISMISSED", site: { hidden: false } });
    expect(await siteStatus(b.siteSlug)).toBe(200);
    expect(mailTo(b.email)[0]?.text).toContain("Retiramos la medida");

    const mine = await b.agent.get(casesUrl(b)).expect(200);
    expect(mine.body[0]).toMatchObject({ status: "DISMISSED", measure: null, appealText: APPEAL, canAppeal: false });
  });

  it("una organización suspendida puede apelar aunque su panel esté en solo lectura", async () => {
    const b = await business();
    const r = await report(b);
    await act(r.id, "suspend").expect(200);
    const write = await b.agent.post(`/api/v1/organizations/${b.organizationId}/sites`).set(CSRF).send({ name: "Otro", slug: unique("x") });
    expect(write.body.code).toBe("ORGANIZATION_BLOCKED");

    await b.agent.get(casesUrl(b)).expect(200);
    const res = await b.agent.post(`${casesUrl(b)}/${r.id}/appeal`).set(CSRF).send({ text: APPEAL }).expect(200);
    expect(res.body).toMatchObject({ status: "APPEALED", measure: "ORG_SUSPENDED" });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: b.organizationId } })).status).toBe(OrganizationStatus.BLOCKED);

    // El equipo restaura desde el estado «apelado»: la organización vuelve a estar activa.
    await act(r.id, "restore").expect(200);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: b.organizationId } })).status).toBe(OrganizationStatus.ACTIVE);
  });

  it("permisos y aislamiento: sin sesión 401, editor 403, otra organización 404, caso sin medida 409", async () => {
    const b = await business();
    const other = await business();
    const editor = await editorOf(b);
    const decided = await report(b);
    await act(decided.id, "warn").expect(200);
    const open = await report(b);

    await request(http).get(casesUrl(b)).expect(401);
    await editor.get(casesUrl(b)).expect(403);
    await editor.post(`${casesUrl(b)}/${decided.id}/appeal`).set(CSRF).send({ text: APPEAL }).expect(403);
    // Otra organización con su propio id en la URL no alcanza un caso ajeno.
    await other.agent.post(`${casesUrl(other)}/${decided.id}/appeal`).set(CSRF).send({ text: APPEAL }).expect(404);
    // Con el id de la organización ajena en la URL, la membresía lo niega.
    await other.agent.post(`${casesUrl(b)}/${decided.id}/appeal`).set(CSRF).send({ text: APPEAL }).expect(403);
    await b.agent.post(`${casesUrl(b)}/${open.id}/appeal`).set(CSRF).send({ text: APPEAL }).expect(409);
    await b.agent.post(`${casesUrl(b)}/no-es-uuid/appeal`).set(CSRF).send({ text: APPEAL }).expect(400);
    await b.agent.post(`${casesUrl(b)}/${decided.id}/appeal`).send({ text: APPEAL }).expect(403);
    expect((await prisma.abuseReport.findUniqueOrThrow({ where: { id: decided.id } })).status).toBe("WARNED");
  });

  it("valida y sanea el texto de la apelación en el servidor", async () => {
    const b = await business();
    const r = await report(b);
    await act(r.id, "warn").expect(200);
    await b.agent.post(`${casesUrl(b)}/${r.id}/appeal`).set(CSRF).send({ text: "corto" }).expect(400);
    await b.agent.post(`${casesUrl(b)}/${r.id}/appeal`).set(CSRF).send({ text: "a".repeat(1001) }).expect(400);
    await b.agent.post(`${casesUrl(b)}/${r.id}/appeal`).set(CSRF).send({ text: APPEAL, status: "DISMISSED" }).expect(400);
    const html = `<img src=x onerror="alert(1)"> ${APPEAL}${String.fromCharCode(0)}`;
    const res = await b.agent.post(`${casesUrl(b)}/${r.id}/appeal`).set(CSRF).send({ text: html }).expect(200);
    expect(res.body.appealText).toBe(`<img src=x onerror="alert(1)"> ${APPEAL}`);
  });

  it("dos apelaciones simultáneas: una prospera y la otra recibe 409", async () => {
    const b = await business();
    const r = await report(b);
    await act(r.id, "warn").expect(200);
    const results = await Promise.all([
      b.agent.post(`${casesUrl(b)}/${r.id}/appeal`).set(CSRF).send({ text: APPEAL }),
      b.agent.post(`${casesUrl(b)}/${r.id}/appeal`).set(CSRF).send({ text: APPEAL }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
  });
});
