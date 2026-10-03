import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { brandProfileResponse, uploadBrandProfileAssetResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { MemoryStorageAdapter } from "@impulza/storage";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { STORAGE } from "../../storage/storage.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { listenForTests } from "../../test-support/http.js";

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@brand-profile-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(prefix = "bp"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// 1x1 PNG transparente válido en base64
const VALID_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("BrandProfile API (e2e) — F9.2 / ADR-028 §4 nivel 2", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  const storage = new MemoryStorageAdapter("https://media.test");
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(STORAGE)
      .useValue(storage)
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

  async function registerLoggedInUser(): Promise<{ email: string; agent: ReturnType<typeof request.agent>; userId: string }> {
    const email = uniqueEmail();
    const password = "password1234";
    const agent = request.agent(httpServer);

    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    const loginRes = await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);

    return { email, agent, userId: loginRes.body.user.id };
  }

  async function createOrgWithOwner(): Promise<{
    agent: ReturnType<typeof request.agent>;
    organizationId: string;
    userId: string;
  }> {
    const { agent, userId } = await registerLoggedInUser();
    const org = await agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org Prueba", slug: uniqueSlug("org") })
      .expect(201);

    return { agent, organizationId: org.body.id, userId };
  }

  // ─── GET /api/v1/organizations/:organizationId/brand-profile ─────────────

  describe("GET /api/v1/organizations/:organizationId/brand-profile", () => {
    it("responde 401 si no hay sesión autenticada", async () => {
      await request(httpServer)
        .get(`/api/v1/organizations/00000000-0000-4000-a000-000000000001/brand-profile`)
        .expect(401);
    });

    it("devuelve el perfil de marca de la organización para un miembro activo", async () => {
      const org = await createOrgWithOwner();
      const res = await org.agent
        .get(`/api/v1/organizations/${org.organizationId}/brand-profile`)
        .expect(200);

      const parsed = brandProfileResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body.organizationId).toBe(org.organizationId);
    });

    it("responde 404 (ADR-002) si el usuario intenta leer la marca de otra organización", async () => {
      const orgA = await createOrgWithOwner();
      const orgB = await createOrgWithOwner();

      // Org B intenta leer el brand-profile de Org A
      await orgB.agent
        .get(`/api/v1/organizations/${orgA.organizationId}/brand-profile`)
        .expect(403);
    });
  });

  // ─── PUT /api/v1/organizations/:organizationId/brand-profile ─────────────

  describe("PUT /api/v1/organizations/:organizationId/brand-profile", () => {
    it("actualiza la marca correctamente y genera registro de auditoría", async () => {
      const org = await createOrgWithOwner();

      const res = await org.agent
        .put(`/api/v1/organizations/${org.organizationId}/brand-profile`)
        .set(CSRF_HEADERS)
        .send({
          displayName: "Café de Especialidad",
          primaryColor: "#0f6f6b",   // Contraste 5.99:1 sobre blanco
          secondaryColor: "#0b5450", // Contraste 8.52:1 sobre blanco
          contactEmail: "contacto@cafedeespecialidad.cl",
          contactPhone: "+56912345678",
          legalName: "Café Especialidad SpA",
          taxId: "76.123.456-7",
        })
        .expect(200);

      const parsed = brandProfileResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body.displayName).toBe("Café de Especialidad");
      expect(res.body.primaryColor).toBe("#0f6f6b");
      expect(res.body.organizationId).toBe(org.organizationId);

      // Verificar que se guardó en BD
      const row = await prisma.brandProfile.findUnique({
        where: { organizationId: org.organizationId },
      });
      expect(row?.displayName).toBe("Café de Especialidad");
      expect(row?.primaryColor).toBe("#0f6f6b");

      // Verificar registro de auditoría
      const audit = await prisma.auditLog.findFirst({
        where: { action: "org.brand_profile_updated", organizationId: org.organizationId },
      });
      expect(audit).not.toBeNull();
      expect(audit?.targetType).toBe("BrandProfile");
    });

    it("rechaza color con contraste inferior a 4.5:1 sobre fondo claro (#ffffff)", async () => {
      const org = await createOrgWithOwner();

      const res = await org.agent
        .put(`/api/v1/organizations/${org.organizationId}/brand-profile`)
        .set(CSRF_HEADERS)
        .send({
          primaryColor: "#ffff00", // Amarillo brillante sobre blanco: contraste pésimo (~1.07:1)
        })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain("Contraste insuficiente");
    });

    it("rechaza logoLightUrl con protocolo http:// no localhost", async () => {
      const org = await createOrgWithOwner();

      await org.agent
        .put(`/api/v1/organizations/${org.organizationId}/brand-profile`)
        .set(CSRF_HEADERS)
        .send({
          logoLightUrl: "http://servidor-inseguro.com/logo.png",
        })
        .expect(400);
    });

    it("permite limpiar campos enviando null", async () => {
      const org = await createOrgWithOwner();

      // Primero establecer
      await org.agent
        .put(`/api/v1/organizations/${org.organizationId}/brand-profile`)
        .set(CSRF_HEADERS)
        .send({ displayName: "Nombre Temporal" })
        .expect(200);

      // Luego limpiar con null
      const res = await org.agent
        .put(`/api/v1/organizations/${org.organizationId}/brand-profile`)
        .set(CSRF_HEADERS)
        .send({ displayName: null })
        .expect(200);

      expect(res.body.displayName).toBeNull();
    });

    it("responde 404 (ADR-002) si el usuario intenta modificar la marca de otra organización", async () => {
      const orgA = await createOrgWithOwner();
      const orgB = await createOrgWithOwner();

      // Org B intenta modificar la marca de Org A
      await orgB.agent
        .put(`/api/v1/organizations/${orgA.organizationId}/brand-profile`)
        .set(CSRF_HEADERS)
        .send({ displayName: "Ataque cruzado" })
        .expect(403);

      // Verificar que Org A no fue alterada
      const rowA = await prisma.brandProfile.findUnique({
        where: { organizationId: orgA.organizationId },
      });
      expect(rowA?.displayName).not.toBe("Ataque cruzado");
    });
  });

  // ─── POST /api/v1/organizations/:organizationId/brand-profile/upload ─────

  describe("POST /api/v1/organizations/:organizationId/brand-profile/upload", () => {
    it("rechaza SVG malicioso con scripts o tags peligrosos", async () => {
      const org = await createOrgWithOwner();
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert('xss')</script><circle cx="5" cy="5" r="5"/></svg>`;
      const base64Data = Buffer.from(maliciousSvg, "utf8").toString("base64");

      await org.agent
        .post(`/api/v1/organizations/${org.organizationId}/brand-profile/upload`)
        .set(CSRF_HEADERS)
        .send({
          target: "logo_light",
          fileName: "malicious.svg",
          contentType: "image/svg+xml",
          sizeBytes: maliciousSvg.length,
          base64Data,
        })
        .expect(400);
    });

    it("sube un activo válido y devuelve la URL según el contrato", async () => {
      const org = await createOrgWithOwner();
      const validSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#0f6f6b"/></svg>`;
      const base64Data = Buffer.from(validSvg, "utf8").toString("base64");

      const res = await org.agent
        .post(`/api/v1/organizations/${org.organizationId}/brand-profile/upload`)
        .set(CSRF_HEADERS)
        .send({
          target: "logo_light",
          fileName: "logo.svg",
          contentType: "image/svg+xml",
          sizeBytes: validSvg.length,
          base64Data,
        })
        .expect(200);

      const parsed = uploadBrandProfileAssetResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body.url).toContain("https://media.test");
    });

    it("responde 403 (ADR-002) si Org B intenta subir un asset al espacio de Org A", async () => {
      const orgA = await createOrgWithOwner();
      const orgB = await createOrgWithOwner();

      await orgB.agent
        .post(`/api/v1/organizations/${orgA.organizationId}/brand-profile/upload`)
        .set(CSRF_HEADERS)
        .send({
          target: "favicon",
          fileName: "fav.png",
          contentType: "image/png",
          sizeBytes: 100,
          base64Data: VALID_PNG_BASE64,
        })
        .expect(403);
    });
  });

  // ─── Aislamiento completo entre organizaciones (ADR-002) ──────────────────

  describe("Aislamiento estricto (ADR-002)", () => {
    it("dos organizaciones tienen perfiles de marca independientes que no interfieren entre sí", async () => {
      const orgA = await createOrgWithOwner();
      const orgB = await createOrgWithOwner();

      // Configurar marca A
      await orgA.agent
        .put(`/api/v1/organizations/${orgA.organizationId}/brand-profile`)
        .set(CSRF_HEADERS)
        .send({ displayName: "Marca Negocio A", primaryColor: "#0f6f6b" })
        .expect(200);

      // Configurar marca B
      await orgB.agent
        .put(`/api/v1/organizations/${orgB.organizationId}/brand-profile`)
        .set(CSRF_HEADERS)
        .send({ displayName: "Marca Negocio B", primaryColor: "#1e3a8a" })
        .expect(200);

      // Leer A
      const resA = await orgA.agent
        .get(`/api/v1/organizations/${orgA.organizationId}/brand-profile`)
        .expect(200);
      expect(resA.body.displayName).toBe("Marca Negocio A");
      expect(resA.body.primaryColor).toBe("#0f6f6b");

      // Leer B
      const resB = await orgB.agent
        .get(`/api/v1/organizations/${orgB.organizationId}/brand-profile`)
        .expect(200);
      expect(resB.body.displayName).toBe("Marca Negocio B");
      expect(resB.body.primaryColor).toBe("#1e3a8a");
    });
  });
});
