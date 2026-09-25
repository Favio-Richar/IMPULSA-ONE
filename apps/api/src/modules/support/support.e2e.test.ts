import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import {
  adminOverviewResponse,
  adminSupportTicketDetailResponse,
  adminSupportTicketListResponse,
  supportTicketDetailResponse,
  supportTicketSummaryResponse,
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
import { grantSuperAdmin } from "../admin/superadmin-grants.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { listenForTests } from "../../test-support/http.js";

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@support-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const DETAIL = "No puedo publicar mi página de inicio: el botón queda cargando y no pasa nada.";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Soporte mínimo (e2e) — F4.5", () => {
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
    const users = await prisma.user.findMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } }, select: { id: true } });
    const userIds = users.map((user) => user.id);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { targetId: { in: userIds } }] } });
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
    const agent = request.agent(httpServer);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password: PASSWORD }).expect(201);
    return { email, agent };
  }

  async function createOwnerWithOrg() {
    const owner = await createUser();
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Florería Sol", slug: unique("org") }).expect(201);
    return { ...owner, organizationId: org.body.id as string };
  }

  async function addMember(owner: Awaited<ReturnType<typeof createOwnerWithOrg>>, role: string) {
    await assignRoomyPlan(prisma, owner.organizationId);
    const member = await createUser();
    const invite = await owner.agent
      .post(`/api/v1/organizations/${owner.organizationId}/members`)
      .set(CSRF_HEADERS)
      .send({ email: member.email, role })
      .expect(201);
    await member.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF_HEADERS).expect(204);
    return member;
  }

  async function openTicket(agent: request.Agent, organizationId: string, subject = "No puedo publicar") {
    const response = await agent
      .post(`/api/v1/organizations/${organizationId}/support-tickets`)
      .set(CSRF_HEADERS)
      .send({ subject, body: DETAIL })
      .expect(201);
    return supportTicketDetailResponse.parse(response.body);
  }

  async function loggedInAdmin() {
    const email = await createUser().then((user) => user.email);
    const grant = await grantSuperAdmin(prisma, email, env.AUTH_ENCRYPTION_KEY);
    const agent = request.agent(httpServer);
    await agent
      .post("/api/v1/admin/auth/login")
      .set(CSRF_HEADERS)
      .send({ email, password: PASSWORD, code: await generate({ secret: grant.twoFactorEnrollment!.secret }) })
      .expect(201);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { agent, adminId: admin.id, email };
  }

  describe("abrir una solicitud desde el panel", () => {
    it("crea la solicitud con su primer mensaje, la audita y avisa por correo sin copiar el detalle", async () => {
      const owner = await createOwnerWithOrg();
      emailAdapter.messages = [];
      const ticket = await openTicket(owner.agent, owner.organizationId);

      expect(ticket).toMatchObject({ subject: "No puedo publicar", status: "OPEN", openedByEmail: owner.email, messageCount: 1 });
      expect(ticket.messages).toEqual([expect.objectContaining({ authorRole: "CUSTOMER", authorEmail: owner.email, body: DETAIL })]);

      const recipients = emailAdapter.messages.map((message) => message.to).sort();
      expect(recipients).toEqual([owner.email, env.SUPPORT_NOTIFICATION_EMAIL].filter(Boolean).sort());
      for (const message of emailAdapter.messages) {
        expect(message.text).not.toContain(DETAIL);
        expect(message.text).toContain(ticket.id);
      }

      const audit = await prisma.auditLog.findFirst({ where: { action: "support.ticket_opened", targetId: ticket.id } });
      expect(audit).toMatchObject({ organizationId: owner.organizationId, metadata: { subject: "No puedo publicar" } });
    });

    it("valida en el servidor: asunto sin saltos de línea y detalle con contenido", async () => {
      const owner = await createOwnerWithOrg();
      const path = `/api/v1/organizations/${owner.organizationId}/support-tickets`;
      await owner.agent.post(path).set(CSRF_HEADERS).send({ subject: "Hola\r\nBcc: otro@x.com", body: DETAIL }).expect(400);
      await owner.agent.post(path).set(CSRF_HEADERS).send({ subject: "Asunto válido", body: "corto" }).expect(400);
      expect(await prisma.supportTicket.count({ where: { organizationId: owner.organizationId } })).toBe(0);
    });

    it("sin la cabecera anti-CSRF no se abre nada", async () => {
      const owner = await createOwnerWithOrg();
      await owner.agent.post(`/api/v1/organizations/${owner.organizationId}/support-tickets`).send({ subject: "Asunto válido", body: DETAIL }).expect(403);
    });
  });

  describe("quién ve qué", () => {
    it("un editor ve solo sus solicitudes; el propietario ve todas las de la organización", async () => {
      const owner = await createOwnerWithOrg();
      const editor = await addMember(owner, "EDITOR");
      const ownerTicket = await openTicket(owner.agent, owner.organizationId, "Del propietario");
      const editorTicket = await openTicket(editor.agent, owner.organizationId, "Del editor");

      const editorList = await editor.agent.get(`/api/v1/organizations/${owner.organizationId}/support-tickets`).expect(200);
      expect(editorList.body.map((t: { id: string }) => t.id)).toEqual([editorTicket.id]);
      await editor.agent.get(`/api/v1/organizations/${owner.organizationId}/support-tickets/${ownerTicket.id}`).expect(404);

      const ownerList = await owner.agent.get(`/api/v1/organizations/${owner.organizationId}/support-tickets`).expect(200);
      expect(ownerList.body.map((t: unknown) => supportTicketSummaryResponse.parse(t).id).sort()).toEqual([ownerTicket.id, editorTicket.id].sort());
    });

    it("aislamiento: otra organización no ve ni responde una solicitud ajena (ADR-002)", async () => {
      const a = await createOwnerWithOrg();
      const b = await createOwnerWithOrg();
      const ticket = await openTicket(a.agent, a.organizationId);

      // Por la ruta de la organización ajena: sin membresía, 403.
      await b.agent.get(`/api/v1/organizations/${a.organizationId}/support-tickets/${ticket.id}`).expect(403);
      // Por su propia ruta con el id ajeno: 404, no revela que existe.
      await b.agent.get(`/api/v1/organizations/${b.organizationId}/support-tickets/${ticket.id}`).expect(404);
      await b.agent
        .post(`/api/v1/organizations/${b.organizationId}/support-tickets/${ticket.id}/messages`)
        .set(CSRF_HEADERS)
        .send({ body: "Intento responder en una solicitud ajena" })
        .expect(404);
      const list = await b.agent.get(`/api/v1/organizations/${b.organizationId}/support-tickets`).expect(200);
      expect(list.body).toEqual([]);
    });
  });

  describe("conversación con el equipo", () => {
    it("el equipo responde (el cliente no ve su correo), el cliente contesta y el equipo cierra", async () => {
      const owner = await createOwnerWithOrg();
      const admin = await loggedInAdmin();
      const ticket = await openTicket(owner.agent, owner.organizationId);

      emailAdapter.messages = [];
      const answered = await admin.agent
        .post(`/api/v1/admin/support-tickets/${ticket.id}/messages`)
        .set(CSRF_HEADERS)
        .send({ body: "Ya lo revisamos: vuelve a intentarlo y avísanos." })
        .expect(201);
      expect(adminSupportTicketDetailResponse.parse(answered.body)).toMatchObject({ status: "ANSWERED", organizationName: "Florería Sol" });
      expect(answered.body.messages.at(-1)).toMatchObject({ authorRole: "STAFF", authorEmail: admin.email });
      // Aviso al cliente, sin el texto de la respuesta.
      expect(emailAdapter.messages.map((m) => m.to)).toEqual([owner.email]);
      expect(emailAdapter.messages[0]!.text).not.toContain("Ya lo revisamos");

      const seenByCustomer = await owner.agent.get(`/api/v1/organizations/${owner.organizationId}/support-tickets/${ticket.id}`).expect(200);
      expect(seenByCustomer.body.messages.at(-1)).toMatchObject({ authorRole: "STAFF", authorEmail: null });

      const reopened = await owner.agent
        .post(`/api/v1/organizations/${owner.organizationId}/support-tickets/${ticket.id}/messages`)
        .set(CSRF_HEADERS)
        .send({ body: "Funcionó, gracias por la ayuda." })
        .expect(201);
      expect(reopened.body).toMatchObject({ status: "OPEN", messageCount: 3 });

      const closed = await admin.agent.post(`/api/v1/admin/support-tickets/${ticket.id}/close`).set(CSRF_HEADERS).expect(200);
      expect(closed.body).toMatchObject({ status: "CLOSED" });
      expect(closed.body.closedAt).not.toBeNull();

      // Cerrada: nadie responde más en ella.
      await owner.agent
        .post(`/api/v1/organizations/${owner.organizationId}/support-tickets/${ticket.id}/messages`)
        .set(CSRF_HEADERS)
        .send({ body: "Una cosa más sobre esto" })
        .expect(409);
      await admin.agent.post(`/api/v1/admin/support-tickets/${ticket.id}/messages`).set(CSRF_HEADERS).send({ body: "Respuesta tardía" }).expect(409);
      await admin.agent.post(`/api/v1/admin/support-tickets/${ticket.id}/close`).set(CSRF_HEADERS).expect(409);

      const actions = await prisma.auditLog.findMany({
        where: { targetId: ticket.id, actorId: admin.adminId },
        orderBy: { createdAt: "asc" },
      });
      expect(actions.map((entry) => entry.action)).toEqual(["admin.support_replied", "admin.support_closed"]);
    });

    it("la bandeja del equipo trae conteos por estado, filtra y atiende primero lo más antiguo", async () => {
      const owner = await createOwnerWithOrg();
      const admin = await loggedInAdmin();
      const first = await openTicket(owner.agent, owner.organizationId, "Primera solicitud");
      const second = await openTicket(owner.agent, owner.organizationId, "Segunda solicitud");

      const response = await admin.agent
        .get("/api/v1/admin/support-tickets")
        .query({ status: "OPEN", organizationId: owner.organizationId })
        .expect(200);
      const list = adminSupportTicketListResponse.parse(response.body);
      expect(list.items.map((item) => item.id)).toEqual([first.id, second.id]);
      expect(list.counts).toEqual({ OPEN: 2, ANSWERED: 0, CLOSED: 0 });

      const overview = adminOverviewResponse.parse((await admin.agent.get("/api/v1/admin/overview").expect(200)).body);
      expect(overview.totals.openSupportTickets).toBeGreaterThanOrEqual(2);
    });

    it("la bandeja del equipo no se abre con la sesión del panel", async () => {
      const owner = await createOwnerWithOrg();
      const ticket = await openTicket(owner.agent, owner.organizationId);
      await owner.agent.get("/api/v1/admin/support-tickets").expect(401);
      await owner.agent.get(`/api/v1/admin/support-tickets/${ticket.id}`).expect(401);
      await owner.agent.post(`/api/v1/admin/support-tickets/${ticket.id}/close`).set(CSRF_HEADERS).expect(401);
    });
  });

  describe("organización bloqueada (ADR-005 §6)", () => {
    it("puede pedir ayuda y responder aunque el resto del panel esté en solo lectura", async () => {
      const owner = await createOwnerWithOrg();
      const ticket = await openTicket(owner.agent, owner.organizationId);
      await prisma.organization.update({ where: { id: owner.organizationId }, data: { status: "BLOCKED", blockedAt: new Date(), blockedReason: "Prueba" } });

      // El resto sigue bloqueado.
      const site = await owner.agent
        .post(`/api/v1/organizations/${owner.organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Otro", slug: unique("sitio") })
        .expect(403);
      expect(site.body.code).toBe("ORGANIZATION_BLOCKED");

      // Soporte no.
      await openTicket(owner.agent, owner.organizationId, "¿Por qué me bloquearon?");
      await owner.agent
        .post(`/api/v1/organizations/${owner.organizationId}/support-tickets/${ticket.id}/messages`)
        .set(CSRF_HEADERS)
        .send({ body: "Necesito ayuda para resolver el bloqueo." })
        .expect(201);
    });
  });
});
