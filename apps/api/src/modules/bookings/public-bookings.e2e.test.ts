import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { bookingAvailabilityResponse, publicBookingConfirmationResponse, publicBookingInfoResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import { addDaysToDate, DEFAULT_BOOKING_SETTINGS, localDateOf, weekdayOf, zonedWallTimeToUtc } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { BROWSER_USER_AGENT } from "../../test-support/analytics-pipeline.js";
import { listenForTests } from "../../test-support/http.js";

// F5.2 — reserva desde la página pública: servicios, horarios, alta sin doble reserva, contacto.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@public-bookings-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const TZ = "America/Santiago";
const EMPTY_WEEK = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextMondayLocal(): string {
  let date = addDaysToDate(localDateOf(new Date(), TZ), 7);
  while (weekdayOf(date) !== 1) {
    date = addDaysToDate(date, 1);
  }
  return date;
}

function utcAt(date: string, hour: number, minute: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return zonedWallTimeToUtc({ year, month, day, hour, minute }, TZ)!.toISOString();
}

describe("Reserva pública (e2e) — F5.2", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let httpServer: Parameters<typeof request>[0];
  const monday = nextMondayLocal();

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

  /** Sitio con reservas encendidas: lunes 09:00–12:00, servicio de 45 min con precio y enlace de pago. */
  async function bookableSite(overrides: Partial<typeof DEFAULT_BOOKING_SETTINGS> = {}) {
    const email = `${unique("owner")}${TEST_EMAIL_DOMAIN}`;
    const password = "password1234";
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password }).expect(201);
    const org = await agent.post("/api/v1/organizations").set(CSRF).send({ name: "Barbería", slug: unique("org") }).expect(201);
    const siteSlug = unique("sitio");
    const site = await agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF).send({ name: "Barbería", slug: siteSlug }).expect(201);
    const base = `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/booking`;
    await agent
      .put(`${base}/settings`)
      .set(CSRF)
      .send({ ...DEFAULT_BOOKING_SETTINGS, enabled: true, minNoticeMinutes: 0, weeklyHours: { ...EMPTY_WEEK, mon: [{ start: "09:00", end: "12:00" }] }, ...overrides })
      .expect(200);
    const service = await agent
      .post(`${base}/services`)
      .set(CSRF)
      .send({ name: "Corte y barba", durationMinutes: 45, priceAmount: 18000, priceCurrency: "CLP", paymentUrl: "https://pago.ejemplo.cl/barba" })
      .expect(201);
    const paused = await agent.post(`${base}/services`).set(CSRF).send({ name: "Pausado", durationMinutes: 30, active: false }).expect(201);
    return {
      agent,
      organizationId: org.body.id as string,
      siteId: site.body.id as string,
      siteSlug,
      base,
      serviceId: service.body.id as string,
      pausedServiceId: paused.body.id as string,
      publicBase: `/api/v1/public/sites/${siteSlug}/booking`,
    };
  }

  function bookingBody(serviceId: string, startsAt: string, extra: Record<string, unknown> = {}) {
    return { serviceId, startsAt, name: "Ana Pérez", email: `Ana.${unique("c")}${TEST_EMAIL_DOMAIN}`, phone: "+56912345678", consent: true, ...extra };
  }

  it("ofrece solo servicios activos y nunca el enlace de pago antes de reservar", async () => {
    const { publicBase } = await bookableSite();
    const info = publicBookingInfoResponse.strict().parse((await request(httpServer).get(publicBase).expect(200)).body);
    expect(info.timeZone).toBe(TZ);
    expect(info.services.map((s) => s.name)).toEqual(["Corte y barba"]);
    expect(info.services[0]!.hasPaymentLink).toBe(true);
    expect(JSON.stringify(info)).not.toContain("pago.ejemplo.cl");
  });

  it("un sitio con reservas apagadas, archivado o inexistente responde 404", async () => {
    const { agent, base, publicBase, organizationId, siteId } = await bookableSite();
    await agent.put(`${base}/settings`).set(CSRF).send({ ...DEFAULT_BOOKING_SETTINGS, enabled: false }).expect(200);
    await request(httpServer).get(publicBase).expect(404);
    await agent.put(`${base}/settings`).set(CSRF).send({ ...DEFAULT_BOOKING_SETTINGS, enabled: true }).expect(200);
    await request(httpServer).get(publicBase).expect(200);
    await agent.post(`/api/v1/organizations/${organizationId}/sites/${siteId}/archive`).set(CSRF).expect(201);
    await request(httpServer).get(publicBase).expect(404);
    await request(httpServer).get(`/api/v1/public/sites/${unique("no-existe")}/booking`).expect(404);
  });

  it("reserva: confirma con el enlace de pago, crea el contacto con consentimiento y saca la hora de los libres", async () => {
    const { publicBase, serviceId, organizationId, siteId } = await bookableSite();
    const startsAt = utcAt(monday, 9, 0);
    const body = bookingBody(serviceId, startsAt);

    const created = await request(httpServer).post(publicBase).set(CSRF).set("User-Agent", BROWSER_USER_AGENT).send(body).expect(201);
    const confirmation = publicBookingConfirmationResponse.strict().parse(created.body);
    expect(confirmation).toMatchObject({ serviceName: "Corte y barba", startsAt, endsAt: utcAt(monday, 9, 45), timeZone: TZ, priceAmount: 18000, paymentUrl: "https://pago.ejemplo.cl/barba" });

    const booking = await prisma.booking.findFirstOrThrow({ where: { siteId }, include: { contact: true } });
    expect(booking).toMatchObject({ status: "CONFIRMED", source: "PUBLIC", customerEmail: body.email.toLowerCase(), serviceName: "Corte y barba" });
    expect(booking.contact).toMatchObject({ organizationId, consentStatus: "GRANTED", consentSource: `booking:${siteId}`, email: body.email.toLowerCase() });
    expect(await prisma.contactEvent.count({ where: { contactId: booking.contactId!, type: "BOOKING" } })).toBe(1);

    const availability = bookingAvailabilityResponse.parse(
      (await request(httpServer).get(`${publicBase}/availability?serviceId=${serviceId}&from=${monday}&days=1`).expect(200)).body,
    );
    // 09:00 ocupa hasta 09:45: 09:30 se pisa; desde 10:00 hay lugar.
    expect(availability.days[0]!.slots).toEqual([utcAt(monday, 10, 0), utcAt(monday, 10, 30), utcAt(monday, 11, 0)]);
  });

  it("una hora ocupada, pisada o fuera del horario se rechaza con 409; el margen también cuenta", async () => {
    const { publicBase, serviceId } = await bookableSite({ bufferMinutes: 30 });
    await request(httpServer).post(publicBase).set(CSRF).send(bookingBody(serviceId, utcAt(monday, 9, 0))).expect(201);
    await request(httpServer).post(publicBase).set(CSRF).send(bookingBody(serviceId, utcAt(monday, 9, 0))).expect(409);
    await request(httpServer).post(publicBase).set(CSRF).send(bookingBody(serviceId, utcAt(monday, 9, 30))).expect(409);
    // Termina 09:45; con 30 min de margen, 10:00 queda cerca (libre recién a las 10:15) y 10:30 no.
    await request(httpServer).post(publicBase).set(CSRF).send(bookingBody(serviceId, utcAt(monday, 10, 0))).expect(409);
    await request(httpServer).post(publicBase).set(CSRF).send(bookingBody(serviceId, utcAt(monday, 10, 30))).expect(201);
    // Fuera del horario y desalineada.
    await request(httpServer).post(publicBase).set(CSRF).send(bookingBody(serviceId, utcAt(monday, 15, 0))).expect(409);
    await request(httpServer).post(publicBase).set(CSRF).send(bookingBody(serviceId, utcAt(monday, 11, 10))).expect(409);
  });

  it("carrera: cinco pedidos simultáneos por la misma hora dejan una sola reserva", async () => {
    const { publicBase, serviceId, siteId } = await bookableSite();
    const startsAt = utcAt(monday, 11, 0);
    const responses = await Promise.all(Array.from({ length: 5 }, () => request(httpServer).post(publicBase).set(CSRF).send(bookingBody(serviceId, startsAt))));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await prisma.booking.count({ where: { siteId, status: "CONFIRMED" } })).toBe(1);
  });

  it("valida en el servidor: consentimiento, correo, servicio pausado; la trampa antispam no guarda nada", async () => {
    const { publicBase, serviceId, pausedServiceId, siteId } = await bookableSite();
    const startsAt = utcAt(monday, 10, 0);
    await request(httpServer).post(publicBase).set(CSRF).send(bookingBody(serviceId, startsAt, { consent: false })).expect(400);
    await request(httpServer).post(publicBase).set(CSRF).send(bookingBody(serviceId, startsAt, { email: "no-es-correo" })).expect(400);
    await request(httpServer).post(publicBase).set(CSRF).send(bookingBody(pausedServiceId, startsAt)).expect(404);

    const trap = await request(httpServer).post(publicBase).set(CSRF).send(bookingBody(serviceId, startsAt, { website: "http://spam.example" })).expect(201);
    expect(trap.body.serviceName).toBe("Corte y barba");
    expect(await prisma.booking.count({ where: { siteId } })).toBe(0);
    expect(await prisma.contact.count({ where: { consentSource: `booking:${siteId}` } })).toBe(0);
  });

  it("sin la cabecera anti-CSRF no se reserva", async () => {
    const { publicBase, serviceId, siteId } = await bookableSite();
    await request(httpServer).post(publicBase).send(bookingBody(serviceId, utcAt(monday, 9, 0))).expect(403);
    expect(await prisma.booking.count({ where: { siteId } })).toBe(0);
  });
});
