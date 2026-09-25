import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { formResponse } from "@impulza/contracts";
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

// F3.2 — formularios: CRUD de Form/FormField bajo un sitio.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@forms-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(prefix = "f3"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Forms (e2e) — F3.2", () => {
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

  async function createSiteWithOwner(): Promise<{
    organizationId: string;
    siteId: string;
    agent: ReturnType<typeof request.agent>;
    basePath: string;
  }> {
    const { agent } = await registerLoggedInUser();
    const org = await agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org Formularios", slug: uniqueSlug("org") })
      .expect(201);
    const site = await agent
      .post(`/api/v1/organizations/${org.body.id}/sites`)
      .set(CSRF_HEADERS)
      .send({ name: "Sitio", slug: uniqueSlug("site") })
      .expect(201);

    return {
      organizationId: org.body.id,
      siteId: site.body.id,
      agent,
      basePath: `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/forms`,
    };
  }

  it("un sitio nuevo no tiene formularios", async () => {
    const { agent, basePath } = await createSiteWithOwner();

    const forms = await agent.get(basePath).expect(200);
    expect(forms.body).toEqual([]);
  });

  it("crea un formulario con campos iniciales, incluido uno SELECT con opciones", async () => {
    const { agent, basePath } = await createSiteWithOwner();

    const created = await agent
      .post(basePath)
      .set(CSRF_HEADERS)
      .send({
        name: "Contacto",
        fields: [
          { type: "TEXT", label: "Nombre", required: true },
          { type: "EMAIL", label: "Correo", required: true },
          { type: "SELECT", label: "Servicio", options: ["Corte", "Color"] },
          { type: "CONSENT", label: "Acepto ser contactado" },
        ],
      })
      .expect(201);

    formResponse.parse(created.body);
    expect(created.body.fields).toHaveLength(4);
    expect(created.body.fields.map((f: { position: number }) => f.position)).toEqual([0, 1, 2, 3]);
    expect(created.body.successAction).toMatchObject({ message: expect.any(String) });
  });

  it("un SELECT sin opciones es rechazado (400)", async () => {
    const { agent, basePath } = await createSiteWithOwner();

    await agent
      .post(basePath)
      .set(CSRF_HEADERS)
      .send({ name: "Malo", fields: [{ type: "SELECT", label: "Servicio" }] })
      .expect(400);
  });

  it("agrega, edita y borra un campo, reajustando el orden", async () => {
    const { agent, basePath } = await createSiteWithOwner();
    const form = await agent.post(basePath).set(CSRF_HEADERS).send({ name: "F" }).expect(201);
    const formId = form.body.id;

    const withField = await agent
      .post(`${basePath}/${formId}/fields`)
      .set(CSRF_HEADERS)
      .send({ type: "TEXT", label: "Nombre" })
      .expect(201);
    const fieldId = withField.body.fields[0].id;

    const secondField = await agent
      .post(`${basePath}/${formId}/fields`)
      .set(CSRF_HEADERS)
      .send({ type: "EMAIL", label: "Correo", required: true })
      .expect(201);
    expect(secondField.body.fields.map((f: { position: number }) => f.position)).toEqual([0, 1]);

    await agent
      .patch(`${basePath}/${formId}/fields/${fieldId}`)
      .set(CSRF_HEADERS)
      .send({ label: "Nombre completo" })
      .expect(200);

    const afterDelete = await agent.delete(`${basePath}/${formId}/fields/${fieldId}`).set(CSRF_HEADERS).expect(200);
    expect(afterDelete.body.fields).toHaveLength(1);
    expect(afterDelete.body.fields[0].position).toBe(0);
  });

  it("borrar un formulario se lleva sus campos y envíos (cascada real, F3.1)", async () => {
    const { agent, basePath } = await createSiteWithOwner();
    const form = await agent
      .post(basePath)
      .set(CSRF_HEADERS)
      .send({ name: "F", fields: [{ type: "TEXT", label: "Nombre" }] })
      .expect(201);

    await agent.delete(`${basePath}/${form.body.id}`).set(CSRF_HEADERS).expect(204);
    await agent.get(`${basePath}/${form.body.id}`).expect(404);
  });

  it("aislamiento multi-tenant: la organización B no lee ni escribe formularios del sitio de A", async () => {
    const orgA = await createSiteWithOwner();
    const form = await orgA.agent
      .post(orgA.basePath)
      .set(CSRF_HEADERS)
      .send({ name: "De A" })
      .expect(201);

    const orgB = await createSiteWithOwner();

    // Organización de B en la URL: rechazado por el guard de membresía.
    await orgB.agent
      .get(`/api/v1/organizations/${orgA.organizationId}/sites/${orgA.siteId}/forms`)
      .expect(403);

    // El caso que de verdad importa: organización PROPIA de B, sitio y formulario de A.
    await orgB.agent
      .get(`/api/v1/organizations/${orgB.organizationId}/sites/${orgA.siteId}/forms/${form.body.id}`)
      .expect(404);
    await orgB.agent
      .patch(`/api/v1/organizations/${orgB.organizationId}/sites/${orgA.siteId}/forms/${form.body.id}`)
      .set(CSRF_HEADERS)
      .send({ name: "Secuestrado" })
      .expect(404);
    await orgB.agent
      .delete(`/api/v1/organizations/${orgB.organizationId}/sites/${orgA.siteId}/forms/${form.body.id}`)
      .set(CSRF_HEADERS)
      .expect(404);

    // El formulario de A sigue intacto.
    const stillThere = await orgA.agent.get(`${orgA.basePath}/${form.body.id}`).expect(200);
    expect(stillThere.body.name).toBe("De A");
  });
});
