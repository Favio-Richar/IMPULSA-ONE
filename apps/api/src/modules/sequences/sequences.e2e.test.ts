import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { emailSequenceEnrollmentResponse, emailSequenceResponse } from "@impulza/contracts";
import { signSequenceUnsubscribeToken, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import { AUTOMATION_EVENTS_QUEUE, automationJobId, MAX_SEQUENCES_PER_ORGANIZATION, type AutomationEventJob } from "@impulza/validation";
import { Queue } from "bullmq";
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

// F7.5 — secuencias de correo (ADR-020): configuración con permisos, validación, saneo, tope y
// auditoría; el evento se encola aunque solo haya secuencias; la newsletter dispara su evento; la
// baja desde un correo de secuencia detiene todo; aislamiento entre organizaciones.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@sequences-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const step = (subject: string, delayHours = 0) => ({ delayHours, subject, bodyHtml: `<p>Hola {{nombre}}, ${subject}.</p>` });

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Secuencias de correo (e2e) — F7.5", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let queue: Queue<AutomationEventJob>;
  let httpServer: Parameters<typeof request>[0];
  const emailAdapter = new FakeEmailAdapter();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EMAIL_ADAPTER).useValue(emailAdapter).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    httpServer = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
    queue = new Queue(AUTOMATION_EVENTS_QUEUE, { connection: { url: env.REDIS_URL, maxRetriesPerRequest: null } });
  });

  afterAll(async () => {
    await queue.close();
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  async function register() {
    const email = `user-${unique("u")}${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password: "password1234" }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password: "password1234" }).expect(201);
    return { agent, email };
  }

  async function setup() {
    const { agent, email } = await register();
    const org = (await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Café Aroma", slug: unique("org") }).expect(201)).body;
    await assignRoomyPlan(prisma, org.id);
    return { agent, email, organizationId: org.id as string, path: `/api/v1/organizations/${org.id}/email-sequences` };
  }

  async function addMember(organizationId: string, roleName: string) {
    const member = await register();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: member.email } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.membership.create({ data: { organizationId, userId: user.id, roleId: role.id, status: "ACTIVE" } });
    return member.agent;
  }

  it("crea, edita los pasos, apaga y borra; sanea el cuerpo, congela el límite del plan y audita todo", async () => {
    const { agent, organizationId, path } = await setup();
    const created = emailSequenceResponse.parse(
      (await agent.post(path).set(CSRF_HEADERS).send({ name: "Bienvenida", trigger: "newsletter_subscribed", steps: [{ ...step("bienvenida"), bodyHtml: '<p onclick="x()">Hola</p><script>alert(1)</script>' }, step("consejos", 48)] }).expect(201)).body,
    );
    expect(created).toMatchObject({ enabled: true, trigger: "newsletter_subscribed", stats: { active: 0, completed: 0, stopped: 0, sentLast30Days: 0 } });
    expect(created.steps.map((s) => [s.position, s.delayHours])).toEqual([[0, 0], [1, 48]]);
    expect(created.steps[0]!.bodyHtml).not.toContain("script");
    expect(created.steps[0]!.bodyHtml).not.toContain("onclick");
    const stored = await prisma.emailSequence.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.emailsPerHour).toBeGreaterThan(0);

    const updated = emailSequenceResponse.parse((await agent.patch(`${path}/${created.id}`).set(CSRF_HEADERS).send({ steps: [step("solo uno")] }).expect(200)).body);
    expect(updated.steps.map((s) => s.subject)).toEqual(["solo uno"]);
    expect((await agent.patch(`${path}/${created.id}`).set(CSRF_HEADERS).send({ enabled: false }).expect(200)).body.enabled).toBe(false);
    await agent.patch(`${path}/${created.id}`).set(CSRF_HEADERS).send({ enabled: true }).expect(200);
    await agent.delete(`${path}/${created.id}`).set(CSRF_HEADERS).expect(204);
    expect((await agent.get(path).expect(200)).body).toEqual([]);

    const audit = await prisma.auditLog.findMany({ where: { organizationId, targetId: created.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((row) => row.action)).toEqual(["email_sequence.created", "email_sequence.updated", "email_sequence.paused", "email_sequence.resumed", "email_sequence.deleted"]);
  });

  it("valida en el servidor (disparador, pasos, esperas, cuerpo vacío) y respeta el tope de secuencias", async () => {
    const { agent, organizationId, path } = await setup();
    await agent.post(path).set(CSRF_HEADERS).send({ name: "X", trigger: "page_viewed", steps: [step("a")] }).expect(400);
    await agent.post(path).set(CSRF_HEADERS).send({ name: "X", trigger: "contact_created", steps: [] }).expect(400);
    await agent.post(path).set(CSRF_HEADERS).send({ name: "X", trigger: "contact_created", steps: [step("a", 24 * 400)] }).expect(400);
    await agent.post(path).set(CSRF_HEADERS).send({ name: "X", trigger: "contact_created", steps: [{ ...step("a"), bodyHtml: "<p> </p>" }] }).expect(400);
    await agent.post(path).set(CSRF_HEADERS).send({ name: "X", trigger: "contact_created", steps: Array.from({ length: 11 }, (_, i) => step(`s${i}`)) }).expect(400);
    for (let i = 0; i < MAX_SEQUENCES_PER_ORGANIZATION; i++) {
      await prisma.emailSequence.create({ data: { organizationId, name: `R${i}`, trigger: "contact_created" } });
    }
    expect((await agent.post(path).set(CSRF_HEADERS).send({ name: "Una más", trigger: "contact_created", steps: [step("a")] }).expect(422)).body.code).toBe("SEQUENCE_LIMIT_REACHED");
  });

  it("con solo una secuencia (sin automatizaciones) el evento se encola, y la newsletter dispara el suyo", async () => {
    const { agent, organizationId, path } = await setup();
    await agent.post(path).set(CSRF_HEADERS).send({ name: "Seguimiento", trigger: "contact_created", steps: [step("hola")] }).expect(201);
    const contact = (await agent.post(`/api/v1/organizations/${organizationId}/contacts`).set(CSRF_HEADERS).send({ name: "Ana" }).expect(201)).body;
    expect((await queue.getJob(automationJobId("contact_created", contact.id)))?.data).toMatchObject({ trigger: "contact_created", contactId: contact.id });

    // Newsletter (F7.4): la confirmación encola `newsletter_subscribed` con el id de la confirmación.
    await agent.post(path).set(CSRF_HEADERS).send({ name: "Bienvenida", trigger: "newsletter_subscribed", steps: [step("bienvenida")] }).expect(201);
    const site = (await agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF_HEADERS).send({ name: "Sitio", slug: unique("s") }).expect(201)).body;
    const pagesPath = `/api/v1/organizations/${organizationId}/sites/${site.id}/pages`;
    const page = (await agent.get(pagesPath).expect(200)).body[0];
    await agent.post(`${pagesPath}/${page.id}/blocks`).set(CSRF_HEADERS).send({ type: "newsletter", config: {} }).expect(201);
    await agent.post(`${pagesPath}/${page.id}/publish`).set(CSRF_HEADERS).expect(201);
    await request(httpServer).post(`/api/v1/public/sites/${site.slug}/newsletter`).set(CSRF_HEADERS).send({ email: `lector-${unique("x")}@ejemplo.cl`, consent: true }).expect(202);
    const token = /\/suscripcion\/([A-Za-z0-9_-]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post(`/api/v1/public/newsletter/${token}`).set(CSRF_HEADERS).expect(200);
    const confirmation = await prisma.newsletterConfirmation.findFirstOrThrow({ where: { siteId: site.id } });
    expect((await queue.getJob(automationJobId("newsletter_subscribed", confirmation.id)))?.data).toMatchObject({ trigger: "newsletter_subscribed", contactId: confirmation.contactId });
  });

  it("registro de inscripciones, detener una, y la baja desde un correo de secuencia detiene todas las del contacto", async () => {
    const { agent, organizationId, path } = await setup();
    const a = (await agent.post(path).set(CSRF_HEADERS).send({ name: "A", trigger: "contact_created", steps: [step("a")] }).expect(201)).body;
    const b = (await agent.post(path).set(CSRF_HEADERS).send({ name: "B", trigger: "contact_created", steps: [step("b")] }).expect(201)).body;
    const contact = await prisma.contact.create({ data: { organizationId, name: "Rosa", email: `rosa-${unique("r")}@ejemplo.cl`, marketingConsentAt: new Date() } });
    const now = new Date();
    const enrollA = await prisma.emailSequenceEnrollment.create({ data: { organizationId, sequenceId: a.id, contactId: contact.id, eventKey: "k1", nextSendAt: now } });
    await prisma.emailSequenceEnrollment.create({ data: { organizationId, sequenceId: b.id, contactId: contact.id, eventKey: "k2", nextSendAt: now } });

    const list = z.array(emailSequenceEnrollmentResponse).parse((await agent.get(`${path}/${a.id}/enrollments`).expect(200)).body);
    expect(list).toEqual([expect.objectContaining({ id: enrollA.id, status: "ACTIVE", sentSteps: 0, contact: { id: contact.id, name: "Rosa", email: contact.email } })]);

    const token = signSequenceUnsubscribeToken(enrollA.id, env.BOOKING_LINK_SECRET!);
    const view = (await request(httpServer).get(`/api/v1/public/unsubscribe/${token}`).set(CSRF_HEADERS).expect(200)).body;
    expect(view).toMatchObject({ organizationName: "Café Aroma", unsubscribed: false });
    await request(httpServer).post(`/api/v1/public/unsubscribe/${token}`).set(CSRF_HEADERS).expect(200);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).marketingUnsubscribedAt).not.toBeNull();
    const enrollments = await prisma.emailSequenceEnrollment.findMany({ where: { contactId: contact.id } });
    expect(enrollments.map((row) => [row.status, row.stopReason])).toEqual([["STOPPED", "unsubscribed"], ["STOPPED", "unsubscribed"]]);
    expect(await prisma.auditLog.count({ where: { organizationId, action: "contact.marketing_unsubscribed", targetId: contact.id } })).toBe(1);

    // Detener a mano: solo una activa; una cerrada da 409.
    const other = await prisma.contact.create({ data: { organizationId, email: `otro-${unique("o")}@ejemplo.cl`, marketingConsentAt: now } });
    const enrollOther = await prisma.emailSequenceEnrollment.create({ data: { organizationId, sequenceId: a.id, contactId: other.id, eventKey: "k3", nextSendAt: now } });
    await agent.post(`${path}/${a.id}/enrollments/${enrollOther.id}/stop`).set(CSRF_HEADERS).expect(204);
    await agent.post(`${path}/${a.id}/enrollments/${enrollOther.id}/stop`).set(CSRF_HEADERS).expect(409);
    expect(await prisma.emailSequenceEnrollment.findUniqueOrThrow({ where: { id: enrollOther.id } })).toMatchObject({ status: "STOPPED", stopReason: "manual" });
  });

  it("envío de prueba al propio correo, marcado [Prueba] y sin enlace de baja real", async () => {
    const { agent, email, path } = await setup();
    const seq = (await agent.post(path).set(CSRF_HEADERS).send({ name: "A", trigger: "contact_created", steps: [step("bienvenida")] }).expect(201)).body;
    await agent.post(`${path}/${seq.id}/steps/0/test`).set(CSRF_HEADERS).expect(204);
    const mail = emailAdapter.messages.at(-1)!;
    expect(mail).toMatchObject({ to: email, subject: "[Prueba] bienvenida" });
    expect(mail.html).toContain("Envío de prueba");
    await agent.post(`${path}/${seq.id}/steps/7/test`).set(CSRF_HEADERS).expect(404);
  });

  it("permisos y aislamiento: un EDITOR o ANALYST solo miran; otra organización no ve ni toca nada", async () => {
    const owner = await setup();
    const seq = (await owner.agent.post(owner.path).set(CSRF_HEADERS).send({ name: "A", trigger: "contact_created", steps: [step("a")] }).expect(201)).body;
    for (const roleName of ["EDITOR", "ANALYST"]) {
      const member = await addMember(owner.organizationId, roleName);
      await member.get(owner.path).expect(200);
      await member.post(owner.path).set(CSRF_HEADERS).send({ name: "X", trigger: "contact_created", steps: [step("x")] }).expect(403);
      await member.patch(`${owner.path}/${seq.id}`).set(CSRF_HEADERS).send({ enabled: false }).expect(403);
      await member.delete(`${owner.path}/${seq.id}`).set(CSRF_HEADERS).expect(403);
    }
    const other = await setup();
    await other.agent.get(owner.path).expect(403);
    const foreign = `${other.path}/${seq.id}`;
    await other.agent.patch(foreign).set(CSRF_HEADERS).send({ enabled: false }).expect(404);
    await other.agent.delete(foreign).set(CSRF_HEADERS).expect(404);
    await other.agent.get(`${foreign}/enrollments`).expect(404);
    await other.agent.post(`${foreign}/steps/0/test`).set(CSRF_HEADERS).expect(404);
    expect((await other.agent.get(other.path).expect(200)).body).toEqual([]);
    expect((await prisma.emailSequence.findUniqueOrThrow({ where: { id: seq.id } })).enabled).toBe(true);
  });
});
