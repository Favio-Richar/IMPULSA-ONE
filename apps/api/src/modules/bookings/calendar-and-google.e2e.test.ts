import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
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
import { listenForTests } from "../../test-support/http.js";

// F7.9c — Feed iCal (.ics, RFC 5545) y Adaptador de Google Calendar desacoplado.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@calendar-google-e2e.test";
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

describe("Feed iCal y Google Calendar desacoplado (e2e) — F7.9c", () => {
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

  async function createSiteWithOwner() {
    const email = `${unique("owner")}${TEST_EMAIL_DOMAIN}`;
    const password = "password1234";
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password }).expect(201);

    const org = await agent.post("/api/v1/organizations").set(CSRF).send({ name: "Centro Holístico", slug: unique("org") }).expect(201);
    const siteSlug = unique("sitio");
    const site = await agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF).send({ name: "Centro Providencia", slug: siteSlug }).expect(201);
    const base = `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/booking`;

    // Habilitar reservas de 09:00 a 18:00 los lunes
    const settingsRes = await agent
      .put(`${base}/settings`)
      .set(CSRF)
      .send({ ...DEFAULT_BOOKING_SETTINGS, enabled: true, minNoticeMinutes: 0, weeklyHours: { ...EMPTY_WEEK, mon: [{ start: "09:00", end: "18:00" }] } })
      .expect(200);

    const service = await agent
      .post(`${base}/services`)
      .set(CSRF)
      .send({ name: "Acupuntura", durationMinutes: 60, priceAmount: 40000, priceCurrency: "CLP" })
      .expect(201);

    const staff = await agent
      .post(`${base}/staff`)
      .set(CSRF)
      .send({ name: "Dra. Valentina Paz", title: "Terapeuta", serviceIds: [service.body.id] })
      .expect(201);

    return {
      agent,
      organizationId: org.body.id as string,
      siteId: site.body.id as string,
      siteSlug,
      base,
      serviceId: service.body.id as string,
      staffId: staff.body.id as string,
      siteCalendarFeedToken: settingsRes.body.calendarFeedToken as string,
      staffCalendarFeedToken: staff.body.calendarFeedToken as string,
      publicBase: `/api/v1/public/sites/${siteSlug}/booking`,
    };
  }

  describe("Feed iCal (.ics, RFC 5545)", () => {
    it("devuelve 404 si el token no existe", async () => {
      await request(httpServer).get("/api/v1/public/bookings/calendar-feed/token-inexistente-123.ics").expect(404);
    });

    it("sirve el feed del sitio en formato iCalendar RFC 5545 con cabeceras correctas", async () => {
      const site = await createSiteWithOwner();

      // Crear una reserva confirmada
      await request(httpServer)
        .post(site.publicBase)
        .set(CSRF)
        .send({
          serviceId: site.serviceId,
          staffId: site.staffId,
          startsAt: utcAt(monday, 10, 0),
          name: "Cliente Feed",
          email: `cliente.${unique("c")}${TEST_EMAIL_DOMAIN}`,
          phone: "+56911223344",
          consent: true,
        })
        .expect(201);

      const res = await request(httpServer)
        .get(`/api/v1/public/bookings/calendar-feed/${site.siteCalendarFeedToken}.ics`)
        .expect(200);

      expect(res.headers["content-type"]).toContain("text/calendar");
      expect(res.headers["content-disposition"]).toContain('filename="reservas.ics"');

      const ics = res.text;
      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain("VERSION:2.0");
      expect(ics).toContain("PRODID:-//Impulza One//Reservas Feed//ES");
      expect(ics).toContain("BEGIN:VEVENT");
      expect(ics).toContain("SUMMARY:Acupuntura - Cliente Feed");
      expect(ics).toContain("STATUS:CONFIRMED");
      expect(ics).toContain("END:VEVENT");
      expect(ics).toContain("END:VCALENDAR");
    });

    it("sirve el feed personal del profesional filtrando solo sus reservas", async () => {
      const site = await createSiteWithOwner();

      // Crear segundo profesional
      const staff2Res = await site.agent
        .post(`${site.base}/staff`)
        .set(CSRF)
        .send({ name: "Dr. Rodrigo Fuentes", serviceIds: [site.serviceId] })
        .expect(201);
      const staff2Id = staff2Res.body.id as string;
      const staff2Token = staff2Res.body.calendarFeedToken as string;

      // Reserva para Dra. Valentina Paz
      await request(httpServer)
        .post(site.publicBase)
        .set(CSRF)
        .send({
          serviceId: site.serviceId,
          staffId: site.staffId,
          startsAt: utcAt(monday, 11, 0),
          name: "Paciente Valentina",
          email: `pv.${unique("c")}${TEST_EMAIL_DOMAIN}`,
          phone: "+56911223344",
          consent: true,
        })
        .expect(201);

      // Reserva para Dr. Rodrigo Fuentes
      await request(httpServer)
        .post(site.publicBase)
        .set(CSRF)
        .send({
          serviceId: site.serviceId,
          staffId: staff2Id,
          startsAt: utcAt(monday, 12, 0),
          name: "Paciente Rodrigo",
          email: `pr.${unique("c")}${TEST_EMAIL_DOMAIN}`,
          phone: "+56911223344",
          consent: true,
        })
        .expect(201);

      // El feed de Valentina solo debe contener su reserva
      const resVal = await request(httpServer)
        .get(`/api/v1/public/bookings/calendar-feed/${site.staffCalendarFeedToken}.ics`)
        .expect(200);
      expect(resVal.text).toContain("Paciente Valentina");
      expect(resVal.text).not.toContain("Paciente Rodrigo");

      // El feed de Rodrigo solo debe contener su reserva
      const resRod = await request(httpServer)
        .get(`/api/v1/public/bookings/calendar-feed/${staff2Token}.ics`)
        .expect(200);
      expect(resRod.text).toContain("Paciente Rodrigo");
      expect(resRod.text).not.toContain("Paciente Valentina");

      // El feed del sitio debe contener ambas reservas
      const resSite = await request(httpServer)
        .get(`/api/v1/public/bookings/calendar-feed/${site.siteCalendarFeedToken}.ics`)
        .expect(200);
      expect(resSite.text).toContain("Paciente Valentina");
      expect(resSite.text).toContain("Paciente Rodrigo");
    });

    it("permite rotar el token de feed del sitio invalidando el antiguo", async () => {
      const site = await createSiteWithOwner();

      const rotateRes = await site.agent
        .post(`${site.base}/settings/rotate-calendar-feed`)
        .set(CSRF)
        .expect(200);

      const nuevoToken = rotateRes.body.calendarFeedToken as string;
      expect(nuevoToken).toBeDefined();
      expect(nuevoToken).not.toBe(site.siteCalendarFeedToken);

      // El token viejo debe dar 404
      await request(httpServer)
        .get(`/api/v1/public/bookings/calendar-feed/${site.siteCalendarFeedToken}.ics`)
        .expect(404);

      // El nuevo token debe responder 200 con el feed
      await request(httpServer)
        .get(`/api/v1/public/bookings/calendar-feed/${nuevoToken}.ics`)
        .expect(200);
    });

    it("permite rotar el token de feed de un profesional invalidando el antiguo", async () => {
      const site = await createSiteWithOwner();

      const rotateRes = await site.agent
        .post(`${site.base}/staff/${site.staffId}/rotate-calendar-feed`)
        .set(CSRF)
        .expect(200);

      const nuevoToken = rotateRes.body.calendarFeedToken as string;
      expect(nuevoToken).toBeDefined();
      expect(nuevoToken).not.toBe(site.staffCalendarFeedToken);

      // El token viejo del profesional da 404
      await request(httpServer)
        .get(`/api/v1/public/bookings/calendar-feed/${site.staffCalendarFeedToken}.ics`)
        .expect(404);

      // El nuevo token responde 200
      await request(httpServer)
        .get(`/api/v1/public/bookings/calendar-feed/${nuevoToken}.ics`)
        .expect(200);
    });
  });

  describe("Google Calendar desacoplado", () => {
    it("devuelve configured: false sin fallar si faltan credenciales en el entorno", async () => {
      const site = await createSiteWithOwner();

      const res = await site.agent
        .get(`${site.base}/google-calendar`)
        .set(CSRF)
        .expect(200);

      expect(res.body).toEqual({
        configured: false,
        connection: null,
        staffConnections: [],
      });
    });

    it("responde 422 al solicitar auth-url si el servicio no está configurado", async () => {
      const site = await createSiteWithOwner();

      const res = await site.agent
        .get(`${site.base}/google-calendar/auth-url?redirectUri=https://app.impulza.test/oauth/callback`)
        .set(CSRF)
        .expect(422);

      expect(res.body.message).toContain("Google Calendar no está configurado");
    });

    it("responde 404 al intentar desconectar una conexión inexistente", async () => {
      const site = await createSiteWithOwner();

      await site.agent
        .delete(`${site.base}/google-calendar`)
        .set(CSRF)
        .expect(404);
    });
  });
});
