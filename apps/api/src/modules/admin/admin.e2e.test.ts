import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import {
  adminAuditListResponse,
  adminLoginResponse,
  adminOrganizationDetailResponse,
  adminOrganizationListResponse,
  adminOverviewResponse,
  adminUserListResponse,
  organizationResponse,
  planResponse,
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
import { grantSuperAdmin, revokeSuperAdmin } from "./superadmin-grants.js";

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@admin-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const INVALID_ADMIN_MESSAGE = "Credenciales de administración inválidas.";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Superadministración (e2e) — F4.4 / ADR-005", () => {
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
    const users = await prisma.user.findMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } }, select: { id: true } });
    const userIds = users.map((user) => user.id);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: userIds } } });
    await prisma.organization.deleteMany({
      where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    const keys = [...(await redis.keys("ratelimit:*")), ...(await redis.keys("admin-totp-used:*"))];
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function createUser() {
    const email = `${unique("user")}${TEST_EMAIL_DOMAIN}`;
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    return email;
  }

  async function createOwnerWithOrg() {
    const email = await createUser();
    const agent = request.agent(httpServer);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password: PASSWORD }).expect(201);
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Tienda Luna", slug: unique("org") }).expect(201);
    return { email, agent, organizationId: org.body.id as string };
  }

  async function createSuperAdmin() {
    const email = await createUser();
    const grant = await grantSuperAdmin(prisma, email, env.AUTH_ENCRYPTION_KEY);
    return { email, secret: grant.twoFactorEnrollment!.secret };
  }

  async function adminLogin(email: string, secret: string) {
    const agent = request.agent(httpServer);
    const code = await generate({ secret });
    const response = await agent.post("/api/v1/admin/auth/login").set(CSRF_HEADERS).send({ email, password: PASSWORD, code });
    return { agent, response };
  }

  async function loggedInAdmin() {
    const admin = await createSuperAdmin();
    const { agent, response } = await adminLogin(admin.email, admin.secret);
    expect(response.status).toBe(201);
    return { ...admin, agent, adminId: response.body.admin.id as string };
  }

  describe("otorgar y revocar (script de operación)", () => {
    it("grant enrola el 2FA en el mismo paso y queda auditado", async () => {
      const email = await createUser();
      const result = await grantSuperAdmin(prisma, email, env.AUTH_ENCRYPTION_KEY);

      expect(result.twoFactorEnrollment?.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.isSuperAdmin).toBe(true);
      expect(user.twoFactorEnabled).toBe(true);
      // El secreto nunca queda en claro.
      expect(user.twoFactorSecretEncrypted).not.toContain(result.twoFactorEnrollment!.secret);

      const audit = await prisma.auditLog.findFirst({ where: { action: "admin.superadmin_granted", targetId: user.id } });
      expect(audit?.metadata).toMatchObject({ via: "cli", twoFactorEnrolled: true });
    });

    it("revoke corta en el acto las sesiones de administración abiertas", async () => {
      const { email, agent } = await loggedInAdmin();
      await agent.get("/api/v1/admin/overview").expect(200);

      const result = await revokeSuperAdmin(prisma, email);
      expect(result.closedSessions).toBe(1);
      await agent.get("/api/v1/admin/overview").expect(401);
    });

    it("quitar la marca directo en la base también corta el acceso (el guard la revisa en cada petición)", async () => {
      const { email, agent } = await loggedInAdmin();
      await prisma.user.update({ where: { email }, data: { isSuperAdmin: false } });
      await agent.get("/api/v1/admin/overview").expect(401);
    });
  });

  describe("login de administración", () => {
    it("con contraseña y código válidos abre una sesión con cookie propia, estricta y acotada a /api/v1/admin", async () => {
      const admin = await createSuperAdmin();
      const { response } = await adminLogin(admin.email, admin.secret);

      expect(response.status).toBe(201);
      expect(adminLoginResponse.parse(response.body).admin.email).toBe(admin.email);
      const cookie = (response.headers["set-cookie"] as unknown as string[]).find((raw) => raw.startsWith("impulza_admin_session="))!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/admin/i);
      // Nunca la cookie del panel.
      expect((response.headers["set-cookie"] as unknown as string[]).some((raw) => raw.startsWith("impulza_session="))).toBe(false);

      const session = await prisma.session.findFirstOrThrow({ where: { user: { email: admin.email }, scope: "ADMIN" } });
      const hours = (session.expiresAt.getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(7.9);
      expect(hours).toBeLessThanOrEqual(8);
    });

    it("mismo mensaje para código incorrecto, contraseña incorrecta y cuenta que no es superadmin", async () => {
      const admin = await createSuperAdmin();
      const wrongCode = await request(httpServer)
        .post("/api/v1/admin/auth/login")
        .set(CSRF_HEADERS)
        .send({ email: admin.email, password: PASSWORD, code: "000000" })
        .expect(401);
      const wrongPassword = await request(httpServer)
        .post("/api/v1/admin/auth/login")
        .set(CSRF_HEADERS)
        .send({ email: admin.email, password: "otra-clave-123", code: await generate({ secret: admin.secret }) })
        .expect(401);

      const normalUser = await createUser();
      const notAdmin = await request(httpServer)
        .post("/api/v1/admin/auth/login")
        .set(CSRF_HEADERS)
        .send({ email: normalUser, password: PASSWORD, code: "123456" })
        .expect(401);

      for (const response of [wrongCode, wrongPassword, notAdmin]) {
        expect(response.body.message).toBe(INVALID_ADMIN_MESSAGE);
      }
      const denied = await prisma.auditLog.findFirst({ where: { action: "admin.login_denied", actor: { email: normalUser } } });
      expect(denied?.metadata).toMatchObject({ reason: "not_super_admin" });
    });

    it("sin código responde 400: no existe un paso intermedio 'solo contraseña'", async () => {
      const admin = await createSuperAdmin();
      await request(httpServer)
        .post("/api/v1/admin/auth/login")
        .set(CSRF_HEADERS)
        .send({ email: admin.email, password: PASSWORD })
        .expect(400);
    });

    it("un código ya usado no vale dos veces", async () => {
      const admin = await createSuperAdmin();
      const code = await generate({ secret: admin.secret });
      const send = () =>
        request(httpServer).post("/api/v1/admin/auth/login").set(CSRF_HEADERS).send({ email: admin.email, password: PASSWORD, code });
      await send().expect(201);
      const replay = await send().expect(401);
      expect(replay.body.message).toBe(INVALID_ADMIN_MESSAGE);
    });

    it("los códigos incorrectos cuentan para el bloqueo por intentos de la cuenta", async () => {
      const admin = await createSuperAdmin();
      for (let attempt = 0; attempt < 5; attempt++) {
        await request(httpServer)
          .post("/api/v1/admin/auth/login")
          .set(CSRF_HEADERS)
          .send({ email: admin.email, password: PASSWORD, code: "000000" })
          .expect(401);
        const keys = await redis.keys("ratelimit:*");
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      }
      const locked = await request(httpServer)
        .post("/api/v1/admin/auth/login")
        .set(CSRF_HEADERS)
        .send({ email: admin.email, password: PASSWORD, code: await generate({ secret: admin.secret }) })
        .expect(403);
      expect(locked.body.message).toMatch(/bloqueada temporalmente/);
    });

    it("logout cierra la sesión y queda auditado", async () => {
      const { agent, adminId } = await loggedInAdmin();
      await agent.post("/api/v1/admin/auth/logout").set(CSRF_HEADERS).expect(204);
      await agent.get("/api/v1/admin/auth/me").expect(401);
      expect(await prisma.auditLog.count({ where: { action: "admin.logout", actorId: adminId } })).toBe(1);
    });
  });

  describe("separación de puertas (ADR-002 §4)", () => {
    it("la sesión del panel no abre la administración, ni siquiera de un superadministrador", async () => {
      const admin = await createSuperAdmin();
      const panel = request.agent(httpServer);
      await panel.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email: admin.email, password: PASSWORD }).expect(201);
      await panel.get("/api/v1/auth/me").expect(200);
      await panel.get("/api/v1/admin/overview").expect(401);
    });

    it("el id de una sesión de administración copiado a la cookie del panel no sirve", async () => {
      const { email } = await loggedInAdmin();
      const session = await prisma.session.findFirstOrThrow({ where: { user: { email }, scope: "ADMIN" } });
      await request(httpServer).get("/api/v1/auth/me").set("Cookie", `impulza_session=${session.id}`).expect(401);
      // Ni aparece en la lista de sesiones del usuario.
      const panel = request.agent(httpServer);
      await panel.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password: PASSWORD }).expect(201);
      const sessions = await panel.get("/api/v1/auth/sessions").expect(200);
      expect(sessions.body.map((s: { id: string }) => s.id)).not.toContain(session.id);
    });

    it("el id de una sesión del panel copiado a la cookie de administración no sirve", async () => {
      const { email } = await createOwnerWithOrg();
      const session = await prisma.session.findFirstOrThrow({ where: { user: { email }, scope: "USER" } });
      await request(httpServer).get("/api/v1/admin/overview").set("Cookie", `impulza_admin_session=${session.id}`).expect(401);
    });

    it("toda ruta de administración exige la sesión propia", async () => {
      const { agent } = await createOwnerWithOrg();
      for (const path of ["/api/v1/admin/overview", "/api/v1/admin/organizations", "/api/v1/admin/users", "/api/v1/admin/plans", "/api/v1/admin/audit-logs"]) {
        await agent.get(path).expect(401);
      }
    });
  });

  describe("panel global", () => {
    it("el resumen cumple el contrato y cuenta lo que existe", async () => {
      const { agent } = await loggedInAdmin();
      await createOwnerWithOrg();
      const response = await agent.get("/api/v1/admin/overview").expect(200);
      const overview = adminOverviewResponse.parse(response.body);

      expect(overview.totals.organizations).toBeGreaterThanOrEqual(1);
      expect(overview.signups).toHaveLength(30);
      expect(overview.signups.at(-1)!.organizations).toBeGreaterThanOrEqual(1);
      const distributed = overview.planDistribution.reduce((sum, plan) => sum + plan.organizations, 0);
      expect(distributed).toBe(overview.totals.organizations);
    });

    it("busca organizaciones por el correo de un miembro", async () => {
      const { agent } = await loggedInAdmin();
      const owner = await createOwnerWithOrg();
      const response = await agent.get("/api/v1/admin/organizations").query({ search: owner.email }).expect(200);
      const list = adminOrganizationListResponse.parse(response.body);
      expect(list.items.map((item) => item.id)).toEqual([owner.organizationId]);
      expect(list.items[0]).toMatchObject({ planCode: "free", members: 1, status: "ACTIVE" });
    });

    it("busca usuarios por correo", async () => {
      const { agent } = await loggedInAdmin();
      const email = await createUser();
      const response = await agent.get("/api/v1/admin/users").query({ search: email }).expect(200);
      const list = adminUserListResponse.parse(response.body);
      expect(list.total).toBe(1);
      expect(list.items[0]).toMatchObject({ email, emailVerified: true, isSuperAdmin: false });
    });

    it("ver el detalle de una organización queda auditado a nombre del superadministrador", async () => {
      const { agent, adminId } = await loggedInAdmin();
      const owner = await createOwnerWithOrg();
      const response = await agent.get(`/api/v1/admin/organizations/${owner.organizationId}`).expect(200);
      const detail = adminOrganizationDetailResponse.parse(response.body);

      expect(detail.members[0]).toMatchObject({ email: owner.email, role: "OWNER" });
      expect(detail.planSource).toBe("default");
      const audit = await prisma.auditLog.findFirst({
        where: { action: "admin.organization_viewed", actorId: adminId, organizationId: owner.organizationId },
      });
      expect(audit).not.toBeNull();
    });

    it("el detalle no expone datos comerciales (contactos, envíos, contenido)", async () => {
      const { agent } = await loggedInAdmin();
      const owner = await createOwnerWithOrg();
      const response = await agent.get(`/api/v1/admin/organizations/${owner.organizationId}`).expect(200);
      expect(Object.keys(response.body).sort()).toEqual(
        ["blockedAt", "blockedReason", "createdAt", "id", "members", "name", "plan", "planSource", "sites", "slug", "status", "usage"].sort(),
      );
    });

    it("una organización inexistente responde 404 y un id mal formado 400", async () => {
      const { agent } = await loggedInAdmin();
      await agent.get("/api/v1/admin/organizations/00000000-0000-4000-8000-000000000000").expect(404);
      await agent.get("/api/v1/admin/organizations/no-es-un-uuid").expect(400);
    });
  });

  describe("cambiar el plan a mano", () => {
    it("asigna el plan, lo refleja en el plan efectivo y audita el motivo", async () => {
      const { agent, adminId } = await loggedInAdmin();
      const owner = await createOwnerWithOrg();
      const pro = await prisma.plan.findUniqueOrThrow({ where: { code: "profesional" } });

      const response = await agent
        .put(`/api/v1/admin/organizations/${owner.organizationId}/plan`)
        .set(CSRF_HEADERS)
        .send({ planId: pro.id, reason: "Pago por transferencia de septiembre" })
        .expect(200);
      expect(adminOrganizationDetailResponse.parse(response.body)).toMatchObject({ planSource: "assigned", plan: { code: "profesional" } });

      // El panel de la organización ve el mismo plan.
      const plan = await owner.agent.get(`/api/v1/organizations/${owner.organizationId}/plan`).expect(200);
      expect(plan.body.plan.code).toBe("profesional");

      const audit = await prisma.auditLog.findFirst({ where: { action: "admin.organization_plan_changed", actorId: adminId } });
      expect(audit?.metadata).toMatchObject({ reason: "Pago por transferencia de septiembre", effectiveFrom: "free", effectiveTo: "profesional" });

      // `null` quita la asignación: vuelve al plan por defecto.
      const cleared = await agent
        .put(`/api/v1/admin/organizations/${owner.organizationId}/plan`)
        .set(CSRF_HEADERS)
        .send({ planId: null, reason: "Fin del período pagado" })
        .expect(200);
      expect(cleared.body).toMatchObject({ planSource: "default", plan: { code: "free" } });
    });

    it("exige motivo y un plan que exista", async () => {
      const { agent } = await loggedInAdmin();
      const owner = await createOwnerWithOrg();
      await agent.put(`/api/v1/admin/organizations/${owner.organizationId}/plan`).set(CSRF_HEADERS).send({ planId: null }).expect(400);
      await agent
        .put(`/api/v1/admin/organizations/${owner.organizationId}/plan`)
        .set(CSRF_HEADERS)
        .send({ planId: "00000000-0000-4000-8000-000000000000", reason: "Motivo suficiente" })
        .expect(404);
    });

    it("sin la cabecera anti-CSRF no cambia nada", async () => {
      const { agent } = await loggedInAdmin();
      const owner = await createOwnerWithOrg();
      await agent.put(`/api/v1/admin/organizations/${owner.organizationId}/plan`).send({ planId: null, reason: "Motivo suficiente" }).expect(403);
    });
  });

  describe("bloquear y restaurar", () => {
    async function ownerWithPublishedSite() {
      const owner = await createOwnerWithOrg();
      const siteSlug = unique("sitio");
      const site = await owner.agent
        .post(`/api/v1/organizations/${owner.organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Sitio", slug: siteSlug })
        .expect(201);
      const pages = await owner.agent.get(`/api/v1/organizations/${owner.organizationId}/sites/${site.body.id}/pages`).expect(200);
      await owner.agent
        .post(`/api/v1/organizations/${owner.organizationId}/sites/${site.body.id}/pages/${pages.body[0].id}/publish`)
        .set(CSRF_HEADERS)
        .send({})
        .expect(201);
      const linkSlug = unique("enlace");
      await owner.agent
        .post(`/api/v1/organizations/${owner.organizationId}/short-links`)
        .set(CSRF_HEADERS)
        .send({ slug: linkSlug, destinationUrl: "https://ejemplo.com" })
        .expect(201);
      return { ...owner, siteId: site.body.id as string, siteSlug, linkSlug };
    }

    it("bloquear apaga lo público (404 sin decir por qué) y deja el panel en solo lectura; restaurar lo devuelve", async () => {
      const { agent, adminId } = await loggedInAdmin();
      const owner = await ownerWithPublishedSite();
      await request(httpServer).get(`/api/v1/public/sites/${owner.siteSlug}`).expect(200);
      await request(httpServer).get(`/api/v1/public/short-links/${owner.linkSlug}`).expect(200);
      // El detalle distingue un sitio que se sirve de uno sin publicar (`Site.status` no cambia al publicar).
      const before = await agent.get(`/api/v1/admin/organizations/${owner.organizationId}`).expect(200);
      expect(before.body.sites).toEqual([expect.objectContaining({ slug: owner.siteSlug, live: true })]);

      const blocked = await agent
        .post(`/api/v1/admin/organizations/${owner.organizationId}/block`)
        .set(CSRF_HEADERS)
        .send({ reason: "Reporte de suplantación de marca" })
        .expect(200);
      expect(blocked.body).toMatchObject({ status: "BLOCKED", blockedReason: "Reporte de suplantación de marca" });

      // Público: igual que un sitio que no existe.
      const publicSite = await request(httpServer).get(`/api/v1/public/sites/${owner.siteSlug}`).expect(404);
      expect(JSON.stringify(publicSite.body)).not.toMatch(/bloque/i);
      await request(httpServer).get(`/api/v1/public/short-links/${owner.linkSlug}`).expect(404);

      // Panel: leer sí, y la organización ve su estado y el motivo.
      const org = await owner.agent.get(`/api/v1/organizations/${owner.organizationId}`).expect(200);
      expect(organizationResponse.parse(org.body)).toMatchObject({ status: "BLOCKED", blockedReason: "Reporte de suplantación de marca" });
      await owner.agent.get(`/api/v1/organizations/${owner.organizationId}/sites`).expect(200);
      // Escribir no, con un código estable para que el panel lo explique.
      const write = await owner.agent
        .post(`/api/v1/organizations/${owner.organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Otro", slug: unique("sitio") })
        .expect(403);
      expect(write.body.code).toBe("ORGANIZATION_BLOCKED");
      await owner.agent
        .patch(`/api/v1/organizations/${owner.organizationId}/sites/${owner.siteId}`)
        .set(CSRF_HEADERS)
        .send({ name: "Renombrado" })
        .expect(403);

      // Bloquear dos veces es un conflicto, no un segundo registro silencioso.
      await agent.post(`/api/v1/admin/organizations/${owner.organizationId}/block`).set(CSRF_HEADERS).send({ reason: "Otra vez igual" }).expect(409);

      await agent
        .post(`/api/v1/admin/organizations/${owner.organizationId}/unblock`)
        .set(CSRF_HEADERS)
        .send({ reason: "El cliente acreditó ser dueño de la marca" })
        .expect(200);
      await request(httpServer).get(`/api/v1/public/sites/${owner.siteSlug}`).expect(200);
      await owner.agent
        .patch(`/api/v1/organizations/${owner.organizationId}/sites/${owner.siteId}`)
        .set(CSRF_HEADERS)
        .send({ name: "Renombrado" })
        .expect(200);

      const actions = await prisma.auditLog.findMany({
        where: { organizationId: owner.organizationId, actorId: adminId, action: { in: ["admin.organization_blocked", "admin.organization_unblocked"] } },
        orderBy: { createdAt: "asc" },
      });
      expect(actions.map((entry) => entry.action)).toEqual(["admin.organization_blocked", "admin.organization_unblocked"]);
      expect(actions[0]!.metadata).toMatchObject({ reason: "Reporte de suplantación de marca" });
    });

    it("bloquear exige un motivo y restaurar una organización activa es un conflicto", async () => {
      const { agent } = await loggedInAdmin();
      const owner = await createOwnerWithOrg();
      await agent.post(`/api/v1/admin/organizations/${owner.organizationId}/block`).set(CSRF_HEADERS).send({ reason: "no" }).expect(400);
      await agent.post(`/api/v1/admin/organizations/${owner.organizationId}/unblock`).set(CSRF_HEADERS).send({ reason: "Motivo suficiente" }).expect(409);
    });
  });

  describe("catálogo de planes", () => {
    it("edita límites y precio, valida la forma y audita el antes y el después", async () => {
      const { agent, adminId } = await loggedInAdmin();
      const plans = await agent.get("/api/v1/admin/plans").expect(200);
      const pro = planResponse.parse(plans.body.find((plan: { code: string }) => plan.code === "profesional"));
      const original = await prisma.plan.findUniqueOrThrow({ where: { id: pro.id } });

      try {
        const response = await agent
          .patch(`/api/v1/admin/plans/${pro.id}`)
          .set(CSRF_HEADERS)
          .send({ priceMonthly: 21_990, limits: { ...pro.limits, sites: 7 }, reason: "Decisión #4: precios de lanzamiento" })
          .expect(200);
        expect(planResponse.parse(response.body)).toMatchObject({ priceMonthly: 21_990, limits: { sites: 7 } });

        const audit = await prisma.auditLog.findFirst({ where: { action: "admin.plan_updated", actorId: adminId, targetId: pro.id } });
        expect(audit?.metadata).toMatchObject({
          reason: "Decisión #4: precios de lanzamiento",
          before: { priceMonthly: pro.priceMonthly, limits: { sites: pro.limits.sites } },
          after: { priceMonthly: 21_990, limits: { sites: 7 } },
        });

        // Límites mal formados: 400, y el plan no cambia.
        await agent
          .patch(`/api/v1/admin/plans/${pro.id}`)
          .set(CSRF_HEADERS)
          .send({ limits: { sites: -1 }, reason: "Prueba de validación" })
          .expect(400);
        // Solo un motivo, sin cambios: 400.
        await agent.patch(`/api/v1/admin/plans/${pro.id}`).set(CSRF_HEADERS).send({ reason: "Nada que cambiar" }).expect(400);
      } finally {
        // El catálogo es compartido por todas las suites: se deja como estaba.
        await prisma.plan.update({
          where: { id: pro.id },
          data: { priceMonthly: original.priceMonthly, limits: original.limits ?? {} },
        });
      }
    });
  });

  describe("auditoría", () => {
    it("lista las acciones de superadministración con el correo del actor", async () => {
      const { agent, email } = await loggedInAdmin();
      const owner = await createOwnerWithOrg();
      await agent.get(`/api/v1/admin/organizations/${owner.organizationId}`).expect(200);

      const response = await agent.get("/api/v1/admin/audit-logs").query({ organizationId: owner.organizationId }).expect(200);
      const list = adminAuditListResponse.parse(response.body);
      expect(list.items[0]).toMatchObject({ action: "admin.organization_viewed", actorEmail: email, organizationName: "Tienda Luna" });
      expect(list.items.every((item) => item.action.startsWith("admin."))).toBe(true);
    });
  });
});
