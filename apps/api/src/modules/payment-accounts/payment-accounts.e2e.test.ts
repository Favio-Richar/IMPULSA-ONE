import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { paymentAccountConnectResponse, paymentAccountsResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { codeChallengeFor, FakeMercadoPagoOAuth } from "@impulza/payments";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { PaymentAccountsService } from "./payment-accounts.service.js";
import { MERCADO_PAGO_OAUTH } from "./payment-accounts.tokens.js";

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@payment-accounts-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Cuenta de Mercado Pago del negocio (e2e) — F5.8, ADR-013", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let oauth: FakeMercadoPagoOAuth;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    oauth = new FakeMercadoPagoOAuth();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(MERCADO_PAGO_OAUTH)
      .useValue(oauth)
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
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  async function registerUser() {
    const email = `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
    const password = "password1234";
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);
    return { agent, email };
  }

  async function createOrg() {
    const owner = await registerUser();
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Pastelería Sol", slug: uniqueSlug("org") }).expect(201);
    return { ...owner, organizationId: org.body.id as string };
  }

  const base = (organizationId: string) => `/api/v1/organizations/${organizationId}/payment-accounts`;

  /** Empieza la conexión y devuelve el `state` y el desafío PKCE de la URL de autorización. */
  async function startConnect(agent: ReturnType<typeof request.agent>, organizationId: string) {
    const res = await agent.post(`${base(organizationId)}/mercadopago/connect`).set(CSRF_HEADERS).expect(201);
    const url = new URL(paymentAccountConnectResponse.parse(res.body).url);
    return { state: url.searchParams.get("state")!, challenge: url.searchParams.get("code_challenge")!, redirectUri: url.searchParams.get("redirect_uri")! };
  }

  const callback = (query: string) => request(httpServer).get(`/api/v1/payments/mercadopago/oauth/callback?${query}`).expect(303);

  it("el dueño conecta su cuenta: PKCE correcto, tokens cifrados, auditado y nunca en las respuestas", async () => {
    const { agent, organizationId } = await createOrg();
    expect(paymentAccountsResponse.parse((await agent.get(base(organizationId)).expect(200)).body)).toEqual({ available: true, canManage: true, mercadoPago: null });

    const { state, challenge, redirectUri } = await startConnect(agent, organizationId);
    expect(redirectUri).toMatch(/\/api\/v1\/payments\/mercadopago\/oauth\/callback$/);
    const back = await callback(`code=ok-123&state=${state}`);
    expect(back.headers.location).toMatch(/\/cobros\?conexion=conectada$/);

    // El verificador enviado a Mercado Pago corresponde al desafío de la URL (PKCE S256).
    const exchange = oauth.exchanges.at(-1)!;
    expect(codeChallengeFor(exchange.codeVerifier)).toBe(challenge);
    expect(exchange.redirectUri).toBe(redirectUri);

    const account = await prisma.paymentAccount.findFirstOrThrow({ where: { organizationId } });
    expect(account).toMatchObject({ provider: "MERCADO_PAGO", status: "CONNECTED", liveMode: false });
    expect(account.accessTokenEncrypted).not.toContain("APP_USR");
    expect(account.refreshTokenEncrypted).not.toContain("TG-refresh");

    const status = (await agent.get(base(organizationId)).expect(200)).body;
    expect(status.mercadoPago).toMatchObject({ status: "CONNECTED", liveMode: false });
    expect(JSON.stringify(status)).not.toMatch(/APP_USR|TG-refresh/);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId, action: "payments.account_connected" } });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/APP_USR|TG-refresh/);

    // El token solo lo obtiene el servicio, descifrado, para esa organización.
    expect(await app.get(PaymentAccountsService).accessTokenFor(organizationId)).toMatch(/^APP_USR-access-/);
  });

  it("el state sirve una sola vez; uno ajeno, vencido o ausente no conecta nada", async () => {
    const { agent, organizationId } = await createOrg();
    const { state } = await startConnect(agent, organizationId);
    expect((await callback(`code=ok-1&state=${state}`)).headers.location).toMatch(/conexion=conectada$/);
    await prisma.paymentAccount.deleteMany({ where: { organizationId } });

    expect((await callback(`code=ok-2&state=${state}`)).headers.location).toMatch(/conexion=vencida$/);
    expect((await callback("code=ok-3&state=inventado")).headers.location).toMatch(/conexion=vencida$/);
    expect((await callback("code=ok-4")).headers.location).toMatch(/conexion=error$/);
    expect(await prisma.paymentAccount.count({ where: { organizationId } })).toBe(0);
  });

  it("si el dueño rechaza en Mercado Pago o el código no sirve, no se guarda nada", async () => {
    const { agent, organizationId } = await createOrg();
    const denied = await startConnect(agent, organizationId);
    expect((await callback(`error=access_denied&state=${denied.state}`)).headers.location).toMatch(/conexion=cancelada$/);
    const bad = await startConnect(agent, organizationId);
    expect((await callback(`code=malo&state=${bad.state}`)).headers.location).toMatch(/conexion=error$/);
    expect(await prisma.paymentAccount.count({ where: { organizationId } })).toBe(0);
  });

  it("si pierde el permiso mientras autoriza en Mercado Pago, la conexión no se completa", async () => {
    const { agent, organizationId, email } = await createOrg();
    const { state } = await startConnect(agent, organizationId);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const editor = await prisma.role.findUniqueOrThrow({ where: { name: "EDITOR" } });
    await prisma.membership.update({ where: { userId_organizationId: { userId: user.id, organizationId } }, data: { roleId: editor.id } });

    expect((await callback(`code=ok-9&state=${state}`)).headers.location).toMatch(/conexion=sin-permiso$/);
    expect(await prisma.paymentAccount.count({ where: { organizationId } })).toBe(0);
  });

  it("un ADMIN ve el estado pero no conecta ni desconecta", async () => {
    const { organizationId } = await createOrg();
    const admin = await registerUser();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: admin.email } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "ADMIN" } });
    await prisma.membership.create({ data: { userId: user.id, organizationId, roleId: role.id, status: "ACTIVE", acceptedAt: new Date() } });

    expect((await admin.agent.get(base(organizationId)).expect(200)).body.canManage).toBe(false);
    await admin.agent.post(`${base(organizationId)}/mercadopago/connect`).set(CSRF_HEADERS).expect(403);
    await admin.agent.delete(`${base(organizationId)}/mercadopago`).set(CSRF_HEADERS).expect(403);
  });

  it("desconectar borra los tokens y queda auditado; sin cuenta, 404", async () => {
    const { agent, organizationId } = await createOrg();
    const { state } = await startConnect(agent, organizationId);
    await callback(`code=ok-5&state=${state}`);

    await agent.delete(`${base(organizationId)}/mercadopago`).set(CSRF_HEADERS).expect(204);
    expect(await prisma.paymentAccount.count({ where: { organizationId } })).toBe(0);
    expect(await app.get(PaymentAccountsService).accessTokenFor(organizationId)).toBeNull();
    expect(await prisma.auditLog.count({ where: { organizationId, action: "payments.account_disconnected" } })).toBe(1);
    expect((await agent.delete(`${base(organizationId)}/mercadopago`).set(CSRF_HEADERS).expect(404)).body.code).toBe("NOT_CONNECTED");
  });

  it("con la cuenta en error o vencida, nunca se entrega el token", async () => {
    const { agent, organizationId } = await createOrg();
    const { state } = await startConnect(agent, organizationId);
    await callback(`code=ok-6&state=${state}`);
    const service = app.get(PaymentAccountsService);

    await prisma.paymentAccount.updateMany({ where: { organizationId }, data: { status: "ERROR", lastError: "refresh_rejected" } });
    expect(await service.accessTokenFor(organizationId)).toBeNull();
    await prisma.paymentAccount.updateMany({ where: { organizationId }, data: { status: "CONNECTED", lastError: null, expiresAt: new Date(Date.now() - 1000) } });
    expect(await service.accessTokenFor(organizationId)).toBeNull();
  });

  it("aislamiento: otra organización no ve, conecta ni desconecta la cuenta de B", async () => {
    const a = await createOrg();
    const b = await createOrg();
    const { state } = await startConnect(b.agent, b.organizationId);
    await callback(`code=ok-7&state=${state}`);

    await a.agent.get(base(b.organizationId)).expect(403);
    await a.agent.post(`${base(b.organizationId)}/mercadopago/connect`).set(CSRF_HEADERS).expect(403);
    await a.agent.delete(`${base(b.organizationId)}/mercadopago`).set(CSRF_HEADERS).expect(403);
    expect((await a.agent.get(base(a.organizationId)).expect(200)).body.mercadoPago).toBeNull();
    expect(await app.get(PaymentAccountsService).accessTokenFor(a.organizationId)).toBeNull();
    expect(await prisma.paymentAccount.count({ where: { organizationId: b.organizationId } })).toBe(1);
  });
});
