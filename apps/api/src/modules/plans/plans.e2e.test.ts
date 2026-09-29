import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { organizationPlanResponse, planResponse } from "@impulza/contracts";
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

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@plans-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const DAY_MS = 24 * 60 * 60 * 1000;

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Planes y plan efectivo (e2e) — F4.1", () => {
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

  async function createOrg() {
    const email = `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
    const password = "password1234";
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org", slug: uniqueSlug("org") }).expect(201);
    return { agent, organizationId: org.body.id as string };
  }

  it("el catálogo es público, ordenado, y cumple el contrato", async () => {
    const response = await request(httpServer).get("/api/v1/plans").expect(200);
    const plans = response.body.map((plan: unknown) => planResponse.parse(plan));
    expect(plans.map((plan: { code: string }) => plan.code)).toEqual(["free", "profesional", "negocio", "agencia"]);
    expect(plans[0].priceMonthly).toBe(0);
  });

  it("una organización nueva tiene Gratis por defecto y su uso real", async () => {
    const { agent, organizationId } = await createOrg();
    await agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF_HEADERS).send({ name: "Sitio", slug: uniqueSlug("s") }).expect(201);

    const body = organizationPlanResponse.parse((await agent.get(`/api/v1/organizations/${organizationId}/plan`).expect(200)).body);
    expect(body.plan.code).toBe("free");
    expect(body.source).toBe("default");
    expect(body.usage).toEqual({ sites: 1, forms: 0, contacts: 0, shortLinks: 0, qrCodes: 0, members: 1, storageMb: 0 });
  });

  it("un plan asignado por superadministración reemplaza al por defecto", async () => {
    const { agent, organizationId } = await createOrg();
    const negocio = await prisma.plan.findUniqueOrThrow({ where: { code: "negocio" } });
    await prisma.organization.update({ where: { id: organizationId }, data: { planId: negocio.id } });

    const body = organizationPlanResponse.parse((await agent.get(`/api/v1/organizations/${organizationId}/plan`).expect(200)).body);
    expect(body.plan.code).toBe("negocio");
    expect(body.source).toBe("assigned");
  });

  it("una suscripción vigente manda; una vencida no cuenta", async () => {
    const { agent, organizationId } = await createOrg();
    const profesional = await prisma.plan.findUniqueOrThrow({ where: { code: "profesional" } });
    const agencia = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
    await prisma.subscription.create({
      data: {
        organizationId,
        planId: agencia.id,
        status: "ACTIVE",
        currentPeriodStart: new Date(Date.now() - 60 * DAY_MS),
        currentPeriodEnd: new Date(Date.now() - 30 * DAY_MS),
      },
    });

    let body = organizationPlanResponse.parse((await agent.get(`/api/v1/organizations/${organizationId}/plan`).expect(200)).body);
    expect(body.plan.code).toBe("free");

    // Desde F4.6a hay a lo más una suscripción viva por organización (`subscriptions_one_live_per_org`):
    // la vencida la cierra el worker antes de que exista otra, igual que acá.
    await prisma.subscription.updateMany({ where: { organizationId }, data: { status: "CANCELED" } });
    await prisma.subscription.create({
      data: {
        organizationId,
        planId: profesional.id,
        status: "ACTIVE",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
      },
    });
    body = organizationPlanResponse.parse((await agent.get(`/api/v1/organizations/${organizationId}/plan`).expect(200)).body);
    expect(body.plan.code).toBe("profesional");
    expect(body.source).toBe("subscription");
  });

  it("el plan de otra organización no es legible; sin sesión, 401", async () => {
    const a = await createOrg();
    const b = await createOrg();
    await a.agent.get(`/api/v1/organizations/${b.organizationId}/plan`).expect(403);
    await request(httpServer).get(`/api/v1/organizations/${a.organizationId}/plan`).expect(401);
  });
});
