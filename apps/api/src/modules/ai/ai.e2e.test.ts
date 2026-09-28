import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AiProviderError, FakeProvider, type AiConnectionConfig, type AiRequest, type FakeStep } from "@impulza/ai";
import { aiStatusResponse } from "@impulza/contracts";
import { encryptSecret, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { AI_PROVIDER_FACTORY, AI_USER_RATE_LIMIT, AiService } from "./ai.service.js";

// F6.2 — motor de IA: ruteo con respaldo desde la base, cuota por plan, límite por usuario y registro
// de uso sin contenido. Proveedores falsos: ninguna prueba sale a la red ni gasta dinero.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@ai-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const PREFIX = `e2e-ai-${Date.now().toString(36)}`;
const SECRET_PROMPT = "Texto de la página que nunca debe quedar guardado";

const schema = z.object({ headline: z.string().min(1).max(60) });
const aiRequest: AiRequest<{ headline: string }> = {
  system: "Eres redactor.",
  prompt: SECRET_PROMPT,
  schema,
  schemaName: "headline",
  maxOutputTokens: 200,
};

describe("Motor de IA (e2e) — F6.2", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let ai: AiService;
  let httpServer: Parameters<typeof request>[0];
  const emailAdapter = new FakeEmailAdapter();
  // Un proveedor falso por nombre de conexión; la fábrica registra la configuración que recibió.
  const providers = new Map<string, FakeProvider>();
  const seenConfigs: AiConnectionConfig[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(AI_PROVIDER_FACTORY)
      .useValue((config: AiConnectionConfig) => {
        seenConfigs.push(config);
        return providers.get(config.name) ?? new FakeProvider();
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    httpServer = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
    ai = app.get(AiService);
  });

  afterAll(async () => {
    await prisma.aiConnection.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await prisma.plan.deleteMany({ where: { code: { startsWith: PREFIX } } });
    await app.close();
  });

  beforeEach(async () => {
    providers.clear();
    seenConfigs.length = 0;
    await prisma.aiConnection.deleteMany({ where: { name: { startsWith: PREFIX } } });
    const keys = [...(await redis.keys("ratelimit:*")), ...(await redis.keys("ai:quota:*"))];
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
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org IA", slug: `${PREFIX}-${Math.random().toString(36).slice(2, 8)}` }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { agent, organizationId: org.body.id as string, userId: user.id };
  }

  /** Conexiones de prueba en orden de respaldo para `short_copy`. */
  async function route(...names: string[]) {
    for (const [position, name] of names.entries()) {
      await prisma.aiConnection.create({
        data: {
          name: `${PREFIX}-${name}`,
          kind: "OPENAI_COMPATIBLE",
          baseUrl: "http://ia.interna:11434/v1",
          apiKeyEncrypted: encryptSecret(`sk-${name}`, env.AUTH_ENCRYPTION_KEY),
          apiKeyHint: name.slice(-4),
          model: `modelo-${name}`,
          inputMicroUsdPerMTok: 1_000_000,
          outputMicroUsdPerMTok: 2_000_000,
          routes: { create: { task: "short_copy", position } },
        },
      });
    }
  }

  const provider = (name: string, ...steps: FakeStep[]) => {
    const fake = new FakeProvider(steps);
    providers.set(`${PREFIX}-${name}`, fake);
    return fake;
  };

  it("usa la ruta de la base con respaldo, descifra el token y registra cada intento sin el contenido", async () => {
    const { organizationId, userId } = await createOrg();
    await assignRoomyPlan(prisma, organizationId);
    await route("local", "nube");
    provider("local", new AiProviderError("timeout", true, "lento"), new AiProviderError("provider_error", true, "caído"));
    provider("nube", { output: { headline: "Fotos que venden" }, inputTokens: 1000, outputTokens: 500 });

    const data = await ai.run({ organizationId, userId, task: "short_copy", request: aiRequest });
    expect(data).toEqual({ headline: "Fotos que venden" });
    expect(seenConfigs.map((c) => c.apiKey)).toEqual(["sk-local", "sk-nube"]);

    const usage = await prisma.aiUsage.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
    expect(usage.map((row) => `${row.model}:${row.outcome}`)).toEqual(["modelo-local:timeout", "modelo-local:provider_error", "fake-model:ok"]);
    expect(new Set(usage.map((row) => row.requestId)).size).toBe(1);
    expect(usage.at(-1)).toMatchObject({ userId, task: "short_copy", inputTokens: 1000, outputTokens: 500, costMicroUsd: 2000 });
    expect(JSON.stringify(usage)).not.toContain(SECRET_PROMPT);
    expect(JSON.stringify(usage)).not.toContain("Fotos que venden");
  });

  it("sin conexiones para la tarea, o si todas fallan, responde 503 AI_UNAVAILABLE y no consume cuota", async () => {
    const { agent, organizationId, userId } = await createOrg();
    await expect(ai.run({ organizationId, userId, task: "insights", request: aiRequest })).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ code: "AI_UNAVAILABLE" }),
    });

    await route("rota");
    provider("rota", new AiProviderError("auth_error", false, "clave mala"));
    await expect(ai.run({ organizationId, userId, task: "short_copy", request: aiRequest })).rejects.toMatchObject({ status: 503 });

    const status = await agent.get(`/api/v1/organizations/${organizationId}/ai/status`).expect(200);
    expect(aiStatusResponse.parse(status.body).quota.used).toBe(0);
  });

  it("la cuota del plan se aplica antes de llamar al proveedor y responde 402 al agotarse", async () => {
    const { agent, organizationId, userId } = await createOrg();
    const base = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
    const tiny = await prisma.plan.create({
      data: { code: `${PREFIX}-mini`, name: "Mini", priceMonthly: 0, currency: "CLP", limits: { ...(base.limits as object), aiRequestsPerMonth: 2 } },
    });
    await prisma.organization.update({ where: { id: organizationId }, data: { planId: tiny.id } });
    await route("local");
    const fake = provider("local", { output: { headline: "Uno" } }, { output: { headline: "Dos" } }, { output: { headline: "Tres" } });

    await ai.run({ organizationId, userId, task: "short_copy", request: aiRequest });
    await ai.run({ organizationId, userId, task: "short_copy", request: aiRequest });
    await expect(ai.run({ organizationId, userId, task: "short_copy", request: aiRequest })).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({ code: "PLAN_LIMIT_REACHED", limit: { key: "aiRequestsPerMonth", max: 2, used: 2 } }),
    });
    expect(fake.requests).toHaveLength(2);

    const status = await agent.get(`/api/v1/organizations/${organizationId}/ai/status`).expect(200);
    expect(status.body).toMatchObject({ availableTasks: ["short_copy"], quota: { limit: 2, used: 2 } });
    expect(status.body.quota.period).toMatch(/^\d{4}-\d{2}$/);
  });

  it("dos solicitudes simultáneas no pasan las dos con el último cupo", async () => {
    const { organizationId, userId } = await createOrg();
    const base = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
    const one = await prisma.plan.create({
      data: { code: `${PREFIX}-uno`, name: "Uno", priceMonthly: 0, currency: "CLP", limits: { ...(base.limits as object), aiRequestsPerMonth: 1 } },
    });
    await prisma.organization.update({ where: { id: organizationId }, data: { planId: one.id } });
    await route("local");
    provider("local", { output: { headline: "A" } }, { output: { headline: "B" } });

    const results = await Promise.allSettled([
      ai.run({ organizationId, userId, task: "short_copy", request: aiRequest }),
      ai.run({ organizationId, userId, task: "short_copy", request: aiRequest }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("un usuario que supera su límite por minuto recibe 429", async () => {
    const { organizationId, userId } = await createOrg();
    await assignRoomyPlan(prisma, organizationId);
    await route("local");
    provider("local", ...Array.from({ length: AI_USER_RATE_LIMIT.limit }, () => ({ output: { headline: "Hola" } })));
    for (let i = 0; i < AI_USER_RATE_LIMIT.limit; i++) {
      await ai.run({ organizationId, userId, task: "short_copy", request: aiRequest });
    }
    await expect(ai.run({ organizationId, userId, task: "short_copy", request: aiRequest })).rejects.toMatchObject({ status: 429 });
  });

  it("el estado no expone proveedores ni modelos, y otra organización no lo lee", async () => {
    const owner = await createOrg();
    const stranger = await createOrg();
    await route("local");
    const status = await owner.agent.get(`/api/v1/organizations/${owner.organizationId}/ai/status`).expect(200);
    expect(JSON.stringify(status.body)).not.toMatch(/modelo-local|ia\.interna|sk-/);
    await stranger.agent.get(`/api/v1/organizations/${owner.organizationId}/ai/status`).expect(403);
  });
});
