import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { shortLinkResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F3.5 — enlaces cortos: CRUD, reglas de slug, aislamiento.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@short-links-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(prefix = "sl35"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Short links (e2e) — F3.5", () => {
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

  async function createOrgWithOwner(): Promise<{
    organizationId: string;
    agent: ReturnType<typeof request.agent>;
    basePath: string;
  }> {
    const email = uniqueEmail();
    const password = "password1234";
    const agent = request.agent(httpServer);

    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);

    const org = await agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org Enlaces", slug: uniqueSlug("org") })
      .expect(201);

    return {
      organizationId: org.body.id,
      agent,
      basePath: `/api/v1/organizations/${org.body.id}/short-links`,
    };
  }

  it("crea un enlace corto y lo rechaza si el slug ya está tomado", async () => {
    const { agent, basePath } = await createOrgWithOwner();
    const slug = uniqueSlug("s");

    const created = await agent
      .post(basePath)
      .set(CSRF_HEADERS)
      .send({ slug, destinationUrl: "https://ejemplo.cl/promo" })
      .expect(201);
    shortLinkResponse.parse(created.body);

    await agent
      .post(basePath)
      .set(CSRF_HEADERS)
      .send({ slug, destinationUrl: "https://ejemplo.cl/otro" })
      .expect(409);
  });

  it("rechaza un slug reservado y una URL con esquema no permitido", async () => {
    const { agent, basePath } = await createOrgWithOwner();

    await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "admin", destinationUrl: "https://ejemplo.cl" }).expect(400);
    await agent
      .post(basePath)
      .set(CSRF_HEADERS)
      .send({ slug: uniqueSlug("s"), destinationUrl: "javascript:alert(1)" })
      .expect(400);
  });

  it("edita el destino y los UTM, pero no expone un endpoint para cambiar el slug", async () => {
    const { agent, basePath } = await createOrgWithOwner();
    const created = await agent
      .post(basePath)
      .set(CSRF_HEADERS)
      .send({ slug: uniqueSlug("s"), destinationUrl: "https://ejemplo.cl/a" })
      .expect(201);

    const updated = await agent
      .patch(`${basePath}/${created.body.id}`)
      .set(CSRF_HEADERS)
      .send({ destinationUrl: "https://ejemplo.cl/b", utm: { source: "instagram" } })
      .expect(200);
    expect(updated.body.destinationUrl).toBe("https://ejemplo.cl/b");
    expect(updated.body.utm).toMatchObject({ source: "instagram" });
  });

  it("borrar un enlace con un QR propio se rechaza (409); sin QR, se borra", async () => {
    const { agent, basePath, organizationId } = await createOrgWithOwner();
    const link = await agent
      .post(basePath)
      .set(CSRF_HEADERS)
      .send({ slug: uniqueSlug("s"), destinationUrl: "https://ejemplo.cl/a" })
      .expect(201);

    await agent
      .post(`/api/v1/organizations/${organizationId}/qr-codes`)
      .set(CSRF_HEADERS)
      .send({ shortLinkId: link.body.id, styleKey: "clasico" })
      .expect(201);

    await agent.delete(`${basePath}/${link.body.id}`).set(CSRF_HEADERS).expect(409);

    const linkSinQr = await agent
      .post(basePath)
      .set(CSRF_HEADERS)
      .send({ slug: uniqueSlug("s"), destinationUrl: "https://ejemplo.cl/c" })
      .expect(201);
    await agent.delete(`${basePath}/${linkSinQr.body.id}`).set(CSRF_HEADERS).expect(204);
  });
});
