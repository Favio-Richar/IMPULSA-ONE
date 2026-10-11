import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { auditListResponse } from "@impulza/contracts";
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

// F9.6d (ADR-028 §3) — auditoría navegable: filtros, paginación en servidor, exportación CSV y los límites de quién ve qué
// (una organización solo la suya; una agencia solo lo que su equipo hizo en sus clientes, y solo los clientes de su alcance).

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@audit-query-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;
interface Person {
  email: string;
  userId: string;
  agent: Agent;
}

describe("Auditoría navegable (e2e) — F9.6d / ADR-028", () => {
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
    await prisma.organization.deleteMany({ where: { slug: { startsWith: "audit-e2e-" } } });
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

  async function join(owner: Person, orgId: string, invitee: Person, role: string): Promise<void> {
    const invite = await owner.agent.post(`/api/v1/organizations/${orgId}/members`).set(CSRF).send({ email: invitee.email, role }).expect(201);
    await invitee.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
  }

  /** Una organización con propietario, administrador y editor. */
  async function business() {
    const owner = await person("owner");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Auditoría Org", slug: unique("audit-e2e") }).expect(201);
    const orgId = created.body.id as string;
    await assignRoomyPlan(prisma, orgId);
    const admin = await person("admin");
    const editor = await person("editor");
    await join(owner, orgId, admin, "ADMIN");
    await join(owner, orgId, editor, "EDITOR");
    return { owner, admin, editor, orgId, url: `/api/v1/organizations/${orgId}/audit-logs` };
  }

  async function agency(extra: Array<{ key: string; role: string }> = []) {
    const owner = await person("aowner");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Agencia Auditoría", slug: unique("audit-e2e-a") }).expect(201);
    const agencyId = created.body.id as string;
    await assignRoomyPlan(prisma, agencyId);
    await owner.agent.post(`/api/v1/organizations/${agencyId}/agency/enable`).set(CSRF).expect(200);
    const team: Record<string, Person> = {};
    for (const { key, role } of extra) {
      const member = await person(key);
      await join(owner, agencyId, member, role);
      team[key] = member;
    }
    return { owner, team, agencyId, url: `/api/v1/organizations/${agencyId}/agency/audit-logs`, base: `/api/v1/organizations/${agencyId}/agency` };
  }

  async function newClient(ctx: { owner: Person; base: string }, name: string): Promise<{ orgId: string; relationId: string }> {
    const res = await ctx.owner.agent
      .post(`${ctx.base}/clients`)
      .set(CSRF)
      .send({ name, slug: unique("audit-e2e-c"), ownerEmail: `${unique("dueno")}${DOMAIN}` })
      .expect(201);
    return { orgId: res.body.clientOrganizationId as string, relationId: res.body.id as string };
  }

  it("el propietario filtra por acción, persona, recurso y fechas, y pagina en el servidor", async () => {
    const w = await business();
    for (const name of ["Redactor", "Revisor", "Lector"]) {
      await w.owner.agent.post(`/api/v1/organizations/${w.orgId}/roles`).set(CSRF).send({ name, permissions: ["site.update"] }).expect(201);
    }

    const all = await w.owner.agent.get(w.url).expect(200);
    auditListResponse.parse(all.body);
    expect(all.body.total).toBeGreaterThanOrEqual(3);
    const times = (all.body.items as Array<{ createdAt: string }>).map((item) => item.createdAt);
    expect([...times].sort().reverse()).toEqual(times);

    const roles = await w.owner.agent.get(`${w.url}?action=custom_role`).expect(200);
    expect(roles.body.total).toBe(3);
    expect(roles.body.items.every((item: { action: string }) => item.action === "custom_role.created")).toBe(true);
    expect(roles.body.items[0].actor.email).toBe(w.owner.email);
    expect(roles.body.items[0].organization.id).toBe(w.orgId);

    const exact = await w.owner.agent.get(`${w.url}?action=custom_role.created&targetType=CustomRole`).expect(200);
    expect(exact.body.total).toBe(3);
    expect((await w.owner.agent.get(`${w.url}?targetType=Page`).expect(200)).body.total).toBe(0);

    // Persona: fragmento del correo, sin distinguir mayúsculas.
    const byActor = await w.owner.agent.get(`${w.url}?actor=${encodeURIComponent(w.owner.email.slice(0, 12).toUpperCase())}&action=custom_role`).expect(200);
    expect(byActor.body.total).toBe(3);
    expect((await w.owner.agent.get(`${w.url}?actor=${encodeURIComponent("nadie-asi@x")}`).expect(200)).body.total).toBe(0);

    // Fechas: hoy incluye todo; un rango del pasado, nada.
    const today = new Date().toISOString().slice(0, 10);
    expect((await w.owner.agent.get(`${w.url}?action=custom_role&from=${today}&to=${today}`).expect(200)).body.total).toBe(3);
    expect((await w.owner.agent.get(`${w.url}?action=custom_role&from=2020-01-01&to=2020-01-31`).expect(200)).body.total).toBe(0);

    // Paginación en el servidor: la página trae `limit`, el total no cambia y las páginas no se repiten.
    const first = await w.owner.agent.get(`${w.url}?action=custom_role&limit=2&offset=0`).expect(200);
    const second = await w.owner.agent.get(`${w.url}?action=custom_role&limit=2&offset=2`).expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(second.body.items).toHaveLength(1);
    expect(first.body.total).toBe(3);
    const ids = [...first.body.items, ...second.body.items].map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("rechaza lo inválido y a quien no tiene el permiso", async () => {
    const w = await business();
    const outsider = await person("fuera");
    for (const bad of ["limit=500", "limit=0", "offset=-1", "from=ayer", "from=2026-10-10&to=2026-10-01", "action=A%20B", "targetType=Page;DROP", `client=${w.orgId}`]) {
      await w.owner.agent.get(`${w.url}?${bad}`).expect(400);
    }
    // El analista, el editor y quien no es miembro no ven la auditoría; el administrador sí.
    await w.editor.agent.get(w.url).expect(403);
    await w.editor.agent.get(`${w.url}/export`).expect(403);
    await outsider.agent.get(w.url).expect(403);
    await request(http).get(w.url).expect(401);
    await w.admin.agent.get(w.url).expect(200);
  });

  it("aislamiento: una organización nunca ve la auditoría de otra, ni por su propia ruta", async () => {
    const a = await business();
    const b = await business();
    await a.owner.agent.post(`/api/v1/organizations/${a.orgId}/roles`).set(CSRF).send({ name: "Solo de A", permissions: ["site.update"] }).expect(201);

    await b.owner.agent.get(a.url).expect(403);
    await b.owner.agent.get(`${a.url}/export`).expect(403);
    const own = await b.owner.agent.get(`${b.url}?action=custom_role`).expect(200);
    expect(own.body.total).toBe(0);
    expect(JSON.stringify(own.body)).not.toContain("Solo de A");
  });

  it("exporta un CSV con encabezado y BOM, respeta los filtros y queda registrado", async () => {
    const w = await business();
    for (const name of ["Rol A", "Rol B"]) {
      await w.owner.agent.post(`/api/v1/organizations/${w.orgId}/roles`).set(CSRF).send({ name, permissions: ["site.update"] }).expect(201);
    }
    const res = await w.owner.agent.get(`${w.url}/export?action=custom_role`).buffer(true).parse((response, done) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => done(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("auditoria.csv");
    expect(res.headers["cache-control"]).toBe("no-store");
    const bytes = res.body as Buffer;
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe("Fecha (UTC);Acción;Persona;Recurso;Id del recurso;Organización;Vía agencia;Detalle");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("custom_role.created");
    expect(lines[1]).toContain(w.owner.email);

    // Exportar queda en la auditoría, con los filtros y la cantidad (no con el contenido).
    const log = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: w.orgId, action: "audit.exported" } });
    expect(log.actorId).not.toBeNull();
    expect(log.metadata).toMatchObject({ view: "organization", rows: 2, truncated: false, filters: { action: "custom_role" } });
  });

  it("la agencia ve solo lo que su equipo hizo en sus clientes, y solo los de su alcance", async () => {
    const ctx = await agency([{ key: "admin", role: "ADMIN" }]);
    const c1 = await newClient(ctx, "Cliente Uno");
    const c2 = await newClient(ctx, "Cliente Dos");

    // La agencia actúa en cada cliente (delegado); el cliente hace algo por su cuenta (sin marca de delegación).
    await ctx.owner.agent.post(`/api/v1/organizations/${c1.orgId}/sites`).set(CSRF).send({ name: "Sitio Uno", slug: unique("audit-e2e-s") }).expect(201);
    await ctx.owner.agent.post(`/api/v1/organizations/${c2.orgId}/sites`).set(CSRF).send({ name: "Sitio Dos", slug: unique("audit-e2e-s") }).expect(201);
    await prisma.auditLog.create({ data: { organizationId: c1.orgId, action: "site.updated", targetType: "Site", metadata: { by: "el cliente" } } });

    const all = await ctx.owner.agent.get(ctx.url).expect(200);
    auditListResponse.parse(all.body);
    expect(all.body.total).toBeGreaterThanOrEqual(2);
    expect(all.body.items.every((item: { delegatedBy: { agencyOrganizationId: string } | null }) => item.delegatedBy?.agencyOrganizationId === ctx.agencyId)).toBe(true);
    expect(all.body.items[0].delegatedBy.agencyName).toBe("Agencia Auditoría");
    const clients = new Set(all.body.items.map((item: { organization: { id: string } }) => item.organization.id));
    expect(clients).toEqual(new Set([c1.orgId, c2.orgId]));
    // Lo que el cliente hizo por su cuenta NO es de la agencia.
    expect(JSON.stringify(all.body)).not.toContain("el cliente");
    // Y la marca de delegación no se repite dentro del detalle.
    expect(all.body.items.every((item: { metadata: Record<string, unknown> | null }) => item.metadata === null || !("delegatedBy" in item.metadata))).toBe(true);

    // Filtro por cliente.
    const only = await ctx.owner.agent.get(`${ctx.url}?client=${c1.orgId}`).expect(200);
    expect(only.body.items.every((item: { organization: { id: string } }) => item.organization.id === c1.orgId)).toBe(true);
    expect(only.body.total).toBeGreaterThanOrEqual(1);

    // Una persona acotada a un cliente solo ve ese, y el otro responde 404 (no filtra que existe).
    await ctx.owner.agent.put(`${ctx.base}/team/${ctx.team.admin!.userId}/scope`).set(CSRF).send({ allClients: false, clientIds: [c2.relationId] }).expect(200);
    const scoped = await ctx.team.admin!.agent.get(ctx.url).expect(200);
    expect(scoped.body.items.every((item: { organization: { id: string } }) => item.organization.id === c2.orgId)).toBe(true);
    await ctx.team.admin!.agent.get(`${ctx.url}?client=${c1.orgId}`).expect(404);

    // Exportación de la agencia: marca la vía y registra la exportación.
    const csv = await ctx.owner.agent.get(`${ctx.url}/export`).expect(200);
    expect(csv.text).toContain("Agencia Auditoría");
    expect(await prisma.auditLog.count({ where: { organizationId: ctx.agencyId, action: "audit.exported" } })).toBe(1);
  });

  it("la agencia no entra a la auditoría propia del cliente; un cliente ajeno y una organización que no es agencia responden sin filtrar", async () => {
    const ctx = await agency();
    const mine = await newClient(ctx, "Mi Cliente");
    const other = await agency();
    const theirs = await newClient(other, "Cliente Ajeno");
    const plain = await business();

    // La auditoría del cliente es del cliente: la agencia delegada no la lee.
    const denied = await ctx.owner.agent.get(`/api/v1/organizations/${mine.orgId}/audit-logs`).expect(403);
    expect(["AGENCY_LIMIT", "FORBIDDEN"].includes(denied.body.code) || denied.body.statusCode === 403).toBe(true);

    // Un cliente de OTRA agencia: 404, igual que uno que no existe.
    await ctx.owner.agent.get(`${ctx.url}?client=${theirs.orgId}`).expect(404);
    await ctx.owner.agent.get(`${ctx.url}?client=${plain.orgId}`).expect(404);
    // Una organización que no es agencia no tiene vista de agencia.
    const notAgency = await plain.owner.agent.get(`/api/v1/organizations/${plain.orgId}/agency/audit-logs`).expect(403);
    expect(notAgency.body.code).toBe("NOT_AN_AGENCY");
    // Y la otra agencia no ve lo de la primera.
    await ctx.owner.agent.post(`/api/v1/organizations/${mine.orgId}/sites`).set(CSRF).send({ name: "Sitio Tres", slug: unique("audit-e2e-s") }).expect(201);
    const seen = await other.owner.agent.get(other.url).expect(200);
    expect(JSON.stringify(seen.body)).not.toContain(mine.orgId);
  });
});
