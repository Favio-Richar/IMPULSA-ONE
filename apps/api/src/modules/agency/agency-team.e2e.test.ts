import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { agencyMemberScopeResponse, agencyTeamResponse } from "@impulza/contracts";
import { MembershipSource, MembershipStatus, type PrismaClient } from "@impulza/database";
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

// F9.6b (ADR-028 §3) — el equipo de una agencia, acotado por cliente y por módulo. El alcance se aplica en dos sitios: las membresías
// delegadas (qué clientes tiene la persona) y la puerta de entrada (cada petición). Y nadie da más alcance del que tiene.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@agency-team-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;
interface Person {
  email: string;
  userId: string;
  agent: Agent;
}

describe("Equipo de agencia por cliente y módulo (e2e) — F9.6b / ADR-028", () => {
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
    await prisma.organization.deleteMany({ where: { slug: { startsWith: "team-e2e-" } } });
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

  /** Una agencia con su propietario y, opcionalmente, personas de su equipo con el rol dado ya aceptadas. */
  async function agency(members: Array<{ key: string; role: string }> = []) {
    const owner = await person("owner");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Agencia Equipo", slug: unique("team-e2e") }).expect(201);
    const agencyId = created.body.id as string;
    await assignRoomyPlan(prisma, agencyId);
    await owner.agent.post(`/api/v1/organizations/${agencyId}/agency/enable`).set(CSRF).expect(200);
    const team: Record<string, Person> = {};
    for (const { key, role } of members) {
      const member = await person(key);
      const invite = await owner.agent.post(`/api/v1/organizations/${agencyId}/members`).set(CSRF).send({ email: member.email, role }).expect(201);
      await member.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
      team[key] = member;
    }
    return { owner, team, agencyId, base: `/api/v1/organizations/${agencyId}/agency` };
  }

  async function newClient(ctx: { owner: Person; base: string }, name: string): Promise<{ orgId: string; relationId: string }> {
    const res = await ctx.owner.agent
      .post(`${ctx.base}/clients`)
      .set(CSRF)
      .send({ name, slug: unique("team-e2e-c"), ownerEmail: `${unique("dueno")}${DOMAIN}` })
      .expect(201);
    return { orgId: res.body.clientOrganizationId as string, relationId: res.body.id as string };
  }

  const scopeUrl = (base: string, userId: string) => `${base}/team/${userId}/scope`;
  const canEnter = async (who: Person, orgId: string): Promise<number> => (await who.agent.get(`/api/v1/organizations/${orgId}`)).status;

  it("lista al equipo que delega con su alcance y los clientes; por defecto todos ven todo", async () => {
    const ctx = await agency([{ key: "admin", role: "ADMIN" }, { key: "editor", role: "EDITOR" }]);
    const c1 = await newClient(ctx, "Cliente Uno");
    const res = await ctx.owner.agent.get(`${ctx.base}/team`).expect(200);
    agencyTeamResponse.parse(res.body);
    // El editor no delega: no aparece. El propietario y el administrador sí, sin restricciones.
    expect(res.body.members.map((member: { role: string }) => member.role).sort()).toEqual(["ADMIN", "OWNER"]);
    for (const member of res.body.members) expect(member.scope).toEqual({ allClients: true, clientIds: [], modules: [] });
    expect(res.body.members.find((member: { isSelf: boolean }) => member.isSelf).role).toBe("OWNER");
    expect(res.body.clients).toEqual([expect.objectContaining({ id: c1.relationId, name: "Cliente Uno" })]);
    expect(await canEnter(ctx.team.admin!, c1.orgId)).toBe(200);
  });

  it("acotar por cliente: la persona solo entra a los elegidos, también a los clientes que se crean después, y volver a «todos» lo devuelve", async () => {
    const ctx = await agency([{ key: "admin", role: "ADMIN" }]);
    const admin = ctx.team.admin!;
    const c1 = await newClient(ctx, "Uno");
    const c2 = await newClient(ctx, "Dos");
    expect(await canEnter(admin, c1.orgId)).toBe(200);
    expect(await canEnter(admin, c2.orgId)).toBe(200);

    const set = await ctx.owner.agent.put(scopeUrl(ctx.base, admin.userId)).set(CSRF).send({ allClients: false, clientIds: [c1.relationId] }).expect(200);
    agencyMemberScopeResponse.parse(set.body);
    expect(set.body).toEqual({ allClients: false, clientIds: [c1.relationId], modules: [] });
    expect(await canEnter(admin, c1.orgId)).toBe(200);
    expect(await canEnter(admin, c2.orgId)).toBe(403);
    expect((await prisma.membership.findFirstOrThrow({ where: { userId: admin.userId, organizationId: c2.orgId } })).status).toBe(MembershipStatus.REMOVED);

    // Un cliente nuevo no llega a quien está acotado; el propietario sí lo ve.
    const c3 = await newClient(ctx, "Tres");
    expect(await canEnter(admin, c3.orgId)).toBe(403);
    expect(await canEnter(ctx.owner, c3.orgId)).toBe(200);
    // La lista de organizaciones de la persona solo trae lo que puede abrir.
    const mine = await admin.agent.get("/api/v1/organizations").expect(200);
    const ids = mine.body.map((org: { id: string }) => org.id);
    expect(ids).toContain(c1.orgId);
    expect(ids).not.toContain(c2.orgId);
    expect(ids).not.toContain(c3.orgId);

    // De vuelta a todos los clientes: recupera los que perdió y los nuevos; el estado por defecto no deja fila.
    await ctx.owner.agent.put(scopeUrl(ctx.base, admin.userId)).set(CSRF).send({ allClients: true }).expect(200);
    expect(await canEnter(admin, c2.orgId)).toBe(200);
    expect(await canEnter(admin, c3.orgId)).toBe(200);
    expect(await prisma.agencyMemberScope.count({ where: { agencyOrganizationId: ctx.agencyId, userId: admin.userId } })).toBe(0);
  });

  it("acotar por módulo: solo pasan las rutas de los módulos elegidos; lo que no es módulo sigue abierto", async () => {
    const ctx = await agency([{ key: "admin", role: "ADMIN" }]);
    const admin = ctx.team.admin!;
    const c1 = await newClient(ctx, "Uno");
    await ctx.owner.agent.put(scopeUrl(ctx.base, admin.userId)).set(CSRF).send({ allClients: true, modules: ["medios"] }).expect(200);

    const media = await admin.agent.get(`/api/v1/organizations/${c1.orgId}/media`);
    expect(media.status).toBe(200);
    const contacts = await admin.agent.get(`/api/v1/organizations/${c1.orgId}/contacts`).expect(403);
    expect(contacts.body.code).toBe("AGENCY_MODULE_DENIED");
    const sites = await admin.agent.get(`/api/v1/organizations/${c1.orgId}/sites`).expect(403);
    expect(sites.body.code).toBe("AGENCY_MODULE_DENIED");
    // La organización misma no es un módulo: se puede abrir (si no, el selector de clientes dejaría de funcionar).
    await admin.agent.get(`/api/v1/organizations/${c1.orgId}`).expect(200);
    // Escribir en un módulo no permitido tampoco.
    await admin.agent.post(`/api/v1/organizations/${c1.orgId}/short-links`).set(CSRF).send({}).expect(403);

    // Quitar la restricción de módulos lo devuelve todo.
    await ctx.owner.agent.put(scopeUrl(ctx.base, admin.userId)).set(CSRF).send({ allClients: true, modules: [] }).expect(200);
    await admin.agent.get(`/api/v1/organizations/${c1.orgId}/contacts`).expect(200);
  });

  it("defensa en profundidad: aunque la sincronización fallara, la puerta de entrada niega al cliente excluido", async () => {
    const ctx = await agency([{ key: "admin", role: "ADMIN" }]);
    const admin = ctx.team.admin!;
    const c1 = await newClient(ctx, "Uno");
    const c2 = await newClient(ctx, "Dos");
    await ctx.owner.agent.put(scopeUrl(ctx.base, admin.userId)).set(CSRF).send({ allClients: false, clientIds: [c1.relationId] }).expect(200);
    // Se restaura a mano la membresía delegada del cliente excluido, como si la sincronización no se hubiera hecho.
    await prisma.membership.updateMany({ where: { userId: admin.userId, organizationId: c2.orgId, source: MembershipSource.AGENCY }, data: { status: MembershipStatus.ACTIVE } });
    const res = await admin.agent.get(`/api/v1/organizations/${c2.orgId}`).expect(403);
    expect(res.body.code).toBe("AGENCY_SCOPE_DENIED");
  });

  it("reglas: nadie cambia su propio acceso, el propietario no se acota y nadie da más alcance del que tiene", async () => {
    const ctx = await agency([{ key: "admin", role: "ADMIN" }, { key: "other", role: "ADMIN" }]);
    const { admin, other } = ctx.team as { admin: Person; other: Person };
    const c1 = await newClient(ctx, "Uno");
    const c2 = await newClient(ctx, "Dos");

    // Quien administra no cambia su propio acceso.
    const self = await admin.agent.put(scopeUrl(ctx.base, admin.userId)).set(CSRF).send({ allClients: true, modules: ["medios"] }).expect(403);
    expect(self.body.code).toBe("SELF_CHANGE");
    // Nadie acota al propietario de la agencia.
    const owner = await admin.agent.put(scopeUrl(ctx.base, ctx.owner.userId)).set(CSRF).send({ allClients: false, clientIds: [c1.relationId] }).expect(403);
    expect(owner.body.code).toBe("OWNER_PROTECTED");

    // El propietario acota a `admin` a un cliente y un módulo; entonces `admin` no puede dar más de eso.
    await ctx.owner.agent.put(scopeUrl(ctx.base, admin.userId)).set(CSRF).send({ allClients: false, clientIds: [c1.relationId], modules: ["medios", "sitios"] }).expect(200);
    for (const body of [
      { allClients: true, modules: ["medios"] }, // todos los clientes
      { allClients: false, clientIds: [c2.relationId], modules: ["medios"] }, // un cliente que no tiene
      { allClients: false, clientIds: [c1.relationId] }, // todos los módulos
      { allClients: false, clientIds: [c1.relationId], modules: ["soporte"] }, // un módulo que no tiene
    ]) {
      const res = await admin.agent.put(scopeUrl(ctx.base, other.userId)).set(CSRF).send(body).expect(403);
      expect(res.body.code).toBe("SCOPE_ESCALATION");
    }
    // Un subconjunto de lo suyo sí.
    await admin.agent.put(scopeUrl(ctx.base, other.userId)).set(CSRF).send({ allClients: false, clientIds: [c1.relationId], modules: ["medios"] }).expect(200);
    expect(await canEnter(other, c1.orgId)).toBe(200);
    expect(await canEnter(other, c2.orgId)).toBe(403);
  });

  it("validaciones: cuerpo, persona que no delega, rol sin permiso, cliente ajeno y organización que no es agencia", async () => {
    const ctx = await agency([{ key: "admin", role: "ADMIN" }, { key: "editor", role: "EDITOR" }]);
    const { admin, editor } = ctx.team as { admin: Person; editor: Person };
    const c1 = await newClient(ctx, "Uno");
    const put = (userId: string, body: object, who: Person = ctx.owner) => who.agent.put(scopeUrl(ctx.base, userId)).set(CSRF).send(body);

    await put(admin.userId, { allClients: false, clientIds: [] }).expect(400); // ningún cliente
    await put(admin.userId, { allClients: true, modules: ["todo"] }).expect(400); // módulo inventado
    await put(admin.userId, { allClients: false, clientIds: ["no-es-uuid"] }).expect(400);
    await put(editor.userId, { allClients: true, modules: ["medios"] }).expect(404); // el editor no delega: acotarlo no tendría efecto
    await put("00000000-0000-4000-8000-000000000000", { allClients: true, modules: ["medios"] }).expect(404);
    // Quien no tiene `agency.manage` (un editor de la agencia) no puede ni ver ni cambiar el equipo.
    await editor.agent.get(`${ctx.base}/team`).expect(403);
    await put(admin.userId, { allClients: true, modules: ["medios"] }, editor).expect(403);

    // Un cliente de OTRA agencia responde como si no existiera.
    const other = await agency();
    const foreign = await newClient(other, "Ajeno");
    await put(admin.userId, { allClients: false, clientIds: [c1.relationId, foreign.relationId] }).expect(404);
    expect(await prisma.agencyMemberScope.count({ where: { agencyOrganizationId: ctx.agencyId } })).toBe(0);

    // Una organización que no es agencia no tiene equipo de agencia.
    const plain = await person("plain");
    const org = await plain.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio", slug: unique("team-e2e-n") }).expect(201);
    const res = await plain.agent.get(`/api/v1/organizations/${org.body.id}/agency/team`).expect(403);
    expect(res.body.code).toBe("NOT_AN_AGENCY");
  });

  it("aislamiento: otra agencia no ve ni cambia el equipo de esta", async () => {
    const ctx = await agency([{ key: "admin", role: "ADMIN" }]);
    const intruder = await agency();
    await intruder.owner.agent.get(`${ctx.base}/team`).expect(403);
    await intruder.owner.agent.put(scopeUrl(ctx.base, ctx.team.admin!.userId)).set(CSRF).send({ allClients: true, modules: ["medios"] }).expect(403);
    expect(await prisma.agencyMemberScope.count({ where: { agencyOrganizationId: ctx.agencyId } })).toBe(0);
  });

  it("cada cambio queda en la auditoría con el alcance anterior y el nuevo", async () => {
    const ctx = await agency([{ key: "admin", role: "ADMIN" }]);
    const admin = ctx.team.admin!;
    const c1 = await newClient(ctx, "Uno");
    await ctx.owner.agent.put(scopeUrl(ctx.base, admin.userId)).set(CSRF).send({ allClients: false, clientIds: [c1.relationId], modules: ["medios"] }).expect(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: ctx.agencyId, action: "agency.member_scope_changed" } });
    expect(entry.actorId).toBe(ctx.owner.userId);
    expect(entry.targetId).toBe(admin.userId);
    expect(entry.metadata).toMatchObject({
      previous: { allClients: true, clientIds: [], modules: [] },
      next: { allClients: false, clientIds: [c1.relationId], modules: ["medios"] },
    });
  });

  it("sacar a la persona de la agencia le quita el acceso a todos los clientes, esté o no acotada", async () => {
    const ctx = await agency([{ key: "admin", role: "ADMIN" }]);
    const admin = ctx.team.admin!;
    const c1 = await newClient(ctx, "Uno");
    await ctx.owner.agent.put(scopeUrl(ctx.base, admin.userId)).set(CSRF).send({ allClients: false, clientIds: [c1.relationId] }).expect(200);
    expect(await canEnter(admin, c1.orgId)).toBe(200);
    const membership = await prisma.membership.findFirstOrThrow({ where: { userId: admin.userId, organizationId: ctx.agencyId } });
    await ctx.owner.agent.delete(`/api/v1/organizations/${ctx.agencyId}/members/${membership.id}`).set(CSRF).expect(204);
    expect(await canEnter(admin, c1.orgId)).toBe(403);
  });
});
