import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { memberSessionResponse, publicPageResponse, siteMemberListResponse, siteMemberResponse } from "@impulza/contracts";
import { OrganizationStatus, type PrismaClient } from "@impulza/database";
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
import { hashMemberToken } from "./members.service.js";

// F10.1 (ADR-029) — miembros de sitio y contenido protegido: el contenido de una página «solo miembros» no sale sin sesión,
// el enlace es de un solo uso, y cortar a un miembro surte efecto en el acto.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@members-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const SECRET = "SECRETO-SOLO-PARA-MIEMBROS";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;

describe("Miembros de sitio y contenido protegido (e2e) — F10.1 / ADR-029", () => {
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
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map((user) => user.id) } } });
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    const keys = [...(await redis.keys("ratelimit:*")), ...(await redis.keys("member-access:*"))];
    if (keys.length > 0) await redis.del(...keys);
  });

  async function person(label: string): Promise<{ email: string; agent: Agent }> {
    const email = `${unique(label)}${DOMAIN}`;
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(http);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    return { email, agent };
  }

  /** Negocio con un sitio publicado cuya página de inicio tiene un bloque con un texto secreto. */
  async function business() {
    const owner = await person("owner");
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio Miembros", slug: unique("mem-org") }).expect(201);
    const organizationId = org.body.id as string;
    await assignRoomyPlan(prisma, organizationId);
    const siteSlug = unique("mem-site");
    const site = await owner.agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Sitio Miembros", slug: siteSlug }).expect(201);
    const siteId = site.body.id as string;
    const pagesPath = `/api/v1/organizations/${organizationId}/sites/${siteId}/pages`;
    const pages = await owner.agent.get(pagesPath).expect(200);
    const home = pages.body[0] as { id: string; slug: string };
    await owner.agent
      .post(`${pagesPath}/${home.id}/blocks`)
      .set(CSRF)
      .send({ type: "text", config: { html: `<p>${SECRET}</p>`, alignment: "left" } })
      .expect(201);
    await owner.agent.post(`${pagesPath}/${home.id}/publish`).set(CSRF).expect(201);
    return {
      owner,
      organizationId,
      siteId,
      siteSlug,
      pageId: home.id,
      pageSlug: home.slug,
      members: `/api/v1/organizations/${organizationId}/sites/${siteId}/members`,
    };
  }

  const publicPage = (b: { siteSlug: string; pageSlug: string }) => request(http).get(`/api/v1/public/sites/${b.siteSlug}/pages/${b.pageSlug}`);
  const memberPage = (b: { siteSlug: string; pageSlug: string }, session?: string) => {
    const call = request(http).get(`/api/v1/public/sites/${b.siteSlug}/members/pages/${b.pageSlug}`);
    return session ? call.set("x-member-session", session) : call;
  };
  const askAccess = (siteSlug: string, email: string) => request(http).post(`/api/v1/public/sites/${siteSlug}/members/access`).set(CSRF).send({ email });
  const verify = (token: string) => request(http).post("/api/v1/public/members/verify").set(CSRF).send({ token });

  async function mailFor(email: string, since = 0): Promise<{ token: string; text: string }> {
    for (let i = 0; i < 40; i += 1) {
      const message = emailAdapter.messages.slice(since).find((item) => item.to === email);
      const token = /\/miembros\/([A-Za-z0-9_-]{43})/.exec(message?.text ?? "")?.[1];
      if (message && token) return { token, text: message.text ?? "" };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`No llegó el enlace de acceso a ${email}`);
  }

  async function withMember(b: Awaited<ReturnType<typeof business>>) {
    const email = `${unique("miembro")}${DOMAIN}`;
    const created = await b.owner.agent.post(b.members).set(CSRF).send({ email, name: "Ana Miembro" }).expect(201);
    const { token } = await mailFor(email);
    const session = await verify(token).expect(200);
    return { email, memberId: created.body.id as string, sessionToken: session.body.sessionToken as string, loginToken: token };
  }

  it("una página solo para miembros no entrega su contenido en la respuesta pública, ni en el SEO ni en el menú", async () => {
    const b = await business();
    const open = await publicPage(b).expect(200);
    expect(JSON.stringify(open.body)).toContain(SECRET);

    await b.owner.agent.put(`${b.members}/pages/${b.pageId}`).set(CSRF).send({ enabled: true }).expect(200);

    const gated = await publicPage(b).expect(200);
    publicPageResponse.parse(gated.body);
    expect(gated.body).toMatchObject({ membersOnly: true, blocks: [] });
    expect(gated.body.seo.robots).toBe("noindex_nofollow");
    expect(JSON.stringify(gated.body)).not.toContain(SECRET);
    // El menú la lista (los miembros la buscan ahí), marcada, para que el sitemap la excluya.
    const site = await request(http).get(`/api/v1/public/sites/${b.siteSlug}`).expect(200);
    expect(site.body.pages.find((page: { slug: string }) => page.slug === b.pageSlug)).toMatchObject({ membersOnly: true });

    // Quitarlo la vuelve pública sin republicar.
    await b.owner.agent.put(`${b.members}/pages/${b.pageId}`).set(CSRF).send({ enabled: false }).expect(200);
    expect(JSON.stringify((await publicPage(b).expect(200)).body)).toContain(SECRET);
  });

  it("el contenido solo sale por la ruta de miembros y con una sesión válida de ESE sitio", async () => {
    const b = await business();
    await b.owner.agent.put(`${b.members}/pages/${b.pageId}`).set(CSRF).send({ enabled: true }).expect(200);
    const member = await withMember(b);

    await memberPage(b).expect(401);
    await memberPage(b, "no-es-una-sesion").expect(401);
    await memberPage(b, "A".repeat(43)).expect(401);
    // El token del enlace NO es una sesión.
    await memberPage(b, member.loginToken).expect(401);

    const ok = await memberPage(b, member.sessionToken).expect(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(ok.body)).toContain(SECRET);

    // La sesión de un sitio no sirve en otro sitio.
    const other = await business();
    await other.owner.agent.put(`${other.members}/pages/${other.pageId}`).set(CSRF).send({ enabled: true }).expect(200);
    await memberPage(other, member.sessionToken).expect(401);

    const me = await request(http).get(`/api/v1/public/sites/${b.siteSlug}/members/me`).set("x-member-session", member.sessionToken).expect(200);
    expect(me.body).toEqual({ email: member.email, name: "Ana Miembro" });
  });

  it("pedir acceso responde igual para cualquiera y solo un miembro activo recibe enlace", async () => {
    const b = await business();
    const known = `${unique("conocido")}${DOMAIN}`;
    await b.owner.agent.post(b.members).set(CSRF).send({ email: known, sendAccess: false }).expect(201);
    emailAdapter.messages = [];

    const a = await askAccess(b.siteSlug, known).expect(200);
    const u = await askAccess(b.siteSlug, `${unique("desconocido")}${DOMAIN}`).expect(200);
    expect(a.body).toEqual({ sent: true });
    expect(u.body).toEqual(a.body);

    await mailFor(known);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(emailAdapter.messages.filter((m) => m.to?.includes("desconocido"))).toHaveLength(0);
    await askAccess(b.siteSlug, "no-es-correo").expect(400);
    await request(http).post(`/api/v1/public/sites/no-existe-jamas/members/access`).set(CSRF).send({ email: known }).expect(404);
  });

  it("el enlace es de un solo uso, vence, y no se guarda en claro", async () => {
    const b = await business();
    const email = `${unique("uso")}${DOMAIN}`;
    await b.owner.agent.post(b.members).set(CSRF).send({ email }).expect(201);
    const { token, text } = await mailFor(email);
    expect(text).toContain("Vence en 15 minutos");

    const row = await prisma.siteMemberLoginToken.findFirstOrThrow({ where: { member: { email, siteId: b.siteId } } });
    expect(row.tokenHash).toBe(hashMemberToken(token));
    expect(row.tokenHash).not.toContain(token);

    const first = await verify(token).expect(200);
    memberSessionResponse.parse(first.body);
    expect(first.body.siteSlug).toBe(b.siteSlug);
    const stored = await prisma.siteMemberSession.findFirstOrThrow({ where: { member: { email, siteId: b.siteId } } });
    expect(stored.tokenHash).toBe(hashMemberToken(first.body.sessionToken));

    await verify(token).expect(401); // ya usado

    // Vencido.
    await askAccess(b.siteSlug, email).expect(200);
    const second = await mailFor(email, 1);
    await prisma.siteMemberLoginToken.updateMany({ where: { tokenHash: hashMemberToken(second.token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await verify(second.token).expect(401);

    // Formas inválidas ni se consultan.
    await verify("corto").expect(400);
    await verify("A".repeat(43)).expect(401);
  });

  it("dos canjes simultáneos del mismo enlace: solo uno entra", async () => {
    const b = await business();
    const email = `${unique("carrera")}${DOMAIN}`;
    await b.owner.agent.post(b.members).set(CSRF).send({ email }).expect(201);
    const { token } = await mailFor(email);
    const results = await Promise.all([verify(token), verify(token)]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 401]);
  });

  it("revocar corta el acceso en el acto: sesión, enlaces pendientes y nuevos pedidos", async () => {
    const b = await business();
    await b.owner.agent.put(`${b.members}/pages/${b.pageId}`).set(CSRF).send({ enabled: true }).expect(200);
    const member = await withMember(b);
    await memberPage(b, member.sessionToken).expect(200);

    // Un enlace pendiente que aún no se canjeó.
    await askAccess(b.siteSlug, member.email).expect(200);
    const pending = await mailFor(member.email, emailAdapter.messages.length - 1);

    await b.owner.agent.post(`${b.members}/${member.memberId}/revoke`).set(CSRF).expect(200);
    await memberPage(b, member.sessionToken).expect(401);
    await verify(pending.token).expect(401);
    emailAdapter.messages = [];
    await askAccess(b.siteSlug, member.email).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(emailAdapter.messages.filter((m) => m.to === member.email)).toHaveLength(0);

    // Reactivarlo no resucita la sesión anterior: pide un enlace nuevo.
    await b.owner.agent.post(`${b.members}/${member.memberId}/restore`).set(CSRF).expect(200);
    await memberPage(b, member.sessionToken).expect(401);
    await askAccess(b.siteSlug, member.email).expect(200);
    const again = await mailFor(member.email);
    const fresh = await verify(again.token).expect(200);
    await memberPage(b, fresh.body.sessionToken).expect(200);
  });

  it("defensa en profundidad: un miembro que deja de estar activo pierde la sesión aunque nadie la haya revocado", async () => {
    const b = await business();
    await b.owner.agent.put(`${b.members}/pages/${b.pageId}`).set(CSRF).send({ enabled: true }).expect(200);
    const member = await withMember(b);
    await memberPage(b, member.sessionToken).expect(200);
    // Directo en la base: ni la API ni la revocación de sesiones intervienen.
    await prisma.siteMember.update({ where: { id: member.memberId }, data: { status: "REVOKED" } });
    await memberPage(b, member.sessionToken).expect(401);
    // Y una sesión vencida tampoco sirve.
    await prisma.siteMember.update({ where: { id: member.memberId }, data: { status: "ACTIVE" } });
    await memberPage(b, member.sessionToken).expect(200);
    await prisma.siteMemberSession.updateMany({ where: { memberId: member.memberId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await memberPage(b, member.sessionToken).expect(401);
  });

  it("cerrar sesión la revoca del lado del servidor", async () => {
    const b = await business();
    await b.owner.agent.put(`${b.members}/pages/${b.pageId}`).set(CSRF).send({ enabled: true }).expect(200);
    const member = await withMember(b);
    await request(http).post(`/api/v1/public/sites/${b.siteSlug}/members/logout`).set(CSRF).set("x-member-session", member.sessionToken).expect(204);
    await memberPage(b, member.sessionToken).expect(401);
  });

  it("un sitio despublicado por moderación o de una organización bloqueada deja de servir a sus miembros", async () => {
    const hidden = await business();
    await hidden.owner.agent.put(`${hidden.members}/pages/${hidden.pageId}`).set(CSRF).send({ enabled: true }).expect(200);
    const memberHidden = await withMember(hidden);
    await prisma.site.update({ where: { id: hidden.siteId }, data: { moderationHiddenAt: new Date() } });
    await memberPage(hidden, memberHidden.sessionToken).expect(401);

    const blocked = await business();
    await blocked.owner.agent.put(`${blocked.members}/pages/${blocked.pageId}`).set(CSRF).send({ enabled: true }).expect(200);
    const memberBlocked = await withMember(blocked);
    await prisma.organization.update({ where: { id: blocked.organizationId }, data: { status: OrganizationStatus.BLOCKED } });
    await memberPage(blocked, memberBlocked.sessionToken).expect(401);
  });

  it("panel: alta, duplicado, búsqueda, filtro, paginación, quitar y datos que no quedan en la auditoría", async () => {
    const b = await business();
    const emails = ["ana", "beto", "carla"].map((n) => `${n}-${unique("p")}${DOMAIN}`);
    for (const email of emails) {
      const res = await b.owner.agent.post(b.members).set(CSRF).send({ email: email.toUpperCase(), sendAccess: false }).expect(201);
      siteMemberResponse.parse(res.body);
      expect(res.body.email).toBe(email);
    }
    await b.owner.agent.post(b.members).set(CSRF).send({ email: emails[0], sendAccess: false }).expect(409);
    await b.owner.agent.post(b.members).set(CSRF).send({ email: "no-es-correo" }).expect(400);
    await b.owner.agent.post(b.members).set(CSRF).send({ email: "a@b.cl", status: "ACTIVE" }).expect(400);

    const all = await b.owner.agent.get(`${b.members}?pageSize=2&page=2`).expect(200);
    siteMemberListResponse.parse(all.body);
    expect(all.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(all.body.items).toHaveLength(1);
    const found = await b.owner.agent.get(`${b.members}?search=beto`).expect(200);
    expect(found.body.items.map((item: { email: string }) => item.email)).toEqual([emails[1]]);

    const target = found.body.items[0] as { id: string };
    await b.owner.agent.post(`${b.members}/${target.id}/revoke`).set(CSRF).expect(200);
    const revoked = await b.owner.agent.get(`${b.members}?status=REVOKED`).expect(200);
    expect(revoked.body.total).toBe(1);

    await b.owner.agent.delete(`${b.members}/${target.id}`).set(CSRF).expect(204);
    expect((await b.owner.agent.get(b.members).expect(200)).body.total).toBe(2);
    const audit = await prisma.auditLog.findMany({ where: { organizationId: b.organizationId, action: { startsWith: "member." } } });
    expect(audit.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(audit)).not.toContain(DOMAIN);
  });

  it("permisos y aislamiento: sin sesión 401, editor 403, otra organización 403 y su sitio ajeno 404", async () => {
    const b = await business();
    const other = await business();
    const editor = await person("editor");
    const invite = await b.owner.agent.post(`/api/v1/organizations/${b.organizationId}/members`).set(CSRF).send({ email: editor.email, role: "EDITOR" }).expect(201);
    await editor.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);

    await request(http).get(b.members).expect(401);
    await editor.agent.get(b.members).expect(403);
    await editor.agent.post(b.members).set(CSRF).send({ email: "x@y.cl" }).expect(403);
    await editor.agent.put(`${b.members}/pages/${b.pageId}`).set(CSRF).send({ enabled: true }).expect(403);

    await other.owner.agent.get(b.members).expect(403);
    await other.owner.agent.put(`${b.members}/pages/${b.pageId}`).set(CSRF).send({ enabled: true }).expect(403);
    // Con su propia organización pero el sitio y la página de otra: no existen para ella.
    await other.owner.agent.get(`/api/v1/organizations/${other.organizationId}/sites/${b.siteId}/members`).expect(404);
    await other.owner.agent.put(`/api/v1/organizations/${other.organizationId}/sites/${other.siteId}/members/pages/${b.pageId}`).set(CSRF).send({ enabled: true }).expect(404);
    expect((await prisma.page.findUniqueOrThrow({ where: { id: b.pageId } })).membersOnly).toBe(false);

    // La sesión de un miembro no abre ninguna ruta del panel.
    const member = await withMember(b);
    await request(http).get(b.members).set("x-member-session", member.sessionToken).set("Cookie", `impulza_session=${member.sessionToken}`).expect(401);
  });

  it("límite de pedidos de enlace por correo: pasado el tope se responde igual pero no se envía nada", async () => {
    const b = await business();
    const email = `${unique("tope")}${DOMAIN}`;
    await b.owner.agent.post(b.members).set(CSRF).send({ email, sendAccess: false }).expect(201);
    emailAdapter.messages = [];
    for (let i = 0; i < 5; i += 1) await askAccess(b.siteSlug, email).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(emailAdapter.messages.filter((m) => m.to === email)).toHaveLength(3);
  });
});
