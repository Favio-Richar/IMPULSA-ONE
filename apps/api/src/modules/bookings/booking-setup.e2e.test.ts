import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { bookableServiceResponse, bookingAvailabilityResponse, bookingBlackoutResponse, bookingSettingsResponse } from "@impulza/contracts";
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

// F5.1 — configuración de reservas: horario, servicios, bloqueos y horarios libres.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@booking-setup-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const TZ = "America/Santiago";
const EMPTY_WEEK = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** El lunes local que viene en al menos 7 días (lejos de la anticipación mínima y dentro del horizonte). */
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

describe("Configuración de reservas (e2e) — F5.1", () => {
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

  async function createSiteWithOwner() {
    const email = `${unique("user")}${TEST_EMAIL_DOMAIN}`;
    const password = "password1234";
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org Reservas", slug: unique("org") }).expect(201);
    const site = await agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF_HEADERS).send({ name: "Barbería", slug: unique("sitio") }).expect(201);
    return { agent, organizationId: org.body.id as string, base: `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/booking` };
  }

  it("sin configuración guardada devuelve los valores por defecto; al guardar, queda configurada y auditada", async () => {
    const { agent, base, organizationId } = await createSiteWithOwner();
    const initial = bookingSettingsResponse.parse((await agent.get(`${base}/settings`).expect(200)).body);
    expect(initial.configured).toBe(false);
    expect(initial.enabled).toBe(false);
    expect(initial.timeZone).toBe(TZ);

    const saved = bookingSettingsResponse.parse(
      (
        await agent
          .put(`${base}/settings`)
          .set(CSRF_HEADERS)
          .send({ ...DEFAULT_BOOKING_SETTINGS, enabled: true, weeklyHours: { ...EMPTY_WEEK, mon: [{ start: "15:00", end: "19:00" }, { start: "09:00", end: "13:00" }] } })
          .expect(200)
      ).body,
    );
    expect(saved.configured).toBe(true);
    expect(saved.enabled).toBe(true);
    // El servidor guarda los tramos ordenados.
    expect(saved.weeklyHours.mon.map((w) => w.start)).toEqual(["09:00", "15:00"]);
    expect(await prisma.auditLog.count({ where: { organizationId, action: "booking.settings_updated" } })).toBe(1);
  });

  it("valida en el servidor: zona horaria, tramos solapados e intervalos fuera de catálogo", async () => {
    const { agent, base } = await createSiteWithOwner();
    await agent.put(`${base}/settings`).set(CSRF_HEADERS).send({ ...DEFAULT_BOOKING_SETTINGS, timeZone: "Luna/Base" }).expect(400);
    await agent
      .put(`${base}/settings`)
      .set(CSRF_HEADERS)
      .send({ ...DEFAULT_BOOKING_SETTINGS, weeklyHours: { ...EMPTY_WEEK, mon: [{ start: "09:00", end: "13:00" }, { start: "12:00", end: "14:00" }] } })
      .expect(400);
    await agent.put(`${base}/settings`).set(CSRF_HEADERS).send({ ...DEFAULT_BOOKING_SETTINGS, slotIntervalMinutes: 7 }).expect(400);
  });

  it("servicios: crea en orden, edita con las mismas reglas que el alta y borra", async () => {
    const { agent, base } = await createSiteWithOwner();
    const corte = bookableServiceResponse.parse(
      (await agent.post(`${base}/services`).set(CSRF_HEADERS).send({ name: "Corte", durationMinutes: 30, priceAmount: 12000, priceCurrency: "clp", paymentUrl: "https://pago.ejemplo.cl/corte" }).expect(201)).body,
    );
    expect(corte.priceCurrency).toBe("CLP");
    const barba = (await agent.post(`${base}/services`).set(CSRF_HEADERS).send({ name: "Barba", durationMinutes: 20 }).expect(201)).body;
    expect(barba.position).toBe(1);

    await agent.post(`${base}/services`).set(CSRF_HEADERS).send({ name: "Sin moneda", durationMinutes: 30, priceAmount: 1000 }).expect(400);
    await agent.post(`${base}/services`).set(CSRF_HEADERS).send({ name: "Pago inseguro", durationMinutes: 30, paymentUrl: "javascript:alert(1)" }).expect(400);

    // Quitar solo la moneda deja un precio incompleto: el resultado se valida entero.
    await agent.patch(`${base}/services/${corte.id}`).set(CSRF_HEADERS).send({ priceCurrency: null }).expect(422);
    const edited = bookableServiceResponse.parse(
      (await agent.patch(`${base}/services/${corte.id}`).set(CSRF_HEADERS).send({ priceAmount: null, priceCurrency: null, durationMinutes: 45 }).expect(200)).body,
    );
    expect(edited.priceAmount).toBeNull();
    expect(edited.durationMinutes).toBe(45);

    const listed = await agent.get(`${base}/services`).expect(200);
    expect(listed.body.map((s: { name: string }) => s.name)).toEqual(["Corte", "Barba"]);
    await agent.delete(`${base}/services/${barba.id}`).set(CSRF_HEADERS).expect(204);
    await agent.delete(`${base}/services/${barba.id}`).set(CSRF_HEADERS).expect(404);
  });

  it("horarios libres: en la hora local del negocio y sin superponerse a un bloqueo", async () => {
    const { agent, base } = await createSiteWithOwner();
    await agent
      .put(`${base}/settings`)
      .set(CSRF_HEADERS)
      .send({ ...DEFAULT_BOOKING_SETTINGS, enabled: true, minNoticeMinutes: 0, weeklyHours: { ...EMPTY_WEEK, mon: [{ start: "09:00", end: "12:00" }] } })
      .expect(200);
    const service = (await agent.post(`${base}/services`).set(CSRF_HEADERS).send({ name: "Sesión", durationMinutes: 45 }).expect(201)).body;
    const monday = nextMondayLocal();
    const query = `${base}/availability?serviceId=${service.id}&from=${monday}&days=1`;

    const free = bookingAvailabilityResponse.parse((await agent.get(query).expect(200)).body);
    expect(free.timeZone).toBe(TZ);
    expect(free.days[0]!.slots).toEqual([utcAt(monday, 9, 0), utcAt(monday, 9, 30), utcAt(monday, 10, 0), utcAt(monday, 10, 30), utcAt(monday, 11, 0)]);

    // Bloqueo de 09:30 a 10:15: fuera todo lo que lo toque.
    const blackout = bookingBlackoutResponse.parse(
      (await agent.post(`${base}/blackouts`).set(CSRF_HEADERS).send({ startsAt: utcAt(monday, 9, 30), endsAt: utcAt(monday, 10, 15), reason: "Trámite" }).expect(201)).body,
    );
    const blocked = bookingAvailabilityResponse.parse((await agent.get(query).expect(200)).body);
    expect(blocked.days[0]!.slots).toEqual([utcAt(monday, 10, 30), utcAt(monday, 11, 0)]);

    const blackouts = await agent.get(`${base}/blackouts`).expect(200);
    expect(blackouts.body.map((b: { id: string }) => b.id)).toContain(blackout.id);
    await agent.delete(`${base}/blackouts/${blackout.id}`).set(CSRF_HEADERS).expect(204);
    expect(bookingAvailabilityResponse.parse((await agent.get(query).expect(200)).body).days[0]!.slots).toHaveLength(5);

    // Parámetros inválidos.
    await agent.get(`${base}/availability?serviceId=${service.id}&from=2026-13-40`).expect(400);
    await agent.get(`${base}/availability?serviceId=${service.id}&from=${monday}&days=90`).expect(400);
  });

  it("sin la cabecera anti-CSRF no guarda nada; sin sesión, 401", async () => {
    const { agent, base } = await createSiteWithOwner();
    await agent.post(`${base}/services`).send({ name: "Corte", durationMinutes: 30 }).expect(403);
    await request(httpServer).get(`${base}/services`).expect(401);
  });
});
