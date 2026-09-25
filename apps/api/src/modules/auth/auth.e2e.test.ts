import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  currentUserResponse,
  loginResponse as loginContract,
  registerResponse,
  sessionResponse,
  twoFactorSetupResponse,
} from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "./email-adapter.token.js";
import { listenForTests } from "../../test-support/http.js";

// Pruebas de integración reales: NestJS de verdad + Postgres/Redis reales de docker-compose.yml
// (no mocks de la base de datos — F1.9 exige exactamente esto para aislamiento multi-tenant, y
// aquí se sienta el mismo patrón para auth). El único doble de prueba es el adaptador de email,
// sustituido por su contrato público (EmailAdapter), no por acceso a internals.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }

  lastToken(): string {
    const last = this.messages.at(-1);
    if (!last) {
      throw new Error("FakeEmailAdapter: no se envió ningún correo todavía.");
    }
    const match = /token=([a-f0-9]+)/.exec(last.text);
    if (!match?.[1]) {
      throw new Error("FakeEmailAdapter: no se encontró un token en el último correo.");
    }
    return match[1];
  }
}

const TEST_EMAIL_DOMAIN = "@auth-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

describe("Auth (e2e)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;

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
    baseUrl = await listenForTests(app);

    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    // El rate limiting es real (Redis) — se limpia entre tests para que no interfieran entre sí.
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function registerAndVerify(password = "password1234"): Promise<{ email: string }> {
    const email = uniqueEmail();
    const registered = await request(baseUrl)
      .post("/api/v1/auth/register")
      .set(CSRF_HEADERS)
      .send({ email, password })
      .expect(201);

    registerResponse.parse(registered.body);

    const token = emailAdapter.lastToken();
    await request(baseUrl)
      .post("/api/v1/auth/verify-email")
      .set(CSRF_HEADERS)
      .send({ token })
      .expect(204);

    return { email };
  }

  it("GET /auth/me devuelve el usuario autenticado y rechaza sin cookie", async () => {
    const { email } = await registerAndVerify();
    const agent = request.agent(baseUrl);

    await agent
      .post("/api/v1/auth/login")
      .set(CSRF_HEADERS)
      .send({ email, password: "password1234" })
      .expect(201);

    const me = await agent.get("/api/v1/auth/me").expect(200);
    currentUserResponse.parse(me.body);
    // El contrato dice que acá no hay hash, secreto 2FA ni token. Eso solo es cierto si se
    // comprueba: `parse` valida lo que está, esta línea valida lo que NO está.
    expect(Object.keys(me.body).sort()).toEqual(["email", "emailVerifiedAt", "id"]);
    expect(me.body.email).toBe(email);
    expect(me.body.emailVerifiedAt).not.toBeNull();

    await request(baseUrl).get("/api/v1/auth/me").expect(401);
  });

  it("registra, verifica el correo y permite iniciar sesión", async () => {
    const { email } = await registerAndVerify();

    const loginResponse = await request(baseUrl)
      .post("/api/v1/auth/login")
      .set(CSRF_HEADERS)
      .send({ email, password: "password1234" })
      .expect(201);

    loginContract.parse(loginResponse.body);
    expect(Object.keys(loginResponse.body)).toEqual(["user"]);
    expect(Object.keys(loginResponse.body.user).sort()).toEqual(["email", "id"]);
    expect(loginResponse.body.user.email).toBe(email);
    expect(loginResponse.headers["set-cookie"]?.[0]).toMatch(/impulza_session=.*HttpOnly/);
  });

  it("rechaza login con contraseña incorrecta sin revelar si el correo existe", async () => {
    const { email } = await registerAndVerify();

    const wrongPassword = await request(baseUrl)
      .post("/api/v1/auth/login")
      .set(CSRF_HEADERS)
      .send({ email, password: "incorrecta" })
      .expect(401);

    const nonExistentEmail = await request(baseUrl)
      .post("/api/v1/auth/login")
      .set(CSRF_HEADERS)
      .send({ email: uniqueEmail(), password: "cualquiera" })
      .expect(401);

    expect(wrongPassword.body.message).toBe(nonExistentEmail.body.message);
  });

  it("bloquea la cuenta temporalmente tras demasiados intentos fallidos", async () => {
    const { email } = await registerAndVerify();

    for (let i = 0; i < 5; i += 1) {
      await request(baseUrl)
        .post("/api/v1/auth/login")
        .set(CSRF_HEADERS)
        .send({ email, password: "incorrecta" });
    }

    const lockedAttempt = await request(baseUrl)
      .post("/api/v1/auth/login")
      .set(CSRF_HEADERS)
      .send({ email, password: "password1234" }); // incluso con la contraseña correcta

    expect(lockedAttempt.status).toBe(403);
  });

  it("exige la cabecera CSRF en solicitudes mutantes", async () => {
    await request(baseUrl)
      .post("/api/v1/auth/register")
      .send({ email: uniqueEmail(), password: "password1234" })
      .expect(403);
  });

  it("aplica rate limiting por IP en /register", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 7 }, () =>
        request(baseUrl)
          .post("/api/v1/auth/register")
          .set(CSRF_HEADERS)
          .send({ email: uniqueEmail(), password: "password1234" }),
      ),
    );

    const tooManyRequests = attempts.filter((response) => response.status === 429);
    expect(tooManyRequests.length).toBeGreaterThan(0);
  });

  it("rechaza acceso a rutas protegidas sin cookie de sesión", async () => {
    await request(baseUrl).get("/api/v1/auth/sessions").expect(401);
  });

  it("lista y revoca sesiones propias, y rechaza revocar una sesión ajena", async () => {
    const { email } = await registerAndVerify();
    const agent = request.agent(baseUrl);

    await agent
      .post("/api/v1/auth/login")
      .set(CSRF_HEADERS)
      .send({ email, password: "password1234" })
      .expect(201);

    const sessionsResponse = await agent.get("/api/v1/auth/sessions").expect(200);
    for (const session of sessionsResponse.body) {
      sessionResponse.parse(session);
    }
    expect(sessionsResponse.body).toHaveLength(1);
    expect(sessionsResponse.body[0].current).toBe(true);
    const sessionId: string = sessionsResponse.body[0].id;

    // Segundo usuario: su sesión no debe poder revocar la del primero.
    const { email: otherEmail } = await registerAndVerify();
    const otherAgent = request.agent(baseUrl);
    await otherAgent
      .post("/api/v1/auth/login")
      .set(CSRF_HEADERS)
      .send({ email: otherEmail, password: "password1234" })
      .expect(201);

    await otherAgent
      .delete(`/api/v1/auth/sessions/${sessionId}`)
      .set(CSRF_HEADERS)
      .expect(401);

    await agent.delete(`/api/v1/auth/sessions/${sessionId}`).set(CSRF_HEADERS).expect(204);
    await agent.get("/api/v1/auth/sessions").expect(401);
  });

  it("logout invalida la sesión actual", async () => {
    const { email } = await registerAndVerify();
    const agent = request.agent(baseUrl);

    await agent
      .post("/api/v1/auth/login")
      .set(CSRF_HEADERS)
      .send({ email, password: "password1234" })
      .expect(201);

    await agent.post("/api/v1/auth/logout").set(CSRF_HEADERS).expect(204);
    await agent.get("/api/v1/auth/sessions").expect(401);
  });

  it("recupera la contraseña, revoca sesiones activas y rechaza reusar el token", async () => {
    const { email } = await registerAndVerify();
    const agent = request.agent(baseUrl);

    await agent
      .post("/api/v1/auth/login")
      .set(CSRF_HEADERS)
      .send({ email, password: "password1234" })
      .expect(201);

    await request(baseUrl)
      .post("/api/v1/auth/forgot-password")
      .set(CSRF_HEADERS)
      .send({ email })
      .expect(204);

    const resetToken = emailAdapter.lastToken();

    await request(baseUrl)
      .post("/api/v1/auth/reset-password")
      .set(CSRF_HEADERS)
      .send({ token: resetToken, password: "nueva-password-5678" })
      .expect(204);

    // La sesión que estaba activa antes del reseteo queda revocada.
    await agent.get("/api/v1/auth/sessions").expect(401);

    // La contraseña vieja ya no sirve.
    await request(baseUrl)
      .post("/api/v1/auth/login")
      .set(CSRF_HEADERS)
      .send({ email, password: "password1234" })
      .expect(401);

    // La nueva sí.
    await request(baseUrl)
      .post("/api/v1/auth/login")
      .set(CSRF_HEADERS)
      .send({ email, password: "nueva-password-5678" })
      .expect(201);

    // El token de reseteo no se puede reusar.
    await request(baseUrl)
      .post("/api/v1/auth/reset-password")
      .set(CSRF_HEADERS)
      .send({ token: resetToken, password: "otra-mas-1234" })
      .expect(401);
  });

  it("responde igual en /forgot-password exista o no la cuenta (sin enumeración)", async () => {
    const { email } = await registerAndVerify();

    const existing = await request(baseUrl)
      .post("/api/v1/auth/forgot-password")
      .set(CSRF_HEADERS)
      .send({ email })
      .expect(204);

    const nonExisting = await request(baseUrl)
      .post("/api/v1/auth/forgot-password")
      .set(CSRF_HEADERS)
      .send({ email: uniqueEmail() })
      .expect(204);

    expect(existing.text).toBe(nonExisting.text);
  });

  it("configura y habilita 2FA con un código TOTP válido", async () => {
    const { email } = await registerAndVerify();
    const agent = request.agent(baseUrl);

    await agent
      .post("/api/v1/auth/login")
      .set(CSRF_HEADERS)
      .send({ email, password: "password1234" })
      .expect(201);

    const setupResponse = await agent.post("/api/v1/auth/2fa/setup").set(CSRF_HEADERS).expect(201);
    twoFactorSetupResponse.parse(setupResponse.body);
    expect(setupResponse.body.secret).toBeTruthy();
    expect(setupResponse.body.otpauthUrl).toContain("otpauth://totp/");

    const { generate } = await import("otplib");
    const code = await generate({ secret: setupResponse.body.secret });

    await agent.post("/api/v1/auth/2fa/enable").set(CSRF_HEADERS).send({ code }).expect(204);

    const rejectedCode = await agent
      .post("/api/v1/auth/2fa/disable")
      .set(CSRF_HEADERS)
      .send({ code: "000000" });
    expect(rejectedCode.status).toBe(401);
  });
});
