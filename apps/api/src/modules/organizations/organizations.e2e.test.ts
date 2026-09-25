import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { invitationResponse, memberResponse, organizationResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { listenForTests } from "../../test-support/http.js";

// Pruebas de integración reales — NestJS completo + Postgres/Redis reales (docker-compose.yml).
// Cubre F1.5 (CRUD de organizaciones/membresías) y sienta las bases de F1.9 (aislamiento
// multi-tenant): cada caso de "no ve/no puede tocar la org ajena" aquí es exactamente lo que F1.9
// exige de forma transversal para toda Fase 1.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@org-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(): string {
  return `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Organizations (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
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
    await prisma.organization.deleteMany({
      where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function registerLoggedInUser(): Promise<{ email: string; agent: ReturnType<typeof request.agent> }> {
    const email = uniqueEmail();
    const password = "password1234";
    const agent = request.agent(httpServer);

    await request(httpServer)
      .post("/api/v1/auth/register")
      .set(CSRF_HEADERS)
      .send({ email, password })
      .expect(201);

    const lastMessage = emailAdapter.messages.at(-1);
    const token = /token=([a-f0-9]+)/.exec(lastMessage?.text ?? "")?.[1];
    await request(httpServer)
      .post("/api/v1/auth/verify-email")
      .set(CSRF_HEADERS)
      .send({ token })
      .expect(204);

    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);

    return { email, agent };
  }

  async function createOrg(agent: ReturnType<typeof request.agent>): Promise<{ id: string; slug: string }> {
    const slug = uniqueSlug();
    const response = await agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Test Org", slug })
      .expect(201);
    // El contrato publicado en OpenAPI se ejecuta contra la respuesta real: un contrato que nadie
    // corre es documentación, no contrato.
    organizationResponse.parse(response.body);
    // Plan con cupo (F4.2): estas pruebas invitan miembros para verificar roles y membresías, no
    // los límites de Gratis (esos tienen su propia suite, plan-limits.e2e.test.ts).
    await assignRoomyPlan(prisma, response.body.id);
    return { id: response.body.id, slug };
  }

  it("crea una organización y el creador queda como OWNER activo", async () => {
    const { agent } = await registerLoggedInUser();
    const org = await createOrg(agent);

    const members = await agent.get(`/api/v1/organizations/${org.id}/members`).expect(200);
    for (const member of members.body) {
      memberResponse.parse(member);
    }
    expect(members.body).toHaveLength(1);
    expect(members.body[0]).toMatchObject({ role: "OWNER", status: "ACTIVE" });

    const mine = await agent.get("/api/v1/organizations").expect(200);
    expect(mine.body.map((o: { id: string }) => o.id)).toContain(org.id);
  });

  it("rechaza un slug duplicado", async () => {
    const { agent } = await registerLoggedInUser();
    const slug = uniqueSlug();
    await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org A", slug }).expect(201);
    await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org B", slug }).expect(409);
  });

  it("invita a un usuario existente, bloquea el acceso hasta que acepta", async () => {
    const owner = await registerLoggedInUser();
    const invitee = await registerLoggedInUser();
    const org = await createOrg(owner.agent);

    const inviteResponse = await owner.agent
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: invitee.email, role: "EDITOR" })
      .expect(201);
    invitationResponse.parse(inviteResponse.body);
    const membershipId: string = inviteResponse.body.membershipId;

    // Invitado, todavía no acepta: sin acceso.
    await invitee.agent.get(`/api/v1/organizations/${org.id}`).expect(403);

    await invitee.agent
      .post(`/api/v1/memberships/${membershipId}/accept`)
      .set(CSRF_HEADERS)
      .expect(204);

    // Ya aceptó: acceso concedido.
    await invitee.agent.get(`/api/v1/organizations/${org.id}`).expect(200);
  });

  it("rechaza invitar a un correo sin cuenta registrada", async () => {
    const { agent } = await registerLoggedInUser();
    const org = await createOrg(agent);

    await agent
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: uniqueEmail(), role: "EDITOR" })
      .expect(404);
  });

  it("un miembro sin rol OWNER/ADMIN no puede invitar, cambiar roles ni remover", async () => {
    const owner = await registerLoggedInUser();
    const editor = await registerLoggedInUser();
    const org = await createOrg(owner.agent);

    const invite = await owner.agent
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: editor.email, role: "EDITOR" })
      .expect(201);
    await editor.agent
      .post(`/api/v1/memberships/${invite.body.membershipId}/accept`)
      .set(CSRF_HEADERS)
      .expect(204);

    await editor.agent
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: uniqueEmail(), role: "EDITOR" })
      .expect(403);

    await editor.agent
      .patch(`/api/v1/organizations/${org.id}/members/${invite.body.membershipId}`)
      .set(CSRF_HEADERS)
      .send({ role: "ANALYST" })
      .expect(403);

    await editor.agent
      .delete(`/api/v1/organizations/${org.id}/members/${invite.body.membershipId}`)
      .set(CSRF_HEADERS)
      .expect(403);
  });

  it("RBAC (F1.6): ADMIN también tiene los permisos de gestión de miembros, no solo OWNER", async () => {
    const owner = await registerLoggedInUser();
    const admin = await registerLoggedInUser();
    const org = await createOrg(owner.agent);

    const adminInvite = await owner.agent
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: admin.email, role: "ADMIN" })
      .expect(201);
    await admin.agent
      .post(`/api/v1/memberships/${adminInvite.body.membershipId}/accept`)
      .set(CSRF_HEADERS)
      .expect(204);

    // El ADMIN (no el OWNER) invita a un tercero — prueba el grant de permiso del seed, no un
    // caso especial hardcodeado para OWNER.
    const third = await registerLoggedInUser();
    await admin.agent
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: third.email, role: "SUPPORT" })
      .expect(201);
  });

  it("RBAC (F1.6): EDITOR sin permiso recibe 403 con mensaje que referencia su rol", async () => {
    const owner = await registerLoggedInUser();
    const editor = await registerLoggedInUser();
    const org = await createOrg(owner.agent);

    const invite = await owner.agent
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: editor.email, role: "EDITOR" })
      .expect(201);
    await editor.agent
      .post(`/api/v1/memberships/${invite.body.membershipId}/accept`)
      .set(CSRF_HEADERS)
      .expect(204);

    const denied = await editor.agent
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: uniqueEmail(), role: "EDITOR" })
      .expect(403);
    expect(denied.body.message).toContain("EDITOR");
  });

  it("OWNER cambia el rol de un miembro y luego lo remueve", async () => {
    const owner = await registerLoggedInUser();
    const member = await registerLoggedInUser();
    const org = await createOrg(owner.agent);

    const invite = await owner.agent
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: member.email, role: "EDITOR" })
      .expect(201);
    await member.agent
      .post(`/api/v1/memberships/${invite.body.membershipId}/accept`)
      .set(CSRF_HEADERS)
      .expect(204);

    await owner.agent
      .patch(`/api/v1/organizations/${org.id}/members/${invite.body.membershipId}`)
      .set(CSRF_HEADERS)
      .send({ role: "ANALYST" })
      .expect(204);

    const membersAfterRoleChange = await owner.agent.get(`/api/v1/organizations/${org.id}/members`);
    const updated = membersAfterRoleChange.body.find(
      (m: { membershipId: string }) => m.membershipId === invite.body.membershipId,
    );
    expect(updated.role).toBe("ANALYST");

    await owner.agent
      .delete(`/api/v1/organizations/${org.id}/members/${invite.body.membershipId}`)
      .set(CSRF_HEADERS)
      .expect(204);

    // El miembro removido pierde el acceso.
    await member.agent.get(`/api/v1/organizations/${org.id}`).expect(403);
  });

  it("no permite cambiar el rol del OWNER ni removerlo", async () => {
    const owner = await registerLoggedInUser();
    const org = await createOrg(owner.agent);

    const members = await owner.agent.get(`/api/v1/organizations/${org.id}/members`);
    const ownerMembershipId = members.body[0].membershipId;

    await owner.agent
      .patch(`/api/v1/organizations/${org.id}/members/${ownerMembershipId}`)
      .set(CSRF_HEADERS)
      .send({ role: "ANALYST" })
      .expect(403);

    await owner.agent
      .delete(`/api/v1/organizations/${org.id}/members/${ownerMembershipId}`)
      .set(CSRF_HEADERS)
      .expect(403);
  });

  it("aislamiento multi-tenant: un usuario ajeno no ve ni puede tocar otra organización", async () => {
    const ownerA = await registerLoggedInUser();
    const orgA = await createOrg(ownerA.agent);

    const ownerB = await registerLoggedInUser();
    const orgB = await createOrg(ownerB.agent);

    await ownerA.agent.get(`/api/v1/organizations/${orgB.id}`).expect(403);
    await ownerA.agent.get(`/api/v1/organizations/${orgB.id}/members`).expect(403);
    await ownerA.agent
      .post(`/api/v1/organizations/${orgB.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: ownerA.email, role: "EDITOR" })
      .expect(403);

    const orgBMembers = await ownerB.agent.get(`/api/v1/organizations/${orgB.id}/members`);
    const ownerBMembershipId = orgBMembers.body[0].membershipId;
    await ownerA.agent
      .delete(`/api/v1/organizations/${orgB.id}/members/${ownerBMembershipId}`)
      .set(CSRF_HEADERS)
      .expect(403);

    // orgA no listada para el dueño de B.
    const orgsOfB = await ownerB.agent.get("/api/v1/organizations");
    expect(orgsOfB.body.map((o: { id: string }) => o.id)).not.toContain(orgA.id);
  });

  it("rechaza aceptar una invitación que no es propia", async () => {
    const owner = await registerLoggedInUser();
    const invitee = await registerLoggedInUser();
    const outsider = await registerLoggedInUser();
    const org = await createOrg(owner.agent);

    const invite = await owner.agent
      .post(`/api/v1/organizations/${org.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: invitee.email, role: "EDITOR" })
      .expect(201);

    await outsider.agent
      .post(`/api/v1/memberships/${invite.body.membershipId}/accept`)
      .set(CSRF_HEADERS)
      .expect(404);
  });
});
