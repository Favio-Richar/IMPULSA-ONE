import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { automationListItemResponse, automationRunResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import { AUTOMATION_EVENTS_QUEUE, MAX_AUTOMATIONS_PER_ORGANIZATION, automationJobId, type AutomationEventJob, type AutomationTrigger } from "@impulza/validation";
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

// F6.7 — automatizaciones: reglas de un catálogo cerrado con permisos y tope, y cada disparador real
// (contacto nuevo, reserva, pedido) encola un evento con solo ids — y ninguno si no hay reglas
// encendidas. La ejecución la prueban las pruebas del worker contra la misma base.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@automations-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Automatizaciones (e2e) — F6.7", () => {
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
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function register() {
    const email = `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password: "password1234" }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password: "password1234" }).expect(201);
    return { agent, email };
  }

  async function setup() {
    const { agent } = await register();
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org Auto", slug: uniqueSlug("org") }).expect(201);
    await assignRoomyPlan(prisma, org.body.id);
    const organizationId = org.body.id as string;
    return { agent, organizationId, path: `/api/v1/organizations/${organizationId}/automations` };
  }

  /** El trabajo encolado para un evento, en el estado que esté (el worker de desarrollo puede haberlo tomado). */
  const jobFor = (trigger: AutomationTrigger, subjectId: string) => queue.getJob(automationJobId(trigger, subjectId));

  it("crea, edita, apaga y borra automatizaciones del catálogo; rechaza lo que no está en él", async () => {
    const { agent, path } = await setup();
    const created = automationListItemResponse.parse(
      (await agent.post(path).set(CSRF_HEADERS).send({ name: "Etiquetar reservas", trigger: "booking_created", action: { type: "tag_contact", tag: "reservó" } }).expect(201)).body,
    );
    expect(created).toMatchObject({ enabled: true, actionValid: true, runsLast30Days: { succeeded: 0, failed: 0 }, lastRun: null });

    await agent.post(path).set(CSRF_HEADERS).send({ name: "X", trigger: "page_viewed", action: { type: "notify_team" } }).expect(400);
    await agent.post(path).set(CSRF_HEADERS).send({ name: "X", trigger: "contact_created", action: { type: "webhook", url: "https://evil.example.com" } }).expect(400);

    const updated = (await agent.patch(`${path}/${created.id}`).set(CSRF_HEADERS).send({ enabled: false, action: { type: "set_commercial_status", status: "QUALIFIED" } }).expect(200)).body;
    expect(updated).toMatchObject({ enabled: false, action: { type: "set_commercial_status", status: "QUALIFIED" } });
    expect((await agent.get(path).expect(200)).body).toHaveLength(1);

    await agent.delete(`${path}/${created.id}`).set(CSRF_HEADERS).expect(204);
    expect((await agent.get(path).expect(200)).body).toEqual([]);
    const audit = await prisma.auditLog.findMany({ where: { targetId: created.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((row) => row.action)).toEqual(["automation.created", "automation.updated", "automation.deleted"]);
  });

  it("un contacto nuevo encola el evento solo con ids; sin reglas encendidas no encola nada", async () => {
    const { agent, organizationId, path } = await setup();
    const withoutRules = (await agent.post(`/api/v1/organizations/${organizationId}/contacts`).set(CSRF_HEADERS).send({ name: "Sin reglas" }).expect(201)).body;
    expect(await jobFor("contact_created", withoutRules.id)).toBeUndefined();

    await agent.post(path).set(CSRF_HEADERS).send({ name: "Avisar", trigger: "contact_created", action: { type: "notify_team" } }).expect(201);
    const contact = (await agent.post(`/api/v1/organizations/${organizationId}/contacts`).set(CSRF_HEADERS).send({ name: "Ana Pérez", email: `ana-${Date.now()}@example.com` }).expect(201)).body;
    const job = await jobFor("contact_created", contact.id);
    expect(job?.data).toEqual({ organizationId, trigger: "contact_created", subjectId: contact.id, contactId: contact.id, occurredAt: expect.any(String) });
    expect(JSON.stringify(job?.data)).not.toContain("Ana");
  });

  it("una reserva desde la página pública encola booking_created con su contacto", async () => {
    const { agent, organizationId, path } = await setup();
    const siteSlug = uniqueSlug("site");
    const site = await agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF_HEADERS).send({ name: "Barbería", slug: siteSlug }).expect(201);
    const booking = `/api/v1/organizations/${organizationId}/sites/${site.body.id}/booking`;
    const allDay = [{ start: "00:00", end: "24:00" }];
    await agent
      .put(`${booking}/settings`)
      .set(CSRF_HEADERS)
      .send({ enabled: true, timeZone: "America/Santiago", minNoticeMinutes: 0, maxAdvanceDays: 30, bufferMinutes: 0, slotIntervalMinutes: 30, weeklyHours: { mon: allDay, tue: allDay, wed: allDay, thu: allDay, fri: allDay, sat: allDay, sun: allDay } })
      .expect(200);
    const service = (await agent.post(`${booking}/services`).set(CSRF_HEADERS).send({ name: "Corte", durationMinutes: 30 }).expect(201)).body;
    await agent.post(path).set(CSRF_HEADERS).send({ name: "Etiquetar", trigger: "booking_created", action: { type: "tag_contact", tag: "cliente" } }).expect(201);

    const from = new Date(Date.now() + 2 * 24 * 3_600_000).toISOString().slice(0, 10);
    const slots = await request(httpServer).get(`/api/v1/public/sites/${siteSlug}/booking/availability`).set(CSRF_HEADERS).query({ serviceId: service.id, from, days: 1 }).expect(200);
    const startsAt = slots.body.days[0].slots[0] as string;
    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/booking`)
      .set(CSRF_HEADERS)
      .send({ serviceId: service.id, startsAt, name: "Luis", email: `luis-${Date.now()}@example.com`, consent: true })
      .expect(201);

    const created = await prisma.booking.findFirstOrThrow({ where: { organizationId }, select: { id: true, contactId: true } });
    const job = await jobFor("booking_created", created.id);
    expect(job?.data).toMatchObject({ organizationId, trigger: "booking_created", subjectId: created.id, contactId: created.contactId });
  });

  it("muestra el registro de ejecuciones sin datos del contacto, respeta el tope y los permisos", async () => {
    const { agent, organizationId, path } = await setup();
    const automation = (await agent.post(path).set(CSRF_HEADERS).send({ name: "Estado", trigger: "order_created", action: { type: "set_commercial_status", status: "WON" } }).expect(201)).body;
    await prisma.automationRun.create({
      data: { organizationId, automationId: automation.id, eventKey: "order_created:x", trigger: "order_created", subjectId: "11111111-1111-4111-8111-111111111111", status: "SKIPPED", attempts: 1, detail: "El evento no tiene un contacto al que cambiarle el estado.", finishedAt: new Date() },
    });
    const runs = z.array(automationRunResponse).parse((await agent.get(`${path}/${automation.id}/runs`).expect(200)).body);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "SKIPPED", attempts: 1 });
    expect((await agent.get(path).expect(200)).body[0].lastRun).toMatchObject({ status: "SKIPPED" });

    for (let i = 1; i < MAX_AUTOMATIONS_PER_ORGANIZATION; i++) {
      await prisma.automation.create({ data: { organizationId, name: `Relleno ${i}`, trigger: "contact_created", action: { type: "notify_team" } } });
    }
    const full = await agent.post(path).set(CSRF_HEADERS).send({ name: "Una más", trigger: "contact_created", action: { type: "notify_team" } }).expect(422);
    expect(full.body.code).toBe("AUTOMATION_LIMIT_REACHED");

    const analyst = await register();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: analyst.email } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "ANALYST" } });
    await prisma.membership.create({ data: { organizationId, userId: user.id, roleId: role.id, status: "ACTIVE" } });
    await analyst.agent.get(path).expect(200);
    await analyst.agent.patch(`${path}/${automation.id}`).set(CSRF_HEADERS).send({ enabled: false }).expect(403);
    await analyst.agent.delete(`${path}/${automation.id}`).set(CSRF_HEADERS).expect(403);
  });
});
