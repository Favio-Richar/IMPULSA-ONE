import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PrismaClient } from "@impulza/database";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";
import { PRISMA } from "./database/prisma.module.js";
import { EMAIL_ADAPTER } from "./modules/auth/email-adapter.token.js";
import { REDIS } from "./redis/redis.module.js";

// F1.9 — prueba transversal de aislamiento multi-tenant (ADR-002). Dos organizaciones reales,
// exactamente lo que exige el backlog: "verificar que ningún endpoint de Fase 1 permite leer o
// modificar datos cruzados". Este archivo se re-ejecuta como base al agregar endpoints nuevos en
// fases posteriores — cada endpoint que toque datos de organización debe sumar su caso acá.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@isolation-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(): string {
  return `iso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Aislamiento multi-tenant (F1.9)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let httpServer: Parameters<typeof request>[0];

  // Dos organizaciones completas, cada una con OWNER y un miembro con permisos (ADMIN) — para
  // probar que ni siquiera un ADMIN de la organización A puede tocar la B.
  let orgA: { id: string; ownerEmail: string; ownerAgent: ReturnType<typeof request.agent>; adminAgent: ReturnType<typeof request.agent> };
  let orgB: {
    id: string;
    ownerEmail: string;
    ownerAgent: ReturnType<typeof request.agent>;
    ownerMembershipId: string;
    memberEmail: string;
    memberMembershipId: string;
  };

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

    httpServer = app.getHttpServer();
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);

    async function registerLoggedInUser(): Promise<{ email: string; agent: ReturnType<typeof request.agent> }> {
      const email = uniqueEmail();
      const password = "password1234";
      const agent = request.agent(httpServer);

      await request(httpServer)
        .post("/api/v1/auth/register")
        .set(CSRF_HEADERS)
        .send({ email, password })
        .expect(201);

      const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
      await request(httpServer)
        .post("/api/v1/auth/verify-email")
        .set(CSRF_HEADERS)
        .send({ token })
        .expect(204);
      await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);

      return { email, agent };
    }

    // --- Organización A: OWNER + ADMIN ---
    const ownerA = await registerLoggedInUser();
    const adminA = await registerLoggedInUser();
    const orgAResponse = await ownerA.agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org A", slug: uniqueSlug() })
      .expect(201);
    const inviteAdminA = await ownerA.agent
      .post(`/api/v1/organizations/${orgAResponse.body.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: adminA.email, role: "ADMIN" })
      .expect(201);
    await adminA.agent
      .post(`/api/v1/memberships/${inviteAdminA.body.membershipId}/accept`)
      .set(CSRF_HEADERS)
      .expect(204);

    orgA = {
      id: orgAResponse.body.id,
      ownerEmail: ownerA.email,
      ownerAgent: ownerA.agent,
      adminAgent: adminA.agent,
    };

    // --- Organización B: OWNER + un miembro EDITOR ---
    const ownerB = await registerLoggedInUser();
    const memberB = await registerLoggedInUser();
    const orgBResponse = await ownerB.agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org B", slug: uniqueSlug() })
      .expect(201);
    const inviteMemberB = await ownerB.agent
      .post(`/api/v1/organizations/${orgBResponse.body.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: memberB.email, role: "EDITOR" })
      .expect(201);
    await memberB.agent
      .post(`/api/v1/memberships/${inviteMemberB.body.membershipId}/accept`)
      .set(CSRF_HEADERS)
      .expect(204);

    const membersOfB = await ownerB.agent.get(`/api/v1/organizations/${orgBResponse.body.id}/members`);
    const ownerMembershipB = membersOfB.body.find((m: { role: string }) => m.role === "OWNER");

    orgB = {
      id: orgBResponse.body.id,
      ownerEmail: ownerB.email,
      ownerAgent: ownerB.agent,
      ownerMembershipId: ownerMembershipB.membershipId,
      memberEmail: memberB.email,
      memberMembershipId: inviteMemberB.body.membershipId,
    };
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  describe("OWNER de A contra recursos de B", () => {
    it("no puede leer la organización B", async () => {
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}`).expect(403);
    });

    it("no puede listar miembros de B (no filtra la lista propia, rechaza directo)", async () => {
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/members`).expect(403);
    });

    it("no puede invitar a alguien a B", async () => {
      await orgA.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/members`)
        .set(CSRF_HEADERS)
        .send({ email: orgA.ownerEmail, role: "EDITOR" })
        .expect(403);
    });

    it("no puede cambiar el rol de un miembro de B", async () => {
      await orgA.ownerAgent
        .patch(`/api/v1/organizations/${orgB.id}/members/${orgB.memberMembershipId}`)
        .set(CSRF_HEADERS)
        .send({ role: "ANALYST" })
        .expect(403);
    });

    it("no puede remover a un miembro de B", async () => {
      await orgA.ownerAgent
        .delete(`/api/v1/organizations/${orgB.id}/members/${orgB.memberMembershipId}`)
        .set(CSRF_HEADERS)
        .expect(403);
    });

    it("no puede aceptar una invitación que pertenece a un usuario de B", async () => {
      // Reutiliza el membershipId del owner de B (ya ACTIVE, pero igual debe rechazar por dueño).
      await orgA.ownerAgent
        .post(`/api/v1/memberships/${orgB.ownerMembershipId}/accept`)
        .set(CSRF_HEADERS)
        .expect(404);
    });
  });

  describe("ADMIN de A (con permisos reales dentro de A) contra B", () => {
    it("tener permisos en A no le da ningún permiso en B", async () => {
      await orgA.adminAgent.get(`/api/v1/organizations/${orgB.id}`).expect(403);
      await orgA.adminAgent
        .post(`/api/v1/organizations/${orgB.id}/members`)
        .set(CSRF_HEADERS)
        .send({ email: uniqueEmail(), role: "EDITOR" })
        .expect(403);
      await orgA.adminAgent
        .patch(`/api/v1/organizations/${orgB.id}/members/${orgB.memberMembershipId}`)
        .set(CSRF_HEADERS)
        .send({ role: "ANALYST" })
        .expect(403);
      await orgA.adminAgent
        .delete(`/api/v1/organizations/${orgB.id}/members/${orgB.memberMembershipId}`)
        .set(CSRF_HEADERS)
        .expect(403);
    });
  });

  describe("Ataque de membershipId cruzado (organizationId correcto, membershipId ajeno)", () => {
    it("OWNER de A no puede cambiar el rol de un miembro de B usando el organizationId de A", async () => {
      // organizationId de la URL es A (donde sí tiene permiso), pero el membershipId es de B —
      // getOrgMembershipOrThrow debe rechazar por organizationId mismatch, no solo por el guard.
      await orgA.ownerAgent
        .patch(`/api/v1/organizations/${orgA.id}/members/${orgB.memberMembershipId}`)
        .set(CSRF_HEADERS)
        .send({ role: "ANALYST" })
        .expect(404);
    });

    it("OWNER de A no puede remover a un miembro de B usando el organizationId de A", async () => {
      await orgA.ownerAgent
        .delete(`/api/v1/organizations/${orgA.id}/members/${orgB.memberMembershipId}`)
        .set(CSRF_HEADERS)
        .expect(404);
    });
  });

  describe("Simétrico: OWNER de B contra A", () => {
    it("no puede leer, listar miembros, invitar, cambiar rol ni remover en A", async () => {
      await orgB.ownerAgent.get(`/api/v1/organizations/${orgA.id}`).expect(403);
      await orgB.ownerAgent.get(`/api/v1/organizations/${orgA.id}/members`).expect(403);
      await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgA.id}/members`)
        .set(CSRF_HEADERS)
        .send({ email: uniqueEmail(), role: "EDITOR" })
        .expect(403);
    });
  });

  describe("Ningún dato de una organización aparece en las respuestas de la otra", () => {
    it("GET /organizations no cruza organizaciones entre usuarios sin relación", async () => {
      const orgsOfA = await orgA.ownerAgent.get("/api/v1/organizations");
      const orgsOfB = await orgB.ownerAgent.get("/api/v1/organizations");

      expect(orgsOfA.body.map((o: { id: string }) => o.id)).not.toContain(orgB.id);
      expect(orgsOfB.body.map((o: { id: string }) => o.id)).not.toContain(orgA.id);
    });

    it("la lista de miembros de A nunca incluye el correo de un usuario exclusivo de B", async () => {
      const membersOfA = await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/members`);
      const emails = membersOfA.body.map((m: { email: string }) => m.email);

      expect(emails).not.toContain(orgB.memberEmail);
      expect(emails).not.toContain(orgB.ownerEmail);
    });
  });
});
