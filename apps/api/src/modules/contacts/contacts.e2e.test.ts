import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { contactDetailResponse, contactResponse } from "@impulza/contracts";
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

// F3.3 — mini-CRM de contactos: CRUD, filtros, notas, borrado en cascada auditado (ADR-004).

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@contacts-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(prefix = "c33"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Contacts (e2e) — F3.3", () => {
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

  async function registerLoggedInUser(): Promise<{ email: string; agent: ReturnType<typeof request.agent> }> {
    const email = uniqueEmail();
    const password = "password1234";
    const agent = request.agent(httpServer);

    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);

    return { email, agent };
  }

  async function createOrgWithOwner(): Promise<{
    organizationId: string;
    agent: ReturnType<typeof request.agent>;
    basePath: string;
  }> {
    const { agent } = await registerLoggedInUser();
    const org = await agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org Contactos", slug: uniqueSlug("org") })
      .expect(201);

    return {
      organizationId: org.body.id,
      agent,
      basePath: `/api/v1/organizations/${org.body.id}/contacts`,
    };
  }

  it("una organización nueva no tiene contactos", async () => {
    const { agent, basePath } = await createOrgWithOwner();
    const list = await agent.get(basePath).expect(200);
    expect(list.body).toEqual([]);
  });

  it("crea un contacto manual con consentimiento UNKNOWN (ADR-004: sin formulario de por medio)", async () => {
    const { agent, basePath } = await createOrgWithOwner();

    const created = await agent
      .post(basePath)
      .set(CSRF_HEADERS)
      .send({ name: "Ana", email: "ana@ejemplo.cl", tags: ["vip"] })
      .expect(201);

    contactResponse.parse(created.body);
    expect(created.body.consentStatus).toBe("UNKNOWN");
    expect(created.body.commercialStatus).toBe("NEW");
    expect(created.body.tags).toEqual(["vip"]);
  });

  it("filtra por etiqueta, estado comercial y búsqueda libre", async () => {
    const { agent, basePath } = await createOrgWithOwner();

    await agent.post(basePath).set(CSRF_HEADERS).send({ name: "Ana Vip", email: "ana@ejemplo.cl", tags: ["vip"] }).expect(201);
    const bruno = await agent
      .post(basePath)
      .set(CSRF_HEADERS)
      .send({ name: "Bruno Regular", email: "bruno@ejemplo.cl", tags: ["nuevo"] })
      .expect(201);
    await agent
      .patch(`${basePath}/${bruno.body.id}`)
      .set(CSRF_HEADERS)
      .send({ commercialStatus: "WON" })
      .expect(200);

    const byTag = await agent.get(`${basePath}?tag=vip`).expect(200);
    expect(byTag.body.map((c: { name: string }) => c.name)).toEqual(["Ana Vip"]);

    const byStatus = await agent.get(`${basePath}?commercialStatus=WON`).expect(200);
    expect(byStatus.body.map((c: { name: string }) => c.name)).toEqual(["Bruno Regular"]);

    const bySearch = await agent.get(`${basePath}?search=bruno`).expect(200);
    expect(bySearch.body.map((c: { name: string }) => c.name)).toEqual(["Bruno Regular"]);
  });

  it("agrega una nota y queda en la línea de tiempo del contacto", async () => {
    const { agent, basePath } = await createOrgWithOwner();
    const contact = await agent.post(basePath).set(CSRF_HEADERS).send({ name: "Ana" }).expect(201);

    const withNote = await agent
      .post(`${basePath}/${contact.body.id}/notes`)
      .set(CSRF_HEADERS)
      .send({ note: "Llamar la próxima semana." })
      .expect(201);

    contactDetailResponse.parse(withNote.body);
    expect(withNote.body.events).toHaveLength(1);
    expect(withNote.body.events[0]).toMatchObject({ type: "NOTE" });
  });

  it("exportar audita el acceso (portabilidad ARCO+, ADR-004 punto 5)", async () => {
    const { agent, basePath, organizationId } = await createOrgWithOwner();
    const contact = await agent.post(basePath).set(CSRF_HEADERS).send({ name: "Ana" }).expect(201);

    const exported = await agent.get(`${basePath}/${contact.body.id}/export`).expect(200);
    contactDetailResponse.parse(exported.body);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId, action: "contact.exported", targetId: contact.body.id },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("borrar un contacto se lleva sus eventos (cascada real, ADR-004 punto 5) y queda auditado", async () => {
    const { agent, basePath, organizationId } = await createOrgWithOwner();
    const contact = await agent.post(basePath).set(CSRF_HEADERS).send({ name: "Ana" }).expect(201);
    await agent.post(`${basePath}/${contact.body.id}/notes`).set(CSRF_HEADERS).send({ note: "x" }).expect(201);

    await agent.delete(`${basePath}/${contact.body.id}`).set(CSRF_HEADERS).expect(204);
    await agent.get(`${basePath}/${contact.body.id}`).expect(404);

    const events = await prisma.contactEvent.findMany({ where: { contactId: contact.body.id } });
    expect(events).toHaveLength(0);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId, action: "contact.deleted", targetId: contact.body.id },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("revisión de retención (ADR-004 punto 4): filtro de marcados y 'Conservar' auditado", async () => {
    const { agent, basePath, organizationId } = await createOrgWithOwner();
    const flagged = await agent.post(basePath).set(CSRF_HEADERS).send({ name: "Inactivo" }).expect(201);
    const active = await agent.post(basePath).set(CSRF_HEADERS).send({ name: "Activo" }).expect(201);
    // La marca la pone el job diario del worker; acá se simula su resultado.
    await prisma.contact.update({ where: { id: flagged.body.id }, data: { retentionReviewAt: new Date() } });

    const pending = await agent.get(`${basePath}?retentionReview=pending`).expect(200);
    expect(pending.body.map((c: { id: string }) => c.id)).toEqual([flagged.body.id]);
    expect(pending.body.map((c: { id: string }) => c.id)).not.toContain(active.body.id);

    const kept = await agent.post(`${basePath}/${flagged.body.id}/retention-review/keep`).set(CSRF_HEADERS).expect(200);
    const detail = contactDetailResponse.parse(kept.body);
    expect(detail.retentionReviewAt).toBeNull();
    // Conservar no borra nada ni toca los datos del contacto.
    expect(detail.name).toBe("Inactivo");

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId, action: "contact.retention_kept", targetId: flagged.body.id },
    });
    expect(auditEntry).not.toBeNull();
    expect((await agent.get(`${basePath}?retentionReview=pending`).expect(200)).body).toEqual([]);
  });

  describe("permisos", () => {
    it("SUPPORT administra contactos pero no puede borrarlos; ANALYST solo lee", async () => {
      const { agent: owner, organizationId, basePath } = await createOrgWithOwner();
      const support = await registerLoggedInUser();
      const analyst = await registerLoggedInUser();

      const inviteSupport = await owner
        .post(`/api/v1/organizations/${organizationId}/members`)
        .set(CSRF_HEADERS)
        .send({ email: support.email, role: "SUPPORT" })
        .expect(201);
      await support.agent.post(`/api/v1/memberships/${inviteSupport.body.membershipId}/accept`).set(CSRF_HEADERS).expect(204);

      const inviteAnalyst = await owner
        .post(`/api/v1/organizations/${organizationId}/members`)
        .set(CSRF_HEADERS)
        .send({ email: analyst.email, role: "ANALYST" })
        .expect(201);
      await analyst.agent.post(`/api/v1/memberships/${inviteAnalyst.body.membershipId}/accept`).set(CSRF_HEADERS).expect(204);

      const contact = await owner.post(basePath).set(CSRF_HEADERS).send({ name: "Ana" }).expect(201);

      await support.agent
        .patch(`${basePath}/${contact.body.id}`)
        .set(CSRF_HEADERS)
        .send({ commercialStatus: "CONTACTED" })
        .expect(200);
      await support.agent.delete(`${basePath}/${contact.body.id}`).set(CSRF_HEADERS).expect(403);

      await support.agent.post(`${basePath}/${contact.body.id}/retention-review/keep`).set(CSRF_HEADERS).expect(200);
      await analyst.agent.post(`${basePath}/${contact.body.id}/retention-review/keep`).set(CSRF_HEADERS).expect(403);

      await analyst.agent.get(basePath).expect(200);
      await analyst.agent
        .patch(`${basePath}/${contact.body.id}`)
        .set(CSRF_HEADERS)
        .send({ commercialStatus: "LOST" })
        .expect(403);
    });
  });

  describe("aislamiento entre organizaciones", () => {
    it("A no alcanza los contactos de B por ninguna combinación de ids", async () => {
      const orgA = await createOrgWithOwner();
      const orgB = await createOrgWithOwner();

      const contactOfB = await orgB.agent.post(orgB.basePath).set(CSRF_HEADERS).send({ name: "De B" }).expect(201);

      // Organización de B en la URL: frenado por el guard de membresía.
      await orgA.agent.get(orgB.basePath).expect(403);

      // Organización PROPIA de A, contacto de B: lo frena el `where: {organizationId}` del servicio.
      await orgA.agent.get(`${orgA.basePath}/${contactOfB.body.id}`).expect(404);
      await orgA.agent
        .patch(`${orgA.basePath}/${contactOfB.body.id}`)
        .set(CSRF_HEADERS)
        .send({ commercialStatus: "WON" })
        .expect(404);
      await orgA.agent.delete(`${orgA.basePath}/${contactOfB.body.id}`).set(CSRF_HEADERS).expect(404);

      const stillThere = await orgB.agent.get(`${orgB.basePath}/${contactOfB.body.id}`).expect(200);
      expect(stillThere.body.name).toBe("De B");
    });
  });
});
