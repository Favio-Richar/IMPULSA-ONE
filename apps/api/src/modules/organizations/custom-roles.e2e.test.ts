import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { customRoleResponse, memberResponse, rolesResponse } from "@impulza/contracts";
import { PERMISSIONS, type PrismaClient } from "@impulza/database";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { TEAM_PERMISSION_KEYS } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { listenForTests } from "../../test-support/http.js";

// F9.6a (ADR-028 §3) — roles personalizados y reglas contra la escalada de privilegios, contra Nest + Postgres + Redis reales.
// Cada regla de «nadie da lo que no tiene» tiene su prueba negativa; el aislamiento entre organizaciones también (ADR-002).

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@roles-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
type Agent = ReturnType<typeof request.agent>;
interface Person {
  email: string;
  agent: Agent;
}

describe("Roles personalizados (F9.6a)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let http: Parameters<typeof request>[0];
  let counter = 0;

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

  async function person(): Promise<Person> {
    // Registrarse tiene tope por minuto: cada persona parte con el cupo entero.
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
    counter += 1;
    const email = `p${counter}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${DOMAIN}`;
    const password = "password1234";
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(http);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password }).expect(201);
    return { email, agent };
  }

  async function organizationOf(owner: Person): Promise<string> {
    const response = await owner.agent
      .post("/api/v1/organizations")
      .set(CSRF)
      .send({ name: "Roles Org", slug: `roles-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
      .expect(201);
    await assignRoomyPlan(prisma, response.body.id);
    return response.body.id as string;
  }

  /** Invita a `invitee` con un rol (del sistema o personalizado) y deja que acepte. Devuelve su membresía. */
  async function join(owner: Person, orgId: string, invitee: Person, role: { role?: string; customRoleId?: string }): Promise<string> {
    const invite = await owner.agent.post(`/api/v1/organizations/${orgId}/members`).set(CSRF).send({ email: invitee.email, ...role }).expect(201);
    await invitee.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
    return invite.body.membershipId as string;
  }

  async function createRole(agent: Agent, orgId: string, name: string, permissions: string[]): Promise<string> {
    const response = await agent.post(`/api/v1/organizations/${orgId}/roles`).set(CSRF).send({ name, permissions }).expect(201);
    customRoleResponse.parse(response.body);
    return response.body.id as string;
  }

  it("el catálogo del editor coincide con el catálogo de la base", () => {
    expect([...TEAM_PERMISSION_KEYS].sort()).toEqual(Object.values(PERMISSIONS).sort());
  });

  it("el propietario crea, lista, edita y borra un rol; todo queda en la auditoría", async () => {
    const owner = await person();
    const orgId = await organizationOf(owner);
    const id = await createRole(owner.agent, orgId, "Redactor", ["site.update", "page.manage", "page.manage"]);

    const list = await owner.agent.get(`/api/v1/organizations/${orgId}/roles`).expect(200);
    rolesResponse.parse(list.body);
    expect(list.body.custom).toHaveLength(1);
    expect(list.body.custom[0]).toMatchObject({ name: "Redactor", permissions: ["page.manage", "site.update"], memberCount: 0 });
    expect(list.body.system.map((role: { name: string }) => role.name)).toContain("OWNER");
    expect(list.body.actorPermissions).toEqual(expect.arrayContaining(["billing.manage", "site.update"]));

    const edited = await owner.agent.put(`/api/v1/organizations/${orgId}/roles/${id}`).set(CSRF).send({ name: "Redactor jefe", description: "Con contactos", permissions: ["site.update", "contact.manage"] }).expect(200);
    expect(edited.body).toMatchObject({ name: "Redactor jefe", description: "Con contactos", permissions: ["contact.manage", "site.update"] });

    await owner.agent.delete(`/api/v1/organizations/${orgId}/roles/${id}`).set(CSRF).expect(204);
    expect((await owner.agent.get(`/api/v1/organizations/${orgId}/roles`).expect(200)).body.custom).toHaveLength(0);

    const actions = (await prisma.auditLog.findMany({ where: { organizationId: orgId, targetType: "CustomRole" }, orderBy: { createdAt: "asc" } })).map((entry) => entry.action);
    expect(actions).toEqual(["custom_role.created", "custom_role.updated", "custom_role.deleted"]);
  });

  it("rechaza lo inválido: nombre de rol del sistema, permisos fuera del catálogo, rol vacío y nombre repetido", async () => {
    const owner = await person();
    const orgId = await organizationOf(owner);
    const post = (body: unknown) => owner.agent.post(`/api/v1/organizations/${orgId}/roles`).set(CSRF).send(body as object);
    await post({ name: "ADMIN", permissions: ["site.update"] }).expect(400);
    await post({ name: "Algo", permissions: ["todo.poderoso"] }).expect(400);
    await post({ name: "Algo", permissions: [] }).expect(400);
    await createRole(owner.agent, orgId, "Único", ["site.update"]);
    await post({ name: "Único", permissions: ["page.manage"] }).expect(409);
  });

  it("matriz de permisos: un miembro con rol personalizado solo hace lo que su rol permite", async () => {
    const owner = await person();
    const orgId = await organizationOf(owner);
    const roleId = await createRole(owner.agent, orgId, "Solo invitar", ["organization.members.invite"]);
    const member = await person();
    await join(owner, orgId, member, { customRoleId: roleId });

    // Invitar: permitido (la persona no existe aún → 404 de negocio, no 403 de permiso).
    await member.agent.post(`/api/v1/organizations/${orgId}/members`).set(CSRF).send({ email: `nadie-${Date.now()}${DOMAIN}`, customRoleId: roleId }).expect(404);
    // Crear un sitio, cambiar roles, crear roles: denegado por falta de permiso.
    await member.agent.post(`/api/v1/organizations/${orgId}/sites`).set(CSRF).send({}).expect(403);
    await member.agent.post(`/api/v1/organizations/${orgId}/roles`).set(CSRF).send({ name: "Otro", permissions: ["site.update"] }).expect(403);
    // Leer sí: basta ser miembro.
    await member.agent.get(`/api/v1/organizations/${orgId}`).expect(200);
    const members = await owner.agent.get(`/api/v1/organizations/${orgId}/members`).expect(200);
    members.body.forEach((entry: unknown) => memberResponse.parse(entry));
    expect(members.body.find((entry: { email: string }) => entry.email === member.email)).toMatchObject({ role: "Solo invitar", customRoleId: roleId });
  });

  it("escalada bloqueada: nadie entrega permisos que no tiene", async () => {
    const owner = await person();
    const orgId = await organizationOf(owner);
    const gestor = await createRole(owner.agent, orgId, "Gestor de equipo", ["organization.members.invite", "organization.members.update_role", "organization.members.remove", "site.update"]);
    const manager = await person();
    const managerMembership = await join(owner, orgId, manager, { customRoleId: gestor });
    const admin = await person();
    const adminMembership = await join(owner, orgId, admin, { role: "ADMIN" });
    const editor = await person();
    const editorMembership = await join(owner, orgId, editor, { role: "EDITOR" });
    const analyst = await person();
    const analystMembership = await join(owner, orgId, analyst, { role: "ANALYST" });
    const base = `/api/v1/organizations/${orgId}`;

    // Crear un rol con un permiso que no tiene.
    const escalated = await manager.agent.post(`${base}/roles`).set(CSRF).send({ name: "Con plata", permissions: ["site.update", "billing.manage"] }).expect(403);
    expect(escalated.body).toMatchObject({ code: "ESCALATION", missing: ["billing.manage"] });
    // Invitar con un rol del sistema que tiene más de lo que tiene él.
    const invited = await manager.agent.post(`${base}/members`).set(CSRF).send({ email: `nadie-${Date.now()}${DOMAIN}`, role: "ADMIN" }).expect(403);
    expect(invited.body.code).toBe("ESCALATION");
    await manager.agent.post(`${base}/members`).set(CSRF).send({ email: editor.email, role: "EDITOR" }).expect(403);
    // Cambiar el rol de alguien (sin permisos) por otro con más permisos que los suyos.
    const raise = await manager.agent.patch(`${base}/members/${analystMembership}`).set(CSRF).send({ role: "ADMIN" }).expect(403);
    expect(raise.body.code).toBe("ESCALATION");
    // Actuar sobre alguien que ya tiene más permisos que él: degradarlo o quitarlo.
    const demote = await manager.agent.patch(`${base}/members/${adminMembership}`).set(CSRF).send({ role: "ANALYST" }).expect(403);
    expect(demote.body.code).toBe("TARGET_ABOVE_ACTOR");
    await manager.agent.delete(`${base}/members/${adminMembership}`).set(CSRF).expect(403);
    // Nadie edita su propio rol, ni el rol personalizado que tiene.
    const self = await manager.agent.patch(`${base}/members/${managerMembership}`).set(CSRF).send({ role: "ANALYST" }).expect(403);
    expect(self.body.code).toBe("SELF_CHANGE");
    await manager.agent.put(`${base}/roles/${gestor}`).set(CSRF).send({ name: "Gestor de equipo", permissions: ["organization.members.invite", "site.update"] }).expect(403);
    await manager.agent.delete(`${base}/roles/${gestor}`).set(CSRF).expect(403);
    // Nada de lo anterior cambió nada.
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: adminMembership }, include: { role: true } })).role.name).toBe("ADMIN");
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: editorMembership }, include: { role: true } })).role.name).toBe("EDITOR");
    // Alguien con más permisos que él (un editor) tampoco se toca, aunque el rol nuevo sea menor.
    const editorAbove = await manager.agent.patch(`${base}/members/${editorMembership}`).set(CSRF).send({ role: "ANALYST" }).expect(403);
    expect(editorAbove.body.code).toBe("TARGET_ABOVE_ACTOR");
    // Lo que sí puede, funciona: darle a un analista un rol propio con permisos que él tiene.
    const lectura = await createRole(owner.agent, orgId, "Editor de sitios", ["site.update"]);
    await manager.agent.patch(`${base}/members/${analystMembership}`).set(CSRF).send({ customRoleId: lectura }).expect(204);
    await manager.agent.delete(`${base}/members/${analystMembership}`).set(CSRF).expect(204);
  });

  it("el propietario está protegido: ni un administrador lo cambia ni lo quita, y un rol personalizado no lo hereda", async () => {
    const owner = await person();
    const orgId = await organizationOf(owner);
    const admin = await person();
    await join(owner, orgId, admin, { role: "ADMIN" });
    const ownerMembership = (await prisma.membership.findFirstOrThrow({ where: { organizationId: orgId, role: { name: "OWNER" } } })).id;
    const base = `/api/v1/organizations/${orgId}/members/${ownerMembership}`;
    await admin.agent.patch(base).set(CSRF).send({ role: "EDITOR" }).expect(403);
    await admin.agent.delete(base).set(CSRF).expect(403);
    // El propietario tampoco se baja a sí mismo (no se puede dejar la organización sin propietario).
    await owner.agent.patch(base).set(CSRF).send({ role: "EDITOR" }).expect(403);
    // «OWNER» no es un rol asignable ni un nombre usable para un rol propio.
    await owner.agent.patch(`/api/v1/organizations/${orgId}/members/${(await prisma.membership.findFirstOrThrow({ where: { organizationId: orgId, userId: (await prisma.user.findUniqueOrThrow({ where: { email: admin.email } })).id } })).id}`).set(CSRF).send({ role: "OWNER" }).expect(400);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: ownerMembership }, include: { role: true } })).role.name).toBe("OWNER");
  });

  it("un rol en uso no se borra; pasar a otro rol suelta el personalizado y manda el del sistema", async () => {
    const owner = await person();
    const orgId = await organizationOf(owner);
    const roleId = await createRole(owner.agent, orgId, "Soporte propio", ["contact.manage"]);
    const member = await person();
    const membershipId = await join(owner, orgId, member, { customRoleId: roleId });
    const base = `/api/v1/organizations/${orgId}`;

    const inUse = await owner.agent.delete(`${base}/roles/${roleId}`).set(CSRF).expect(409);
    expect(inUse.body.message).toContain("1 persona");
    expect((await owner.agent.get(`${base}/roles`).expect(200)).body.custom[0].memberCount).toBe(1);

    // Pasa a un rol del sistema: el personalizado se suelta y los permisos son los del rol nuevo.
    await owner.agent.patch(`${base}/members/${membershipId}`).set(CSRF).send({ role: "EDITOR" }).expect(204);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } })).customRoleId).toBeNull();
    await member.agent.post(`${base}/sites`).set(CSRF).send({}).expect(403); // EDITOR no crea sitios
    await owner.agent.delete(`${base}/roles/${roleId}`).set(CSRF).expect(204);
  });

  it("quien se quitó del equipo no cuenta como «en uso» y el rol se puede borrar", async () => {
    const owner = await person();
    const orgId = await organizationOf(owner);
    const roleId = await createRole(owner.agent, orgId, "Pasajero", ["contact.manage"]);
    const member = await person();
    const membershipId = await join(owner, orgId, member, { customRoleId: roleId });
    await owner.agent.delete(`/api/v1/organizations/${orgId}/members/${membershipId}`).set(CSRF).expect(204);
    await owner.agent.delete(`/api/v1/organizations/${orgId}/roles/${roleId}`).set(CSRF).expect(204);
    expect(await prisma.customRole.count({ where: { id: roleId } })).toBe(0);
  });

  it("aislamiento entre organizaciones: los roles de una no se ven, editan, borran ni asignan desde otra", async () => {
    const ownerA = await person();
    const ownerB = await person();
    const orgA = await organizationOf(ownerA);
    const orgB = await organizationOf(ownerB);
    const roleA = await createRole(ownerA.agent, orgA, "Rol de A", ["site.update"]);

    // Sin ser miembro de A, ni la lista ni nada.
    await ownerB.agent.get(`/api/v1/organizations/${orgA}/roles`).expect(403);
    await ownerB.agent.post(`/api/v1/organizations/${orgA}/roles`).set(CSRF).send({ name: "Intruso", permissions: ["site.update"] }).expect(403);
    // Con el identificador de A por la ruta de B: no existe.
    await ownerB.agent.put(`/api/v1/organizations/${orgB}/roles/${roleA}`).set(CSRF).send({ name: "Robado", permissions: ["site.update"] }).expect(404);
    await ownerB.agent.delete(`/api/v1/organizations/${orgB}/roles/${roleA}`).set(CSRF).expect(404);
    // Asignarlo a alguien de B tampoco: ni invitando ni cambiando el rol.
    const member = await person();
    const membershipB = await join(ownerB, orgB, member, { role: "EDITOR" });
    const another = await person();
    await ownerB.agent.post(`/api/v1/organizations/${orgB}/members`).set(CSRF).send({ email: another.email, customRoleId: roleA }).expect(404);
    await ownerB.agent.patch(`/api/v1/organizations/${orgB}/members/${membershipB}`).set(CSRF).send({ customRoleId: roleA }).expect(404);
    expect((await ownerB.agent.get(`/api/v1/organizations/${orgB}/roles`).expect(200)).body.custom).toHaveLength(0);
    expect((await prisma.customRole.findUniqueOrThrow({ where: { id: roleA } })).name).toBe("Rol de A");
  });

  it("el cuerpo de invitar y de cambiar rol exige un rol del sistema o uno personalizado, no ambos ni ninguno", async () => {
    const owner = await person();
    const orgId = await organizationOf(owner);
    const roleId = await createRole(owner.agent, orgId, "Cualquiera", ["site.update"]);
    const other = await person();
    const post = (body: object) => owner.agent.post(`/api/v1/organizations/${orgId}/members`).set(CSRF).send(body);
    await post({ email: other.email }).expect(400);
    await post({ email: other.email, role: "EDITOR", customRoleId: roleId }).expect(400);
    await post({ email: other.email, role: "OWNER" }).expect(400);
  });

  it("hay un tope de roles por organización", async () => {
    const owner = await person();
    const orgId = await organizationOf(owner);
    for (let index = 0; index < 20; index += 1) {
      await prisma.customRole.create({ data: { organizationId: orgId, name: `Relleno ${index}` } });
    }
    const over = await owner.agent.post(`/api/v1/organizations/${orgId}/roles`).set(CSRF).send({ name: "Uno de más", permissions: ["site.update"] }).expect(409);
    expect(over.body.message).toContain("20");
  });
});
