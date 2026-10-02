import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import {
  adminFeatureFlagListResponse,
  adminFeatureFlagResponse,
  adminQueueActionResultResponse,
  adminQueueMetricsResponse,
  adminSystemHealthResponse,
  adminTemplateListResponse,
  adminTemplateSummaryResponse,
} from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { BULLMQ_QUEUES } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import { generate } from "otplib";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service.js";
import { grantSuperAdmin } from "./superadmin-grants.js";

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@admin-ops-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Operaciones de Superadministración (e2e) — F7.11 / ADR-026", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let httpServer: Parameters<typeof request>[0];
  let flags: FeatureFlagsService;

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
    flags = app.get(FeatureFlagsService);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    const keys = [
      ...(await redis.keys("ratelimit:*")),
      ...(await redis.keys("admin-totp-used:*")),
      ...(await redis.keys("feature_flag:*")),
    ];
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function createUser() {
    const email = `${unique("user")}${TEST_EMAIL_DOMAIN}`;
    await request(httpServer)
      .post("/api/v1/auth/register")
      .set(CSRF_HEADERS)
      .send({ email, password: PASSWORD })
      .expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer)
      .post("/api/v1/auth/verify-email")
      .set(CSRF_HEADERS)
      .send({ token })
      .expect(204);
    return email;
  }

  async function createSuperAdmin() {
    const email = await createUser();
    const grant = await grantSuperAdmin(prisma, email, env.AUTH_ENCRYPTION_KEY);
    return { email, secret: grant.twoFactorEnrollment!.secret };
  }

  async function loggedInAdmin() {
    const admin = await createSuperAdmin();
    const agent = request.agent(httpServer);
    const code = await generate({ secret: admin.secret });
    const response = await agent
      .post("/api/v1/admin/auth/login")
      .set(CSRF_HEADERS)
      .send({ email: admin.email, password: PASSWORD, code });
    expect(response.status).toBe(201);
    return { ...admin, agent, adminId: response.body.admin.id as string };
  }

  describe("Seguridad y Control de Acceso", () => {
    it("rechaza peticiones sin sesión de superadministración (401)", async () => {
      await request(httpServer).get("/api/v1/admin/operations/health").expect(401);
      await request(httpServer).get("/api/v1/admin/operations/queues").expect(401);
      await request(httpServer).get("/api/v1/admin/feature-flags").expect(401);
      await request(httpServer).get("/api/v1/admin/templates").expect(401);
    });

    it("rechaza peticiones mutantes sin cabecera CSRF (403)", async () => {
      const { agent } = await loggedInAdmin();
      await agent
        .post("/api/v1/admin/operations/queues/analytics-events/pause")
        .expect(403);
    });
  });

  describe("Estado técnico de la plataforma (/admin/operations/health)", () => {
    it("devuelve el estado de postgres, redis, worker, pasarelas y proceso, sin llenar la bitácora de auditoría", async () => {
      const { agent, adminId } = await loggedInAdmin();
      const res = await agent.get("/api/v1/admin/operations/health").expect(200);

      const parsed = adminSystemHealthResponse.parse(res.body);
      expect(["ok", "degraded", "error"]).toContain(parsed.status);
      expect(parsed.database.status).toBe("ok");
      expect(parsed.database.counts.users).toBeGreaterThan(0);
      expect(parsed.redis.status).toBe("ok");
      expect(parsed.process.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(parsed.process.memory.heapUsedBytes).toBeGreaterThan(0);

      // Es una lectura que el panel repite cada 10 s: no se audita (llenaría la bitácora de ruido).
      expect(parsed.worker.status).toMatch(/ok|down/);
      expect(await prisma.auditLog.count({ where: { action: "admin.system_health_inspected", actorId: adminId } })).toBe(0);
    });
  });

  describe("Monitoreo y control de colas BullMQ (/admin/operations/queues)", () => {
    it("lista todas las colas del sistema con sus contadores", async () => {
      const { agent } = await loggedInAdmin();
      const res = await agent.get("/api/v1/admin/operations/queues").expect(200);

      const parsed = adminQueueMetricsResponse.parse(res.body);
      expect(parsed.queues).toHaveLength(BULLMQ_QUEUES.length);
      const names = parsed.queues.map((q) => q.name);
      expect(names).toContain("analytics-events");
      expect(names).toContain("campaign-dispatch");
      expect(names).toContain("webhook-deliveries");
      expect(names).toContain("sequence-dispatch");
      expect(names).toContain("media-video");
      expect(names).toContain("page-campaign-boundaries");
    });

    it("permite pausar y reanudar una cola dejando registro de auditoría", async () => {
      const { agent, adminId } = await loggedInAdmin();

      const pauseRes = await agent
        .post("/api/v1/admin/operations/queues/analytics-events/pause")
        .set(CSRF_HEADERS)
        .expect(200);

      const pauseParsed = adminQueueActionResultResponse.parse(pauseRes.body);
      expect(pauseParsed.success).toBe(true);
      expect(pauseParsed.action).toBe("pause");

      const resumeRes = await agent
        .post("/api/v1/admin/operations/queues/analytics-events/resume")
        .set(CSRF_HEADERS)
        .expect(200);

      const resumeParsed = adminQueueActionResultResponse.parse(resumeRes.body);
      expect(resumeParsed.success).toBe(true);
      expect(resumeParsed.action).toBe("resume");

      const auditPause = await prisma.auditLog.findFirst({
        where: {
          action: "admin.queue_pause",
          actorId: adminId,
          targetId: "analytics-events",
        },
      });
      expect(auditPause).not.toBeNull();
    });

    it("rechaza acciones sobre colas desconocidas", async () => {
      const { agent } = await loggedInAdmin();
      await agent
        .post("/api/v1/admin/operations/queues/cola-inexistente/pause")
        .set(CSRF_HEADERS)
        .expect(400);
    });
  });

  describe("Feature Flags (/admin/feature-flags)", () => {
    it("lista todas las banderas iniciales y permite modificarlas con invalidación en Redis", async () => {
      const { agent, adminId } = await loggedInAdmin();

      const listRes = await agent.get("/api/v1/admin/feature-flags").expect(200);
      const listParsed = adminFeatureFlagListResponse.parse(listRes.body);
      expect(listParsed.total).toBeGreaterThanOrEqual(6);
      expect(listParsed.items.some((f) => f.key === "registros_abiertos")).toBe(true);

      const updateRes = await agent
        .put("/api/v1/admin/feature-flags/registros_abiertos")
        .set(CSRF_HEADERS)
        .send({ enabled: false })
        .expect(200);

      const updated = adminFeatureFlagResponse.parse(updateRes.body);
      expect(updated.key).toBe("registros_abiertos");
      expect(updated.enabled).toBe(false);

      // Rige de inmediato (la caché se invalida al guardar)
      expect(await flags.isEnabled("registros_abiertos")).toBe(false);

      // Auditoría
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: "admin.feature_flag_updated",
          actorId: adminId,
          targetType: "FeatureFlag",
        },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.metadata).toMatchObject({ key: "registros_abiertos", enabled: false });

      // Restaurar flag
      await agent
        .put("/api/v1/admin/feature-flags/registros_abiertos")
        .set(CSRF_HEADERS)
        .send({ enabled: true })
        .expect(200);
    });
  });

  describe("Las banderas gobiernan de verdad la plataforma", () => {
    async function setFlag(agent: ReturnType<typeof request.agent>, key: string, enabled: boolean) {
      await agent.put(`/api/v1/admin/feature-flags/${key}`).set(CSRF_HEADERS).send({ enabled }).expect(200);
    }

    it("con `registros_abiertos` apagada nadie puede crear una cuenta (503) y al encenderla vuelve a poder", async () => {
      const { agent } = await loggedInAdmin();
      await agent.get("/api/v1/admin/feature-flags").expect(200); // crea las filas por defecto
      await setFlag(agent, "registros_abiertos", false);
      try {
        const email = `${unique("cerrado")}${TEST_EMAIL_DOMAIN}`;
        const blocked = await request(httpServer)
          .post("/api/v1/auth/register")
          .set(CSRF_HEADERS)
          .send({ email, password: PASSWORD })
          .expect(503);
        expect(blocked.body.message).toMatch(/cerrado/);
        expect(await prisma.user.count({ where: { email } })).toBe(0);
      } finally {
        await setFlag(agent, "registros_abiertos", true);
      }
      await request(httpServer)
        .post("/api/v1/auth/register")
        .set(CSRF_HEADERS)
        .send({ email: `${unique("abierto")}${TEST_EMAIL_DOMAIN}`, password: PASSWORD })
        .expect(201);
    });

    it("sin ninguna fila en la base, una instalación nueva deja registrarse (valor por defecto, no 'apagado')", async () => {
      await prisma.featureFlag.deleteMany({ where: { key: "registros_abiertos" } });
      await redis.del("feature_flag:registros_abiertos");
      await request(httpServer)
        .post("/api/v1/auth/register")
        .set(CSRF_HEADERS)
        .send({ email: `${unique("nuevo")}${TEST_EMAIL_DOMAIN}`, password: PASSWORD })
        .expect(201);
    });

    it("con `pagos_en_linea` apagada no se puede pedir ni iniciar un cobro (503)", async () => {
      const { agent } = await loggedInAdmin();
      await agent.get("/api/v1/admin/feature-flags").expect(200);
      await setFlag(agent, "pagos_en_linea", false);
      try {
        const res = await request(httpServer)
          .post("/api/v1/public/sites/no-importa/catalog/orders")
          .set(CSRF_HEADERS)
          .send({})
          .expect(503);
        expect(res.body.message).toMatch(/pagos en línea/i);
      } finally {
        await setFlag(agent, "pagos_en_linea", true);
      }
    });
  });

  describe("CMS de Plantillas (/admin/templates)", () => {
    it("ocultar una plantilla la saca de la galería pública y no deja aplicarla; destacar la sube al principio", async () => {
      const { agent } = await loggedInAdmin();
      const list = adminTemplateListResponse.parse((await agent.get("/api/v1/admin/templates").expect(200)).body);
      const hidden = list.items.find((t) => t.isActive)!;
      const featured = list.items.filter((t) => t.isActive && t.id !== hidden.id).at(-1)!;
      const patch = (id: string, body: object) => agent.patch(`/api/v1/admin/templates/${id}`).set(CSRF_HEADERS).send(body).expect(200);
      const publicCodes = async () => ((await request(httpServer).get("/api/v1/templates").expect(200)).body as Array<{ code: string }>).map((t) => t.code);

      expect(await publicCodes()).toContain(hidden.code);
      await patch(hidden.id, { isActive: false });
      await patch(featured.id, { isFeatured: true, sortOrder: 999 });
      try {
        const codes = await publicCodes();
        expect(codes).not.toContain(hidden.code);
        await request(httpServer).get(`/api/v1/templates/${hidden.code}`).expect(404);
        // Destacada: aparece antes que las demás aunque su orden sea el más alto.
        expect(codes[0]).toBe(featured.code);
      } finally {
        await patch(hidden.id, { isActive: hidden.isActive });
        await patch(featured.id, { isFeatured: featured.isFeatured, sortOrder: featured.sortOrder });
      }
      expect(await publicCodes()).toContain(hidden.code);
    });

    it("lista las plantillas públicas y permite modificar isActive, isFeatured y sortOrder", async () => {
      const { agent, adminId } = await loggedInAdmin();

      const listRes = await agent.get("/api/v1/admin/templates").expect(200);
      const listParsed = adminTemplateListResponse.parse(listRes.body);
      expect(listParsed.total).toBeGreaterThanOrEqual(1);

      const target = listParsed.items[0]!;
      const patchRes = await agent
        .patch(`/api/v1/admin/templates/${target.id}`)
        .set(CSRF_HEADERS)
        .send({ isActive: !target.isActive, isFeatured: true, sortOrder: 99 })
        .expect(200);

      const patched = adminTemplateSummaryResponse.parse(patchRes.body);
      expect(patched.isActive).toBe(!target.isActive);
      expect(patched.isFeatured).toBe(true);
      expect(patched.sortOrder).toBe(99);

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: "admin.template_updated",
          actorId: adminId,
          targetId: target.id,
        },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.metadata).toMatchObject({
        code: target.code,
        isActive: !target.isActive,
        isFeatured: true,
        sortOrder: 99,
      });

      // Restaurar valores originales
      await agent
        .patch(`/api/v1/admin/templates/${target.id}`)
        .set(CSRF_HEADERS)
        .send({
          isActive: target.isActive,
          isFeatured: target.isFeatured,
          sortOrder: target.sortOrder,
        })
        .expect(200);
    });
  });
});
