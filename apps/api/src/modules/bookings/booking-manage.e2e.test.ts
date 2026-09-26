import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { publicManagedBookingResponse } from "@impulza/contracts";
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

// F5.4 — correos de reserva y "gestiona tu reserva" con el enlace firmado del correo.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@booking-manage-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const TZ = "America/Santiago";
const EMPTY_WEEK = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextMondayLocal(): string {
  let date = addDaysToDate(localDateOf(new Date(), TZ), 7);
  while (weekdayOf(date) !== 1) date = addDaysToDate(date, 1);
  return date;
}

function utcAt(date: string, hour: number, minute: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return zonedWallTimeToUtc({ year, month, day, hour, minute }, TZ)!.toISOString();
}

describe("Gestión de la reserva por el cliente (e2e) — F5.4", () => {
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
    if (keys.length > 0) await redis.del(...keys);
  });

  /** Sitio con reservas (lunes 09–12, sin anticipación) y una reserva hecha por un cliente a las 09:00. */
  async function booked() {
    const ownerEmail = `${unique("owner")}${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email: ownerEmail, password: "password1234" }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email: ownerEmail, password: "password1234" }).expect(201);
    const org = await agent.post("/api/v1/organizations").set(CSRF).send({ name: "Estudio", slug: unique("org") }).expect(201);
    const siteSlug = unique("sitio");
    const site = await agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF).send({ name: "Estudio Luz", slug: siteSlug }).expect(201);
    const base = `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/booking`;
    const settings = { ...DEFAULT_BOOKING_SETTINGS, enabled: true, minNoticeMinutes: 0, weeklyHours: { ...EMPTY_WEEK, mon: [{ start: "09:00", end: "12:00" }] } };
    await agent.put(`${base}/settings`).set(CSRF).send(settings).expect(200);
    const service = await agent.post(`${base}/services`).set(CSRF).send({ name: "Sesión", durationMinutes: 60, paymentUrl: "https://pago.ejemplo.cl/s" }).expect(201);

    emailAdapter.messages = [];
    const customerEmail = `cliente-${unique("c")}@example.com`;
    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/booking`)
      .set(CSRF)
      .send({ serviceId: service.body.id, startsAt: utcAt(monday, 9, 0), name: "Clara", email: customerEmail, consent: true })
      .expect(201);
    const confirmation = emailAdapter.messages.find((message) => message.to === customerEmail);
    const link = /\/reserva\/([A-Za-z0-9._-]+)/.exec(confirmation?.text ?? "")?.[1];
    return { agent, base, settings, ownerEmail, customerEmail, confirmation, link: link!, siteSlug, serviceId: service.body.id as string, manage: `/api/v1/public/bookings/${link}` };
  }

  it("el cliente recibe la confirmación con su enlace y el pago; el dueño recibe el aviso", async () => {
    const { confirmation, ownerEmail, link } = await booked();
    expect(confirmation?.subject).toBe("Reserva confirmada en Estudio Luz");
    expect(confirmation?.text).toContain("https://pago.ejemplo.cl/s");
    expect(link).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    const notice = emailAdapter.messages.find((message) => message.to === ownerEmail);
    expect(notice?.subject).toMatch(/^Nueva reserva: Clara, /);
    expect(notice?.text).toContain("/reservas");
  });

  it("con su enlace ve la reserva; un enlace alterado, de otra reserva o basura da el mismo 404", async () => {
    const { manage, link, siteSlug, serviceId } = await booked();
    const view = publicManagedBookingResponse.strict().parse((await request(httpServer).get(manage).set(CSRF).expect(200)).body);
    expect(view).toMatchObject({ siteSlug, siteName: "Estudio Luz", serviceName: "Sesión", serviceId, status: "CONFIRMED", canChange: true, paymentUrl: "https://pago.ejemplo.cl/s" });

    const [id, signature] = link.split(".") as [string, string];
    const tampered = `${id}.${signature.slice(0, -2)}${signature.endsWith("AA") ? "BB" : "AA"}`;
    await request(httpServer).get(`/api/v1/public/bookings/${tampered}`).set(CSRF).expect(404);
    await request(httpServer).get(`/api/v1/public/bookings/11111111-1111-4111-8111-111111111111.${signature}`).set(CSRF).expect(404);
    await request(httpServer).get("/api/v1/public/bookings/cualquier-cosa").set(CSRF).expect(404);
  });

  it("cambia la hora a una libre (su propia hora no la bloquea) y no a una ocupada", async () => {
    const { manage, siteSlug, serviceId, customerEmail, ownerEmail } = await booked();
    // Otro cliente a las 11:00.
    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/booking`)
      .set(CSRF)
      .send({ serviceId, startsAt: utcAt(monday, 11, 0), name: "Otro", email: `otro-${unique("o")}@example.com`, consent: true })
      .expect(201);
    emailAdapter.messages = [];

    await request(httpServer).post(`${manage}/reschedule`).set(CSRF).send({ startsAt: utcAt(monday, 11, 0) }).expect(409);
    // 09:30 se pisa con su propia reserva de 09:00–10:00: excluida, se puede.
    const moved = publicManagedBookingResponse.parse((await request(httpServer).post(`${manage}/reschedule`).set(CSRF).send({ startsAt: utcAt(monday, 9, 30) }).expect(200)).body);
    expect(moved.startsAt).toBe(utcAt(monday, 9, 30));
    expect(emailAdapter.messages.find((m) => m.to === customerEmail)?.subject).toBe("Cambiaste la hora de tu reserva en Estudio Luz");
    expect(emailAdapter.messages.find((m) => m.to === ownerEmail)?.subject).toMatch(/^Un cliente cambió la hora/);
    const row = await prisma.booking.findFirstOrThrow({ where: { customerEmail } });
    expect(row.reminderSentAt).toBeNull();
  });

  it("cancela (una vez), avisa, y después ya no se puede cambiar", async () => {
    const { manage, customerEmail, ownerEmail } = await booked();
    const cancelled = publicManagedBookingResponse.parse((await request(httpServer).post(`${manage}/cancel`).set(CSRF).expect(200)).body);
    expect(cancelled).toMatchObject({ status: "CANCELLED", canChange: false, paymentUrl: null });
    expect(emailAdapter.messages.find((m) => m.to === customerEmail && m.subject.startsWith("Reserva cancelada"))).toBeTruthy();
    expect(emailAdapter.messages.find((m) => m.to === ownerEmail && m.subject.startsWith("Reserva cancelada por el cliente"))).toBeTruthy();

    const mails = emailAdapter.messages.length;
    await request(httpServer).post(`${manage}/cancel`).set(CSRF).expect(200);
    expect(emailAdapter.messages.length).toBe(mails);
    await request(httpServer).post(`${manage}/reschedule`).set(CSRF).send({ startsAt: utcAt(monday, 10, 0) }).expect(409);
    const row = await prisma.booking.findFirstOrThrow({ where: { customerEmail } });
    expect(row.status).toBe("CANCELLED");
  });

  it("fuera de la anticipación mínima del negocio, ni cancelar ni cambiar", async () => {
    const { agent, base, settings, manage } = await booked();
    // Con 14 días de anticipación mínima, el plazo de una cita a 1–2 semanas ya pasó.
    await agent.put(`${base}/settings`).set(CSRF).send({ ...settings, minNoticeMinutes: 14 * 24 * 60 }).expect(200);
    const view = publicManagedBookingResponse.parse((await request(httpServer).get(manage).set(CSRF).expect(200)).body);
    expect(view.canChange).toBe(false);
    await request(httpServer).post(`${manage}/cancel`).set(CSRF).expect(409);
    await request(httpServer).post(`${manage}/reschedule`).set(CSRF).send({ startsAt: utcAt(monday, 10, 0) }).expect(409);
  });
});
