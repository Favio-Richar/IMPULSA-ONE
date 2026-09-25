import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { qrCodeResponse } from "@impulza/contracts";
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
import { listenForTests } from "../../test-support/http.js";

// F3.5 — códigos QR: catálogo cerrado de estilos, enlace corto o URL directa.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@qr-codes-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(prefix = "qr35"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("QR codes (e2e) — F3.5", () => {
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

  async function createOrgWithOwner(): Promise<{
    organizationId: string;
    agent: ReturnType<typeof request.agent>;
    qrBasePath: string;
    linkBasePath: string;
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
      .send({ name: "Org QR", slug: uniqueSlug("org") })
      .expect(201);

    return {
      organizationId: org.body.id,
      agent,
      qrBasePath: `/api/v1/organizations/${org.body.id}/qr-codes`,
      linkBasePath: `/api/v1/organizations/${org.body.id}/short-links`,
    };
  }

  it("crea un QR con URL directa, con el estilo resuelto y guardado completo", async () => {
    const { agent, qrBasePath } = await createOrgWithOwner();

    const created = await agent
      .post(qrBasePath)
      .set(CSRF_HEADERS)
      .send({ directUrl: "https://ejemplo.cl/folleto", styleKey: "marca" })
      .expect(201);

    qrCodeResponse.parse(created.body);
    expect(created.body.styleConfig).toMatchObject({ key: "marca", foreground: "#0b5450", background: "#ffffff" });
  });

  it("rechaza crear un QR sin enlace corto ni URL directa", async () => {
    const { agent, qrBasePath } = await createOrgWithOwner();

    await agent.post(qrBasePath).set(CSRF_HEADERS).send({ styleKey: "clasico" }).expect(400);
  });

  it("rechaza un estilo fuera del catálogo cerrado", async () => {
    const { agent, qrBasePath } = await createOrgWithOwner();

    await agent
      .post(qrBasePath)
      .set(CSRF_HEADERS)
      .send({ directUrl: "https://ejemplo.cl", styleKey: "rosado-fluor" })
      .expect(400);
  });

  it("rechaza un shortLinkId que no existe en la organización", async () => {
    const { agent, qrBasePath } = await createOrgWithOwner();

    await agent
      .post(qrBasePath)
      .set(CSRF_HEADERS)
      .send({ shortLinkId: "00000000-0000-0000-0000-000000000000", styleKey: "clasico" })
      .expect(404);
  });

  it("crea un QR sobre un enlace corto propio y luego se puede borrar sin bloquear nada", async () => {
    const { agent, qrBasePath, linkBasePath } = await createOrgWithOwner();
    const link = await agent
      .post(linkBasePath)
      .set(CSRF_HEADERS)
      .send({ slug: uniqueSlug("s"), destinationUrl: "https://ejemplo.cl/a" })
      .expect(201);

    const qr = await agent
      .post(qrBasePath)
      .set(CSRF_HEADERS)
      .send({ shortLinkId: link.body.id, styleKey: "carbon" })
      .expect(201);
    expect(qr.body.shortLinkId).toBe(link.body.id);

    await agent.delete(`${qrBasePath}/${qr.body.id}`).set(CSRF_HEADERS).expect(204);
    await agent.delete(`${linkBasePath}/${link.body.id}`).set(CSRF_HEADERS).expect(204);
  });
});
