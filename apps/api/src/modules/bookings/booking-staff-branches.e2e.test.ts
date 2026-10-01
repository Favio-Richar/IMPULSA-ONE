import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  bookingBranchResponse,
  bookingStaffResponse,
  bookingAvailabilityResponse,
  publicBookingConfirmationResponse,
  publicBookingInfoResponse,
} from "@impulza/contracts";
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

// F7.9a — Sucursales, profesionales, asignación de servicios y disponibilidad multi-recurso.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@staff-branches-e2e.test";
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

describe("Sucursales y Profesionales en Reservas (e2e) — F7.9a", () => {
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

    const org = await agent.post("/api/v1/organizations").set(CSRF).send({ name: "Centro de Estética", slug: unique("org") }).expect(201);
    const siteSlug = unique("sitio");
    const site = await agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF).send({ name: "Estética Las Condes", slug: siteSlug }).expect(201);
    const base = `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/booking`;

    // Habilitar reservas de 09:00 a 13:00 los lunes
    await agent
      .put(`${base}/settings`)
      .set(CSRF)
      .send({ ...DEFAULT_BOOKING_SETTINGS, enabled: true, minNoticeMinutes: 0, weeklyHours: { ...EMPTY_WEEK, mon: [{ start: "09:00", end: "13:00" }] } })
      .expect(200);

    const service = await agent
      .post(`${base}/services`)
      .set(CSRF)
      .send({ name: "Masaje Relajación", durationMinutes: 60, priceAmount: 35000, priceCurrency: "CLP" })
      .expect(201);

    return {
      agent,
      organizationId: org.body.id as string,
      siteId: site.body.id as string,
      siteSlug,
      base,
      serviceId: service.body.id as string,
      publicBase: `/api/v1/public/sites/${siteSlug}/booking`,
    };
  }

  function bookingBody(serviceId: string, startsAt: string, extra: Record<string, unknown> = {}) {
    return { serviceId, startsAt, name: "Constanza Silva", email: `consu.${unique("c")}${TEST_EMAIL_DOMAIN}`, phone: "+56912345678", consent: true, ...extra };
  }

  it("CRUD de sucursales: crea, lista, edita y elimina con validaciones", async () => {
    const { agent, base } = await createSiteWithOwner();

    // Crear sucursal
    const created = await agent
      .post(`${base}/branches`)
      .set(CSRF)
      .send({ name: "Sucursal Providencia", address: "Av. Providencia 1234", phone: "+56911223344", active: true })
      .expect(201);
    const branch = bookingBranchResponse.parse(created.body);
    expect(branch.name).toBe("Sucursal Providencia");
    expect(branch.position).toBe(0);

    // Listar
    const list = await agent.get(`${base}/branches`).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(branch.id);

    // Editar
    const updated = await agent
      .patch(`${base}/branches/${branch.id}`)
      .set(CSRF)
      .send({ name: "Sucursal Providencia VIP" })
      .expect(200);
    expect(updated.body.name).toBe("Sucursal Providencia VIP");

    // Eliminar
    await agent.delete(`${base}/branches/${branch.id}`).set(CSRF).expect(204);
    const emptyList = await agent.get(`${base}/branches`).expect(200);
    expect(emptyList.body).toHaveLength(0);
  });

  it("CRUD de profesionales y asignación a servicios", async () => {
    const { agent, base, serviceId } = await createSiteWithOwner();

    // Crear dos profesionales
    const staff1 = await agent
      .post(`${base}/staff`)
      .set(CSRF)
      .send({ name: "Dra. Valentina Gómez", title: "Kinesióloga", email: "val@test.com", active: true })
      .expect(201);
    const parsedStaff1 = bookingStaffResponse.parse(staff1.body);
    expect(parsedStaff1.name).toBe("Dra. Valentina Gómez");

    const staff2 = await agent
      .post(`${base}/staff`)
      .set(CSRF)
      .send({ name: "Matías Rojas", title: "Terapeuta", active: true })
      .expect(201);

    // Listar profesionales
    const staffList = await agent.get(`${base}/staff`).expect(200);
    expect(staffList.body).toHaveLength(2);

    // Asignar ambos profesionales al servicio
    await agent
      .put(`${base}/services/${serviceId}/staff`)
      .set(CSRF)
      .send({ staffIds: [parsedStaff1.id, staff2.body.id] })
      .expect(204);

    const updatedStaffList = await agent.get(`${base}/staff`).expect(200);
    expect(updatedStaffList.body[0].serviceIds).toContain(serviceId);
    expect(updatedStaffList.body[1].serviceIds).toContain(serviceId);
  });

  it("disponibilidad multi-recurso y bloqueos personales por profesional", async () => {
    const { agent, base, serviceId, publicBase } = await createSiteWithOwner();

    // Crear dos profesionales y asignarlos al servicio
    const staff1 = (await agent.post(`${base}/staff`).set(CSRF).send({ name: "Profesional A", active: true }).expect(201)).body;
    const staff2 = (await agent.post(`${base}/staff`).set(CSRF).send({ name: "Profesional B", active: true }).expect(201)).body;
    await agent.put(`${base}/services/${serviceId}/staff`).set(CSRF).send({ staffIds: [staff1.id, staff2.id] }).expect(204);

    // Bloqueo personal para Profesional A de 10:00 a 11:00 (lunes)
    const blackout = await agent
      .post(`${base}/blackouts`)
      .set(CSRF)
      .send({ startsAt: utcAt(monday, 10, 0), endsAt: utcAt(monday, 11, 0), staffId: staff1.id, reason: "Capacitación" })
      .expect(201);
    expect(blackout.body.staffId).toBe(staff1.id);

    // Consulta disponibilidad para Profesional A: a las 10:00 NO debe estar disponible
    const availStaffA = bookingAvailabilityResponse.parse(
      (await agent.get(`${base}/availability?serviceId=${serviceId}&staffId=${staff1.id}&from=${monday}&days=1`).expect(200)).body,
    );
    expect(availStaffA.days[0]!.slots).not.toContain(utcAt(monday, 10, 0));
    expect(availStaffA.days[0]!.slots).toContain(utcAt(monday, 9, 0));

    // Consulta disponibilidad para Profesional B: a las 10:00 SÍ está disponible
    const availStaffB = bookingAvailabilityResponse.parse(
      (await agent.get(`${base}/availability?serviceId=${serviceId}&staffId=${staff2.id}&from=${monday}&days=1`).expect(200)).body,
    );
    expect(availStaffB.days[0]!.slots).toContain(utcAt(monday, 10, 0));

    // Consulta combinada pública (sin staffId especificado): como Profesional B está disponible a las 10:00, el slot 10:00 figura disponible
    const availPublic = bookingAvailabilityResponse.parse(
      (await request(httpServer).get(`${publicBase}/availability?serviceId=${serviceId}&from=${monday}&days=1`).expect(200)).body,
    );
    expect(availPublic.days[0]!.slots).toContain(utcAt(monday, 10, 0));
  });

  it("reserva pública paralela con distintos profesionales a la misma hora y no-solapamiento para el mismo profesional", async () => {
    const { agent, base, serviceId, publicBase, siteId } = await createSiteWithOwner();

    // Crear sucursal y 2 profesionales asignados
    const branch = (await agent.post(`${base}/branches`).set(CSRF).send({ name: "Sucursal Central", active: true }).expect(201)).body;
    const staff1 = (await agent.post(`${base}/staff`).set(CSRF).send({ name: "Dra. Uno", active: true }).expect(201)).body;
    const staff2 = (await agent.post(`${base}/staff`).set(CSRF).send({ name: "Dr. Dos", active: true }).expect(201)).body;
    await agent.put(`${base}/services/${serviceId}/staff`).set(CSRF).send({ staffIds: [staff1.id, staff2.id] }).expect(204);

    const slot10 = utcAt(monday, 10, 0);

    // Cliente 1 reserva a las 10:00 con Dra. Uno en Sucursal Central
    const res1 = await request(httpServer)
      .post(publicBase)
      .set(CSRF)
      .set("User-Agent", BROWSER_USER_AGENT)
      .send(bookingBody(serviceId, slot10, { staffId: staff1.id, branchId: branch.id }))
      .expect(201);
    const parsed1 = publicBookingConfirmationResponse.parse(res1.body);
    expect(parsed1.staffName).toBe("Dra. Uno");
    expect(parsed1.branchName).toBe("Sucursal Central");

    // Cliente 2 reserva a las 10:00 con Dr. Dos (mismo sitio, misma hora exacta, pero distinto profesional) -> debe tener éxito
    const res2 = await request(httpServer)
      .post(publicBase)
      .set(CSRF)
      .set("User-Agent", BROWSER_USER_AGENT)
      .send(bookingBody(serviceId, slot10, { staffId: staff2.id, branchId: branch.id }))
      .expect(201);
    const parsed2 = publicBookingConfirmationResponse.parse(res2.body);
    expect(parsed2.staffName).toBe("Dr. Dos");

    // Cliente 3 intenta reservar a las 10:00 con Dra. Uno -> Debe rechazar con 409 (ocupado)
    await request(httpServer)
      .post(publicBase)
      .set(CSRF)
      .send(bookingBody(serviceId, slot10, { staffId: staff1.id }))
      .expect(409);

    // En base de datos deben existir ambas reservas confirmadas
    const count = await prisma.booking.count({ where: { siteId, status: "CONFIRMED" } });
    expect(count).toBe(2);
  });

  it("no deja borrar a un profesional con reservas vivas (evita choque en bookings_no_overlap); sí con reservas canceladas", async () => {
    const { agent, base, serviceId, publicBase } = await createSiteWithOwner();
    const staff1 = (await agent.post(`${base}/staff`).set(CSRF).send({ name: "Dra. Uno", active: true }).expect(201)).body;
    const staff2 = (await agent.post(`${base}/staff`).set(CSRF).send({ name: "Dr. Dos", active: true }).expect(201)).body;
    await agent.put(`${base}/services/${serviceId}/staff`).set(CSRF).send({ staffIds: [staff1.id, staff2.id] }).expect(204);

    // Dos reservas a la misma hora con profesionales distintos: al borrar a uno, su staff_id pasaría a NULL.
    const slot10 = utcAt(monday, 10, 0);
    for (const staff of [staff1, staff2]) {
      await request(httpServer)
        .post(publicBase)
        .set(CSRF)
        .set("User-Agent", BROWSER_USER_AGENT)
        .send(bookingBody(serviceId, slot10, { staffId: staff.id }))
        .expect(201);
    }

    const blocked = await agent.delete(`${base}/staff/${staff1.id}`).set(CSRF).expect(409);
    expect(blocked.body.message).toMatch(/reservas confirmadas o pendientes/);
    expect(await prisma.bookingStaff.count({ where: { id: staff1.id } })).toBe(1);

    // Con la reserva cancelada ya no ocupa la hora: el borrado procede y la reserva conserva el nombre.
    const own = await prisma.booking.findFirstOrThrow({ where: { staffId: staff1.id } });
    await prisma.booking.update({ where: { id: own.id }, data: { status: "CANCELLED" } });
    await agent.delete(`${base}/staff/${staff1.id}`).set(CSRF).expect(204);
    const kept = await prisma.booking.findUniqueOrThrow({ where: { id: own.id } });
    expect(kept.staffId).toBeNull();
    expect(kept.staffName).toBe("Dra. Uno");
    expect(kept.status).toBe("CANCELLED");
  });

  it("balanceo automático de carga cuando el cliente no elige profesional ('any')", async () => {
    const { agent, base, serviceId, publicBase } = await createSiteWithOwner();

    const staff1 = (await agent.post(`${base}/staff`).set(CSRF).send({ name: "Prof A", active: true }).expect(201)).body;
    const staff2 = (await agent.post(`${base}/staff`).set(CSRF).send({ name: "Prof B", active: true }).expect(201)).body;
    await agent.put(`${base}/services/${serviceId}/staff`).set(CSRF).send({ staffIds: [staff1.id, staff2.id] }).expect(204);

    // Cita 1 a las 09:00 con Prof A explícito
    await request(httpServer)
      .post(publicBase)
      .set(CSRF)
      .send(bookingBody(serviceId, utcAt(monday, 9, 0), { staffId: staff1.id }))
      .expect(201);

    // Cita 2 a las 09:00 con "any" (sin staffId). Como Prof A está ocupado a las 09:00, se debe asignar automáticamente a Prof B
    const bodyAuto = bookingBody(serviceId, utcAt(monday, 9, 0));
    const resAuto = await request(httpServer)
      .post(publicBase)
      .set(CSRF)
      .send(bodyAuto)
      .expect(201);
    const parsedAuto = publicBookingConfirmationResponse.parse(resAuto.body);
    expect(parsedAuto.staffName).toBe("Prof B");

    // Verificar en BD que se guardó el staffId correcto
    const autoBooking = await prisma.booking.findFirstOrThrow({
      where: { customerEmail: bodyAuto.email.toLowerCase(), startsAt: new Date(utcAt(monday, 9, 0)), status: "CONFIRMED" },
    });
    expect(autoBooking.staffId).toBe(staff2.id);

    // Cita 3 a las 11:00 con "any". Ambos están libres a las 11:00, pero Prof A y Prof B tienen 1 cita cada uno.
    // El sistema asigna a uno de ellos sin error.
    const resAny = await request(httpServer)
      .post(publicBase)
      .set(CSRF)
      .send(bookingBody(serviceId, utcAt(monday, 11, 0)))
      .expect(201);
    const parsedAny = publicBookingConfirmationResponse.parse(resAny.body);
    expect(["Prof A", "Prof B"]).toContain(parsedAny.staffName);
  });

  it("información pública (public info) expone sucursales y profesionales asignados", async () => {
    const { agent, base, serviceId, publicBase } = await createSiteWithOwner();

    await agent.post(`${base}/branches`).set(CSRF).send({ name: "Las Condes", active: true }).expect(201);
    const staff = (await agent.post(`${base}/staff`).set(CSRF).send({ name: "Dra. Especialista", active: true }).expect(201)).body;
    await agent.put(`${base}/services/${serviceId}/staff`).set(CSRF).send({ staffIds: [staff.id] }).expect(204);

    const info = publicBookingInfoResponse.parse((await request(httpServer).get(publicBase).expect(200)).body);
    expect(info.branches).toHaveLength(1);
    expect(info.branches[0]!.name).toBe("Las Condes");
    expect(info.staff).toHaveLength(1);
    expect(info.staff[0]!.name).toBe("Dra. Especialista");
    expect(info.services[0]!.staffIds).toContain(staff.id);
  });

  it("horarios semanales personalizados por profesional (weeklyHours) vs herencia del sitio (F7.9b)", async () => {
    const { agent, base, serviceId } = await createSiteWithOwner();

    // 1. Crear profesional inicialmente sin weeklyHours (weeklyHours: null -> hereda horario del sitio)
    const staff = (await agent.post(`${base}/staff`).set(CSRF).send({ name: "Dra. Horario Flexible", active: true }).expect(201)).body;
    expect(staff.weeklyHours).toBeNull();
    await agent.put(`${base}/services/${serviceId}/staff`).set(CSRF).send({ staffIds: [staff.id] }).expect(204);

    // Consulta en lunes (el sitio abre de 09:00 a 13:00): debe tener slot a las 09:00 y a las 11:00, pero no a las 14:00
    const availInherited = bookingAvailabilityResponse.parse(
      (await agent.get(`${base}/availability?serviceId=${serviceId}&staffId=${staff.id}&from=${monday}&days=1`).expect(200)).body,
    );
    expect(availInherited.days[0]!.slots).toContain(utcAt(monday, 9, 0));
    expect(availInherited.days[0]!.slots).toContain(utcAt(monday, 11, 0));
    expect(availInherited.days[0]!.slots).not.toContain(utcAt(monday, 14, 0));

    // 2. Asignar horario personalizado: solo atiende lunes de 14:00 a 16:00
    const customHours = {
      mon: [{ start: "14:00", end: "16:00" }],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [],
      sun: [],
    };
    const updated = await agent
      .patch(`${base}/staff/${staff.id}`)
      .set(CSRF)
      .send({ weeklyHours: customHours })
      .expect(200);
    expect(updated.body.weeklyHours).toEqual(customHours);

    // Consulta en lunes: solo debe tener slots entre 14:00 y 16:00 para servicio de 60 min (14:00, 14:30, 15:00; 15:30 excede las 16:00)
    const availCustom = bookingAvailabilityResponse.parse(
      (await agent.get(`${base}/availability?serviceId=${serviceId}&staffId=${staff.id}&from=${monday}&days=1`).expect(200)).body,
    );
    expect(availCustom.days[0]!.slots).not.toContain(utcAt(monday, 9, 0));
    expect(availCustom.days[0]!.slots).toContain(utcAt(monday, 14, 0));
    expect(availCustom.days[0]!.slots).toContain(utcAt(monday, 14, 30));
    expect(availCustom.days[0]!.slots).toContain(utcAt(monday, 15, 0));
    expect(availCustom.days[0]!.slots).not.toContain(utcAt(monday, 15, 30));
    expect(availCustom.days[0]!.slots).not.toContain(utcAt(monday, 16, 0));

    // 3. Revertir a herencia enviando weeklyHours: null
    const reverted = await agent
      .patch(`${base}/staff/${staff.id}`)
      .set(CSRF)
      .send({ weeklyHours: null })
      .expect(200);
    expect(reverted.body.weeklyHours).toBeNull();

    // Consulta nuevamente: vuelve a tener horario completo heredado del sitio (09:00 a 13:00)
    const availReverted = bookingAvailabilityResponse.parse(
      (await agent.get(`${base}/availability?serviceId=${serviceId}&staffId=${staff.id}&from=${monday}&days=1`).expect(200)).body,
    );
    expect(availReverted.days[0]!.slots).toContain(utcAt(monday, 9, 0));
    expect(availReverted.days[0]!.slots).toContain(utcAt(monday, 11, 0));
    expect(availReverted.days[0]!.slots).not.toContain(utcAt(monday, 14, 0));
  });

  it("bloqueo general de sitio (staffId = null) vs bloqueo personal por profesional (F7.9b)", async () => {
    const { agent, base, serviceId, publicBase } = await createSiteWithOwner();

    const staff1 = (await agent.post(`${base}/staff`).set(CSRF).send({ name: "Dr. Alpha", active: true }).expect(201)).body;
    const staff2 = (await agent.post(`${base}/staff`).set(CSRF).send({ name: "Dra. Beta", active: true }).expect(201)).body;
    await agent.put(`${base}/services/${serviceId}/staff`).set(CSRF).send({ staffIds: [staff1.id, staff2.id] }).expect(204);

    // 1. Bloqueo GENERAL (staffId: null) el lunes de 11:00 a 12:00
    const globalBlackout = (
      await agent
        .post(`${base}/blackouts`)
        .set(CSRF)
        .send({ startsAt: utcAt(monday, 11, 0), endsAt: utcAt(monday, 12, 0), reason: "Fumigación general" })
        .expect(201)
    ).body;
    expect(globalBlackout.staffId).toBeNull();

    // Ni Dr. Alpha ni Dra. Beta ni la página pública tienen disponible las 11:00
    const alphaAvail = bookingAvailabilityResponse.parse(
      (await agent.get(`${base}/availability?serviceId=${serviceId}&staffId=${staff1.id}&from=${monday}&days=1`).expect(200)).body,
    );
    expect(alphaAvail.days[0]!.slots).not.toContain(utcAt(monday, 11, 0));

    const betaAvail = bookingAvailabilityResponse.parse(
      (await agent.get(`${base}/availability?serviceId=${serviceId}&staffId=${staff2.id}&from=${monday}&days=1`).expect(200)).body,
    );
    expect(betaAvail.days[0]!.slots).not.toContain(utcAt(monday, 11, 0));

    const publicAvail = bookingAvailabilityResponse.parse(
      (await request(httpServer).get(`${publicBase}/availability?serviceId=${serviceId}&from=${monday}&days=1`).expect(200)).body,
    );
    expect(publicAvail.days[0]!.slots).not.toContain(utcAt(monday, 11, 0));

    // 2. Eliminar el bloqueo general
    await agent.delete(`${base}/blackouts/${globalBlackout.id}`).set(CSRF).expect(204);

    // 3. Crear bloqueo PERSONAL solo para Dr. Alpha el lunes de 11:00 a 12:00
    const personalBlackout = (
      await agent
        .post(`${base}/blackouts`)
        .set(CSRF)
        .send({ startsAt: utcAt(monday, 11, 0), endsAt: utcAt(monday, 12, 0), staffId: staff1.id, reason: "Dentista" })
        .expect(201)
    ).body;
    expect(personalBlackout.staffId).toBe(staff1.id);

    // Dr. Alpha no tiene libre a las 11:00, pero Dra. Beta sí, y la consulta pública combinada también
    const alphaAvail2 = bookingAvailabilityResponse.parse(
      (await agent.get(`${base}/availability?serviceId=${serviceId}&staffId=${staff1.id}&from=${monday}&days=1`).expect(200)).body,
    );
    expect(alphaAvail2.days[0]!.slots).not.toContain(utcAt(monday, 11, 0));

    const betaAvail2 = bookingAvailabilityResponse.parse(
      (await agent.get(`${base}/availability?serviceId=${serviceId}&staffId=${staff2.id}&from=${monday}&days=1`).expect(200)).body,
    );
    expect(betaAvail2.days[0]!.slots).toContain(utcAt(monday, 11, 0));

    const publicAvail2 = bookingAvailabilityResponse.parse(
      (await request(httpServer).get(`${publicBase}/availability?serviceId=${serviceId}&from=${monday}&days=1`).expect(200)).body,
    );
    expect(publicAvail2.days[0]!.slots).toContain(utcAt(monday, 11, 0));
  });
});
