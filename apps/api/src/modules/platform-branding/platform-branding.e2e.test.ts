import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import {
  publicPlatformBrandingResponse,
  platformBrandingResponse,
} from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import { generate } from "otplib";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { grantSuperAdmin } from "../admin/superadmin-grants.js";
import { listenForTests } from "../../test-support/http.js";

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@branding-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Marca de la plataforma (e2e) — F9.1 / ADR-028 §4", () => {
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
    const users = await prisma.user.findMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    const keys = [
      ...(await redis.keys("ratelimit:*")),
      ...(await redis.keys("admin-totp-used:*")),
      ...(await redis.keys("platform:branding:*")),
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

  async function loggedInUser() {
    const email = await createUser();
    const agent = request.agent(httpServer);
    await agent
      .post("/api/v1/auth/login")
      .set(CSRF_HEADERS)
      .send({ email, password: PASSWORD })
      .expect(201);
    return { email, agent };
  }

  async function loggedInAdmin() {
    const email = await createUser();
    const grant = await grantSuperAdmin(prisma, email, env.AUTH_ENCRYPTION_KEY);
    const secret = grant.twoFactorEnrollment!.secret;
    const agent = request.agent(httpServer);
    const code = await generate({ secret });
    const response = await agent
      .post("/api/v1/admin/auth/login")
      .set(CSRF_HEADERS)
      .send({ email, password: PASSWORD, code })
      .expect(201);

    return { email, agent, adminId: response.body.admin.id as string };
  }

  describe("GET /api/v1/platform/branding (Público)", () => {
    it("es accesible sin autenticación y devuelve solo campos públicos", async () => {
      const res = await request(httpServer)
        .get("/api/v1/platform/branding")
        .expect(200);

      const parsed = publicPlatformBrandingResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);

      // No expone datos de administración ni correos internos
      expect(res.body).not.toHaveProperty("senderEmail");
      expect(res.body).not.toHaveProperty("updatedByAdminId");
      expect(res.body).not.toHaveProperty("id");

      // Por defecto reproduce la marca Impulza One
      expect(res.body.name).toBe("Impulza One");
      expect(res.body.primaryColor).toBe("#0f6f6b");
    });
  });

  describe("GET /api/v1/admin/platform/branding (Superadministración)", () => {
    it("responde 401 si no hay sesión de administración", async () => {
      await request(httpServer)
        .get("/api/v1/admin/platform/branding")
        .expect(401);
    });

    it("responde 401 si el usuario tiene sesión normal pero no de superadmin (separación de puertas ADR-005)", async () => {
      const user = await loggedInUser();
      await user.agent
        .get("/api/v1/admin/platform/branding")
        .expect(401);
    });

    it("responde 200 con todos los campos para el superadministrador", async () => {
      const admin = await loggedInAdmin();
      const res = await admin.agent
        .get("/api/v1/admin/platform/branding")
        .expect(200);

      const parsed = platformBrandingResponse.safeParse(res.body);
      expect(parsed.success).toBe(true);
      expect(res.body).toHaveProperty("senderEmail");
      expect(res.body).toHaveProperty("senderName");
    });
  });

  describe("PUT /api/v1/admin/platform/branding (Edición)", () => {
    const validUpdate = {
      name: "Impulza Pro",
      logoLightUrl: "https://cdn.impulza.app/logo-l.png",
      logoDarkUrl: "https://cdn.impulza.app/logo-d.png",
      faviconUrl: "https://cdn.impulza.app/fav.ico",
      primaryColor: "#0f6f6b", // Contraste 5.99:1
      secondaryColor: "#0b5450", // Contraste 8.52:1
      senderName: "Notificaciones Impulza",
      senderEmail: "soporte@impulza.app",
      supportUrl: "https://impulza.app/ayuda",
      privacyUrl: "https://impulza.app/legal/privacidad",
      termsUrl: "https://impulza.app/legal/terminos",
      footerText: "Plataforma de identidad y CRM.",
    };

    it("rechaza si no es superadministrador", async () => {
      const user = await loggedInUser();
      await user.agent
        .put("/api/v1/admin/platform/branding")
        .set(CSRF_HEADERS)
        .send(validUpdate)
        .expect(401);
    });

    it("rechaza colores con contraste menor a 4.5:1 sobre fondo claro (#ffffff)", async () => {
      const admin = await loggedInAdmin();
      const res = await admin.agent
        .put("/api/v1/admin/platform/branding")
        .set(CSRF_HEADERS)
        .send({
          ...validUpdate,
          primaryColor: "#e2e8f0", // Contraste insuficiente (~1.25:1)
        })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain("Contraste insuficiente");
    });

    it("rechaza enlaces legales que no usen https://", async () => {
      const admin = await loggedInAdmin();
      const res = await admin.agent
        .put("/api/v1/admin/platform/branding")
        .set(CSRF_HEADERS)
        .send({
          ...validUpdate,
          termsUrl: "http://inseguro.com/terminos",
        })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain("https://");
    });

    it("actualiza la marca, genera auditoría e invalida la caché pública", async () => {
      const admin = await loggedInAdmin();

      // 1. Guardar actualización
      const updateRes = await admin.agent
        .put("/api/v1/admin/platform/branding")
        .set(CSRF_HEADERS)
        .send(validUpdate)
        .expect(200);

      expect(updateRes.body.name).toBe("Impulza Pro");

      // 2. Verificar que el endpoint público ahora devuelve los nuevos datos
      const publicRes = await request(httpServer)
        .get("/api/v1/platform/branding")
        .expect(200);

      expect(publicRes.body.name).toBe("Impulza Pro");
      expect(publicRes.body.supportUrl).toBe("https://impulza.app/ayuda");

      // 3. Verificar auditoría registrada
      const auditLog = await prisma.auditLog.findFirst({
        where: { action: "admin.platform_branding_updated", actorId: admin.adminId },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog?.targetType).toBe("PlatformBranding");
    });
  });

  describe("POST /api/v1/admin/platform/branding/reset (Restablecer)", () => {
    it("restablece a la marca por defecto y queda auditado", async () => {
      const admin = await loggedInAdmin();

      // Cambiar primero a otro nombre
      await admin.agent
        .put("/api/v1/admin/platform/branding")
        .set(CSRF_HEADERS)
        .send({
          name: "Nombre Temporal",
          primaryColor: "#0f6f6b",
          secondaryColor: "#0b5450",
          senderName: "Temporal",
          senderEmail: "temp@example.com",
        })
        .expect(200);

      // Restablecer
      const resetRes = await admin.agent
        .post("/api/v1/admin/platform/branding/reset")
        .set(CSRF_HEADERS)
        .expect(200);

      expect(resetRes.body.name).toBe("Impulza One");
      expect(resetRes.body.primaryColor).toBe("#0f6f6b");

      // El público también vuelve a los valores por defecto
      const publicRes = await request(httpServer)
        .get("/api/v1/platform/branding")
        .expect(200);
      expect(publicRes.body.name).toBe("Impulza One");

      // Auditoría registrada
      const auditLog = await prisma.auditLog.findFirst({
        where: { action: "admin.platform_branding_reset", actorId: admin.adminId },
      });
      expect(auditLog).not.toBeNull();
    });
  });

  describe("POST /api/v1/admin/platform/branding/upload (Subida de logotipos/favicon)", () => {
    it("rechaza SVG malicioso con scripts o eventos inline", async () => {
      const admin = await loggedInAdmin();
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert('xss')</script></svg>`;
      const base64Data = Buffer.from(maliciousSvg, "utf8").toString("base64");

      const res = await admin.agent
        .post("/api/v1/admin/platform/branding/upload")
        .set(CSRF_HEADERS)
        .send({
          target: "logo_light",
          fileName: "malicious.svg",
          contentType: "image/svg+xml",
          sizeBytes: base64Data.length,
          base64Data,
        })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain("<script>");
    });

    it("acepta SVG limpio y devuelve la URL", async () => {
      const admin = await loggedInAdmin();
      const cleanSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#0f6f6b"/></svg>`;
      const base64Data = Buffer.from(cleanSvg, "utf8").toString("base64");

      const res = await admin.agent
        .post("/api/v1/admin/platform/branding/upload")
        .set(CSRF_HEADERS)
        .send({
          target: "logo_light",
          fileName: "clean.svg",
          contentType: "image/svg+xml",
          sizeBytes: base64Data.length,
          base64Data,
        })
        .expect(200);

      expect(res.body).toHaveProperty("url");
      expect(typeof res.body.url).toBe("string");
    });
  });
});
