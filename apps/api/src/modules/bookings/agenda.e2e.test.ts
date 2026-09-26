import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { bookingResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import { DEFAULT_BOOKING_SETTINGS } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";

// F5.3 — agenda del negocio: ver por rango, anotar a mano, cambiar el estado, permisos.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@agenda-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Agenda del negocio (e2e) — F5.3", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EMAIL_ADAPTER).useValue(emailAdapter).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    httpServer = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } } });
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

  async function loggedIn(): Promise<{ email: string; agent: ReturnType<typeof request.agent> }> {
    const email = `${unique("u")}${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    return { email, agent };
  }

  async function setup() {
    const owner = await loggedIn();
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Agenda", slug: unique("org") }).expect(201);
    await assignRoomyPlan(prisma, org.body.id);
    const site = await owner.agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF).send({ name: "Estudio", slug: unique("sitio") }).expect(201);
    const siteBase = `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/booking`;
    await owner.agent.put(`${siteBase}/settings`).set(CSRF).send({ ...DEFAULT_BOOKING_SETTINGS, enabled: true }).expect(200);
    const service = await owner.agent.post(`${siteBase}/services`).set(CSRF).send({ name: "Masaje", durationMinutes: 60, priceAmount: 25000, priceCurrency: "CLP" }).expect(201);

    // Un ANALYST: ve la agenda, no la cambia.
    const analyst = await loggedIn();
    const invite = await owner.agent.post(`/api/v1/organizations/${org.body.id}/members`).set(CSRF).send({ email: analyst.email, role: "ANALYST" }).expect(201);
    await analyst.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);

    return {
      owner: owner.agent,
      analyst: analyst.agent,
      organizationId: org.body.id as string,
      siteId: site.body.id as string,
      serviceId: service.body.id as string,
      agenda: `/api/v1/organizations/${org.body.id}/bookings`,
    };
  }

  it("anota una reserva a mano (también fuera del horario publicado) y la agenda la lista por rango", async () => {
    const { owner, agenda, siteId, serviceId, organizationId } = await setup();
    // Domingo por la noche: fuera del horario por defecto, lo decide el negocio.
    const created = bookingResponse.parse(
      (
        await owner
          .post(agenda)
          .set(CSRF)
          .send({ siteId, serviceId, startsAt: "2030-01-06T23:00:00Z", name: "Cliente Teléfono", email: "Cliente.Tel@example.com", phone: "+56911112222" })
          .expect(201)
      ).body,
    );
    expect(created).toMatchObject({ source: "MANUAL", status: "CONFIRMED", serviceName: "Masaje", customerEmail: "cliente.tel@example.com", endsAt: "2030-01-07T00:00:00.000Z", contactId: null });

    const inRange = await owner.get(`${agenda}?from=2030-01-06T00:00:00Z&to=2030-01-08T00:00:00Z`).expect(200);
    expect(inRange.body.map((b: { id: string }) => b.id)).toEqual([created.id]);
    const outOfRange = await owner.get(`${agenda}?from=2030-02-01T00:00:00Z&to=2030-02-02T00:00:00Z`).expect(200);
    expect(outOfRange.body).toEqual([]);
    // Sin consentimiento del cliente no se crea un contacto.
    expect(await prisma.contact.count({ where: { organizationId, email: "cliente.tel@example.com" } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId, action: "booking.created_manually" } })).toBe(1);
  });

  it("no se anota encima de otra reserva confirmada; una cancelada no molesta y reactivarla se rechaza si su hora se ocupó", async () => {
    const { owner, agenda, siteId, serviceId } = await setup();
    const body = (startsAt: string) => ({ siteId, serviceId, startsAt, name: "Ana", email: "ana@example.com" });
    const first = (await owner.post(agenda).set(CSRF).send(body("2030-01-07T13:00:00Z")).expect(201)).body;
    await owner.post(agenda).set(CSRF).send(body("2030-01-07T13:30:00Z")).expect(409);

    const cancelled = bookingResponse.parse((await owner.patch(`${agenda}/${first.id}`).set(CSRF).send({ status: "CANCELLED" }).expect(200)).body);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).not.toBeNull();
    const second = (await owner.post(agenda).set(CSRF).send(body("2030-01-07T13:30:00Z")).expect(201)).body;
    await owner.patch(`${agenda}/${first.id}`).set(CSRF).send({ status: "CONFIRMED" }).expect(409);

    const done = bookingResponse.parse((await owner.patch(`${agenda}/${second.id}`).set(CSRF).send({ status: "COMPLETED" }).expect(200)).body);
    expect(done.status).toBe("COMPLETED");
    const confirmedOnly = await owner.get(`${agenda}?from=2030-01-07T00:00:00Z&to=2030-01-08T00:00:00Z&status=CONFIRMED`).expect(200);
    expect(confirmedOnly.body).toEqual([]);
  });

  it("un ANALYST ve la agenda pero no la cambia; los parámetros se validan", async () => {
    const { owner, analyst, agenda, siteId, serviceId } = await setup();
    const booking = (await owner.post(agenda).set(CSRF).send({ siteId, serviceId, startsAt: "2030-01-08T13:00:00Z", name: "Ana", email: "ana@example.com" }).expect(201)).body;

    await analyst.get(`${agenda}?from=2030-01-08T00:00:00Z&to=2030-01-09T00:00:00Z`).expect(200);
    await analyst.get(`${agenda}/${booking.id}`).expect(200);
    await analyst.patch(`${agenda}/${booking.id}`).set(CSRF).send({ status: "CANCELLED" }).expect(403);
    await analyst.post(agenda).set(CSRF).send({ siteId, serviceId, startsAt: "2030-01-08T15:00:00Z", name: "B", email: "b@example.com" }).expect(403);

    await owner.get(`${agenda}?from=2030-01-01T00:00:00Z&to=2030-05-01T00:00:00Z`).expect(400);
    await owner.get(`${agenda}?from=2030-01-02T00:00:00Z&to=2030-01-01T00:00:00Z`).expect(400);
    await owner.patch(`${agenda}/${booking.id}`).set(CSRF).send({ status: "PERDIDA" }).expect(400);
  });

  it("anotar enlaza la reserva a un contacto que ya existe con ese correo", async () => {
    const { owner, agenda, siteId, serviceId, organizationId } = await setup();
    const contact = await owner.post(`/api/v1/organizations/${organizationId}/contacts`).set(CSRF).send({ name: "Ana", email: "ana.existente@example.com" }).expect(201);
    const booking = bookingResponse.parse(
      (await owner.post(agenda).set(CSRF).send({ siteId, serviceId, startsAt: "2030-01-09T13:00:00Z", name: "Ana", email: "ANA.existente@example.com" }).expect(201)).body,
    );
    expect(booking.contactId).toBe(contact.body.id);
    expect(await prisma.contactEvent.count({ where: { contactId: contact.body.id, type: "BOOKING" } })).toBe(1);
  });
});
