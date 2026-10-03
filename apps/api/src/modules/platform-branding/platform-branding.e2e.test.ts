import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import {
  publicPlatformBrandingResponse,
  platformBrandingResponse,
} from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { MemoryStorageAdapter } from "@impulza/storage";
import { DEFAULT_PLATFORM_BRANDING } from "@impulza/validation";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import { generate } from "otplib";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { brandingUploadBody } from "../../common/branding-upload-body.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { STORAGE } from "../../storage/storage.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { grantSuperAdmin } from "../admin/superadmin-grants.js";
import { listenForTests } from "../../test-support/http.js";
import { PLATFORM_BRANDING_CACHE_KEY, PLATFORM_BRANDING_SINGLETON_ID } from "./platform-branding.tokens.js";

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
    app.use(brandingUploadBody(moduleRef.get(PRISMA)));
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
    // La marca es global: se devuelve a los valores por defecto para no dejar «Impulza Pro» en desarrollo.
    const defaults = { ...DEFAULT_PLATFORM_BRANDING, updatedByAdminId: null };
    await prisma.platformBranding.upsert({
      where: { id: PLATFORM_BRANDING_SINGLETON_ID },
      update: defaults,
      create: { id: PLATFORM_BRANDING_SINGLETON_ID, ...defaults },
    });
    await redis.del(PLATFORM_BRANDING_CACHE_KEY);
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
    it.each([
      ["etiqueta <script>", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert('xss')</script></svg>`, "<script>"],
      ["manejador de eventos inline", `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>`, "manejadores de eventos"],
    ])("rechaza SVG malicioso con %s", async (_label, maliciousSvg, expectedMessage) => {
      const admin = await loggedInAdmin();
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

      expect(JSON.stringify(res.body)).toContain(expectedMessage);
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

    // ---- F9.1 (revisión de Claude): defectos comprobados contra la API real ----------------------

    function uploadBody(buffer: Buffer, contentType: string, target = "logo_light") {
      const base64Data = buffer.toString("base64");
      return { target, fileName: "archivo", contentType, sizeBytes: buffer.length, base64Data };
    }

    async function noisePng(side: number): Promise<Buffer> {
      // Ruido: incompresible, así el archivo pesa lo que pesaría un logo real de alta resolución.
      return sharp(randomBytes(side * side * 3), { raw: { width: side, height: side, channels: 3 } })
        .png({ compressionLevel: 0 })
        .toBuffer();
    }

    it("acepta un logo realista de ~1 MB (antes respondía 413 con cualquier archivo mayor a ~75 KB)", async () => {
      const admin = await loggedInAdmin();
      const png = await noisePng(600);
      expect(png.length).toBeGreaterThan(900_000);
      expect(png.length).toBeLessThan(2 * 1024 * 1024);

      const res = await admin.agent
        .post("/api/v1/admin/platform/branding/upload")
        .set(CSRF_HEADERS)
        .send(uploadBody(png, "image/png"))
        .expect(200);

      expect(res.body.url).toMatch(/^https:\/\/media\.test\/branding\/platform\/logo_light-\d+\.png$/);
      expect(storage.objects.size).toBeGreaterThan(0);
    });

    it("rechaza un cuerpo mayor al límite aun con sesión de administración", async () => {
      const admin = await loggedInAdmin();
      await admin.agent
        .post("/api/v1/admin/platform/branding/upload")
        .set(CSRF_HEADERS)
        .send(uploadBody(Buffer.alloc(4 * 1024 * 1024, 1), "image/png"))
        .expect(413);
    });

    it("sin sesión de administración el límite sigue siendo el normal (100 KB): nadie sin sesión lee megabytes", async () => {
      await request(httpServer)
        .post("/api/v1/admin/platform/branding/upload")
        .set(CSRF_HEADERS)
        .send({ base64Data: "A".repeat(300_000) })
        .expect(413);
    });

    it("rechaza una imagen más pequeña que el mínimo", async () => {
      const admin = await loggedInAdmin();
      const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#0f6f6b" } }).png().toBuffer();
      const res = await admin.agent
        .post("/api/v1/admin/platform/branding/upload")
        .set(CSRF_HEADERS)
        .send(uploadBody(tiny, "image/png"))
        .expect(400);
      expect(JSON.stringify(res.body)).toContain("demasiado pequeña");
    });

    it("rechaza un archivo con encabezado PNG pero contenido dañado", async () => {
      const admin = await loggedInAdmin();
      const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(2000)]);
      const res = await admin.agent
        .post("/api/v1/admin/platform/branding/upload")
        .set(CSRF_HEADERS)
        .send(uploadBody(fake, "image/png"))
        .expect(400);
      expect(JSON.stringify(res.body)).toContain("dañado");
    });

    it.each([
      ["entidad numérica que forma javascript:", `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="&#106;avascript:alert(1)"/></svg>`],
      ["<animate> que cambia el href", `<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" values="javascript:alert(1)" begin="0s"/><rect width="10" height="10"/></a></svg>`],
      ["<set> que cambia el href", `<svg xmlns="http://www.w3.org/2000/svg"><a><set attributeName="href" to="javascript:alert(1)"/><rect width="10" height="10"/></a></svg>`],
      ["<iframe> con src javascript:", `<svg xmlns="http://www.w3.org/2000/svg"><iframe src="javascript:alert(1)"></iframe></svg>`],
    ])("el saneador de SVG rechaza %s y no guarda nada", async (_label, svg) => {
      const admin = await loggedInAdmin();
      const before = storage.objects.size;
      await admin.agent
        .post("/api/v1/admin/platform/branding/upload")
        .set(CSRF_HEADERS)
        .send(uploadBody(Buffer.from(svg, "utf8"), "image/svg+xml"))
        .expect(400);
      expect(storage.objects.size).toBe(before);
    });

    it("lo que se guarda es el SVG reconstruido, no el original", async () => {
      const admin = await loggedInAdmin();
      const original = `<?xml version="1.0"?><!-- comentario --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0f6f6b"/></svg>`;
      const res = await admin.agent
        .post("/api/v1/admin/platform/branding/upload")
        .set(CSRF_HEADERS)
        .send(uploadBody(Buffer.from(original, "utf8"), "image/svg+xml"))
        .expect(200);
      const key = String(res.body.url).replace("https://media.test/", "");
      const stored = Buffer.from(storage.objects.get(key)!.body).toString("utf8");
      expect(stored).not.toContain("comentario");
      expect(stored).not.toContain("<?xml");
      expect(stored).toContain('<rect width="10" height="10" fill="#0f6f6b"/>');
    });
  });

  describe("Enlaces, remitente y fila única (F9.1, revisión)", () => {
    const base = {
      name: "Marca de prueba",
      logoLightUrl: null,
      logoDarkUrl: null,
      faviconUrl: null,
      primaryColor: "#0f6f6b",
      secondaryColor: "#0b5450",
      senderName: "Equipo de Marca de prueba",
      senderEmail: null,
      supportUrl: null,
      privacyUrl: "/privacidad",
      termsUrl: "/terminos",
      footerText: null,
    };

    it.each(["http://localhost.evil.com/logo.png", "http://127.0.0.1.evil.com/x.png", "javascript:alert(1)"])(
      "rechaza la URL de logo %s",
      async (url) => {
        const admin = await loggedInAdmin();
        await admin.agent
          .put("/api/v1/admin/platform/branding")
          .set(CSRF_HEADERS)
          .send({ ...base, logoLightUrl: url })
          .expect(400);
      },
    );

    it("acepta enlaces internos y un remitente sin definir", async () => {
      const admin = await loggedInAdmin();
      const res = await admin.agent.put("/api/v1/admin/platform/branding").set(CSRF_HEADERS).send(base).expect(200);
      expect(res.body.senderEmail).toBeNull();
      expect(res.body.privacyUrl).toBe("/privacidad");
    });

    it("los correos de verificación salen con el nombre y el remitente configurados", async () => {
      const admin = await loggedInAdmin();
      await admin.agent
        .put("/api/v1/admin/platform/branding")
        .set(CSRF_HEADERS)
        .send({ ...base, senderEmail: "avisos@marca-prueba.test" })
        .expect(200);

      emailAdapter.messages = [];
      await createUser();
      const message = emailAdapter.messages.find((m) => m.subject.startsWith("Verifica tu correo"));
      expect(message?.subject).toContain("Marca de prueba");
      expect(message?.from).toEqual({ name: "Equipo de Marca de prueba", email: "avisos@marca-prueba.test" });
    });

    it("la base de datos admite una sola fila de marca", async () => {
      await expect(prisma.platformBranding.create({ data: { singleton: true } })).rejects.toThrow();
    });
  });
});
