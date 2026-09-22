import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
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

// F3.2 — envío público: antispam, validación contra los campos reales, y el efecto en Contact/
// ContactEvent según ADR-004 (consentimiento).

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@public-forms-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(prefix = "pf3"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Public form submission (e2e) — F3.2", () => {
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

  async function setupPublishedFormSite(): Promise<{
    siteSlug: string;
    organizationId: string;
    siteId: string;
    formId: string;
    fields: { name: string; email: string; consent: string };
    agent: ReturnType<typeof request.agent>;
  }> {
    const email = uniqueEmail();
    const password = "password1234";
    const agent = request.agent(httpServer);

    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);

    const siteSlug = uniqueSlug("site");
    const org = await agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org Envío Público", slug: uniqueSlug("org") })
      .expect(201);
    const site = await agent
      .post(`/api/v1/organizations/${org.body.id}/sites`)
      .set(CSRF_HEADERS)
      .send({ name: "Sitio", slug: siteSlug })
      .expect(201);

    const form = await agent
      .post(`/api/v1/organizations/${org.body.id}/sites/${site.body.id}/forms`)
      .set(CSRF_HEADERS)
      .send({
        name: "Contacto",
        fields: [
          { type: "TEXT", label: "Nombre", required: true },
          { type: "EMAIL", label: "Correo", required: true },
          { type: "CONSENT", label: "Acepto ser contactado" },
        ],
      })
      .expect(201);

    const [nameField, emailField, consentField] = form.body.fields as Array<{ id: string }>;
    if (!nameField || !emailField || !consentField) {
      throw new Error("El formulario de prueba no se creó con los tres campos esperados.");
    }

    return {
      siteSlug,
      organizationId: org.body.id,
      siteId: site.body.id,
      formId: form.body.id,
      fields: { name: nameField.id, email: emailField.id, consent: consentField.id },
      agent,
    };
  }

  it("GET público expone los campos sin datos internos del formulario ni de la organización", async () => {
    const { siteSlug, formId } = await setupPublishedFormSite();

    const response = await request(httpServer).get(`/api/v1/public/sites/${siteSlug}/forms/${formId}`).expect(200);

    expect(response.body).toMatchObject({ id: formId, name: "Contacto" });
    expect(response.body.fields).toHaveLength(3);
    expect(JSON.stringify(response.body)).not.toContain("siteId");
    expect(JSON.stringify(response.body)).not.toContain("organizationId");
  });

  it("un envío válido con consentimiento crea un Contact y su ContactEvent", async () => {
    const { siteSlug, formId, fields, organizationId } = await setupPublishedFormSite();
    const email = `visitante-${Date.now()}${TEST_EMAIL_DOMAIN}`;

    const response = await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/forms/${formId}/submissions`)
      .set(CSRF_HEADERS)
      .send({ [fields.name]: "Visitante", [fields.email]: email, [fields.consent]: true })
      .expect(201);

    expect(response.body).toMatchObject({ message: expect.any(String) });

    const contact = await prisma.contact.findFirst({ where: { organizationId, email } });
    expect(contact).not.toBeNull();
    expect(contact?.consentStatus).toBe("GRANTED");
    expect(contact?.consentSource).toBe(`form:${formId}`);

    const events = await prisma.contactEvent.findMany({ where: { contactId: contact?.id } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("FORM_SUBMISSION");
  });

  it("sin el campo de consentimiento marcado, no crea Contact — solo el FormSubmission crudo (ADR-004)", async () => {
    const { siteSlug, formId, fields, organizationId } = await setupPublishedFormSite();
    const email = `sin-consentimiento-${Date.now()}${TEST_EMAIL_DOMAIN}`;

    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/forms/${formId}/submissions`)
      .set(CSRF_HEADERS)
      .send({ [fields.name]: "Visitante", [fields.email]: email, [fields.consent]: false })
      .expect(201);

    const contact = await prisma.contact.findFirst({ where: { organizationId, email } });
    expect(contact).toBeNull();

    const submissions = await prisma.formSubmission.findMany({ where: { formId } });
    expect(submissions.some((s) => s.contactId === null)).toBe(true);
  });

  it("rechaza un envío que le falta un campo requerido", async () => {
    const { siteSlug, formId, fields } = await setupPublishedFormSite();

    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/forms/${formId}/submissions`)
      .set(CSRF_HEADERS)
      .send({ [fields.name]: "Visitante" })
      .expect(400);
  });

  it("un honeypot con contenido responde éxito pero no persiste nada (antispam silencioso)", async () => {
    const { siteSlug, formId, fields, organizationId } = await setupPublishedFormSite();
    const before = await prisma.formSubmission.count({ where: { formId } });

    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/forms/${formId}/submissions`)
      .set(CSRF_HEADERS)
      .send({
        [fields.name]: "Bot",
        [fields.email]: `bot-${Date.now()}${TEST_EMAIL_DOMAIN}`,
        [fields.consent]: true,
        _hp: "soy un bot",
      })
      .expect(201);

    const after = await prisma.formSubmission.count({ where: { formId } });
    expect(after).toBe(before);
    const contact = await prisma.contact.findFirst({
      where: { organizationId, email: { contains: "bot-" } },
    });
    expect(contact).toBeNull();
  });

  it("un sitio archivado no expone su formulario ni acepta envíos (404)", async () => {
    const { siteSlug, formId, fields, agent, organizationId, siteId } = await setupPublishedFormSite();

    await agent.post(`/api/v1/organizations/${organizationId}/sites/${siteId}/archive`).set(CSRF_HEADERS).expect(201);

    await request(httpServer).get(`/api/v1/public/sites/${siteSlug}/forms/${formId}`).expect(404);
    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/forms/${formId}/submissions`)
      .set(CSRF_HEADERS)
      .send({ [fields.name]: "X", [fields.email]: "x@x.cl" })
      .expect(404);
  });

  it("sin la cabecera CSRF, el envío se rechaza", async () => {
    const { siteSlug, formId, fields } = await setupPublishedFormSite();

    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/forms/${formId}/submissions`)
      .send({ [fields.name]: "X", [fields.email]: "x@x.cl" })
      .expect(403);
  });
});
