import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PrismaClient } from "@impulza/database";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import cookieParser from "cookie-parser";
import { generate } from "otplib";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { assignRoomyPlan } from "../../test-support/plans.js";

// Verifica que las acciones sensibles listadas en F1.7 (cambios de rol, invitaciones, remociones,
// login fallido repetido, cambios de 2FA) dejan de verdad una fila en audit_logs — con actor,
// acción, objetivo y timestamp — no solo que el endpoint de negocio funcione.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@audit-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(): string {
  return `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Audit log (e2e) — F1.7", () => {
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

    httpServer = app.getHttpServer();
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { actor: { email: { endsWith: TEST_EMAIL_DOMAIN } } },
    });
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

  async function registerLoggedInUser(): Promise<{
    email: string;
    userId: string;
    agent: ReturnType<typeof request.agent>;
  }> {
    const email = uniqueEmail();
    const password = "password1234";
    const agent = request.agent(httpServer);

    const registerResponse = await request(httpServer)
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

    return { email, userId: registerResponse.body.userId, agent };
  }

  it("registra organization.created, membership.invited, .role_changed y .removed con el actor correcto", async () => {
    const owner = await registerLoggedInUser();
    const member = await registerLoggedInUser();

    const orgResponse = await owner.agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Audit Org", slug: uniqueSlug() })
      .expect(201);
    const orgId: string = orgResponse.body.id;
    // Plan con cupo (F4.2): esta prueba verifica otra cosa, no los límites de Gratis.
    await assignRoomyPlan(prisma, orgId);

    const createdLog = await prisma.auditLog.findFirst({
      where: { action: "organization.created", targetId: orgId },
    });
    expect(createdLog).toMatchObject({ actorId: owner.userId, organizationId: orgId, targetType: "Organization" });

    const invite = await owner.agent
      .post(`/api/v1/organizations/${orgId}/members`)
      .set(CSRF_HEADERS)
      .send({ email: member.email, role: "EDITOR" })
      .expect(201);
    const membershipId: string = invite.body.membershipId;

    const invitedLog = await prisma.auditLog.findFirst({
      where: { action: "membership.invited", targetId: membershipId },
    });
    expect(invitedLog).toMatchObject({ actorId: owner.userId, organizationId: orgId });
    expect(invitedLog?.metadata).toMatchObject({ email: member.email, role: "EDITOR" });
    // Nunca contraseñas/hashes/tokens en metadata (ST §16).
    expect(JSON.stringify(invitedLog?.metadata)).not.toMatch(/password|hash|token/i);

    await member.agent.post(`/api/v1/memberships/${membershipId}/accept`).set(CSRF_HEADERS).expect(204);

    await owner.agent
      .patch(`/api/v1/organizations/${orgId}/members/${membershipId}`)
      .set(CSRF_HEADERS)
      .send({ role: "ANALYST" })
      .expect(204);

    const roleChangedLog = await prisma.auditLog.findFirst({
      where: { action: "membership.role_changed", targetId: membershipId },
    });
    expect(roleChangedLog).toMatchObject({ actorId: owner.userId });
    expect(roleChangedLog?.metadata).toMatchObject({ previousRole: "EDITOR", newRole: "ANALYST" });

    await owner.agent
      .delete(`/api/v1/organizations/${orgId}/members/${membershipId}`)
      .set(CSRF_HEADERS)
      .expect(204);

    const removedLog = await prisma.auditLog.findFirst({
      where: { action: "membership.removed", targetId: membershipId },
    });
    expect(removedLog).toMatchObject({ actorId: owner.userId });
  });

  it("registra auth.account_locked sin actor (nadie demostró identidad) tras 5 intentos fallidos", async () => {
    const { email, userId } = await registerLoggedInUser();

    for (let i = 0; i < 5; i += 1) {
      await request(httpServer)
        .post("/api/v1/auth/login")
        .set(CSRF_HEADERS)
        .send({ email, password: "incorrecta" });
    }

    const lockedLog = await prisma.auditLog.findFirst({
      where: { action: "auth.account_locked", targetId: userId },
    });
    expect(lockedLog).toMatchObject({ actorId: null, targetType: "User" });
  });

  it("registra auth.password_reset y auth.two_factor_enabled con el propio usuario como actor", async () => {
    const { email, userId, agent } = await registerLoggedInUser();

    await request(httpServer).post("/api/v1/auth/forgot-password").set(CSRF_HEADERS).send({ email }).expect(204);
    const resetToken = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer)
      .post("/api/v1/auth/reset-password")
      .set(CSRF_HEADERS)
      .send({ token: resetToken, password: "nueva-password-9999" })
      .expect(204);

    const resetLog = await prisma.auditLog.findFirst({
      where: { action: "auth.password_reset", targetId: userId },
    });
    expect(resetLog).toMatchObject({ actorId: userId });

    const newAgent = request.agent(httpServer);
    await newAgent
      .post("/api/v1/auth/login")
      .set(CSRF_HEADERS)
      .send({ email, password: "nueva-password-9999" })
      .expect(201);

    const setup = await newAgent.post("/api/v1/auth/2fa/setup").set(CSRF_HEADERS).expect(201);
    const code = await generate({ secret: setup.body.secret });
    await newAgent.post("/api/v1/auth/2fa/enable").set(CSRF_HEADERS).send({ code }).expect(204);

    const enabledLog = await prisma.auditLog.findFirst({
      where: { action: "auth.two_factor_enabled", targetId: userId },
    });
    expect(enabledLog).toMatchObject({ actorId: userId });

    // La sesión vieja (de "agent", antes del reset) ya no sirve — limpieza defensiva del test.
    await agent.get("/api/v1/auth/sessions").expect(401);
  });
});
