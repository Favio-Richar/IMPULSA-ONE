import { createHmac, randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { encryptSecret, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { bookingResponse, publicBookingConfirmationResponse, publicBookingInfoResponse, publicManagedBookingResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { FakeMercadoPagoCheckout } from "@impulza/payments";
import { addDaysToDate, DEFAULT_BOOKING_SETTINGS, localDateOf, weekdayOf, zonedWallTimeToUtc } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { MERCADO_PAGO_CHECKOUT } from "../payment-accounts/checkout.tokens.js";

// F5.10 (ADR-013) — seña de reservas cobrada con la cuenta de Mercado Pago del negocio.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@booking-deposit-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const TZ = "America/Santiago";
const EMPTY_WEEK = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
const WEBHOOK_SECRET = "clave-de-firma-de-la-app-de-pruebas-0000";

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

function sign(dataId: string, requestId: string, secret = WEBHOOK_SECRET): string {
  const ts = String(Date.now());
  return `ts=${ts},v1=${createHmac("sha256", secret).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex")}`;
}

describe("Seña de reservas con Mercado Pago (e2e) — F5.10, ADR-013", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let checkout: FakeMercadoPagoCheckout;
  let httpServer: Parameters<typeof request>[0];
  const monday = nextMondayLocal();

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    checkout = new FakeMercadoPagoCheckout();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(MERCADO_PAGO_CHECKOUT)
      .useValue({ checkout, webhookSecret: WEBHOOK_SECRET })
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
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  /** Sitio con reservas los lunes 09:00–12:00 y un servicio de 45 min con precio y seña. */
  async function bookableSite(options: { connected?: boolean; deposit?: number | null } = {}) {
    const email = `${unique("owner")}${TEST_EMAIL_DOMAIN}`;
    const password = "password1234";
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password }).expect(201);
    const org = await agent.post("/api/v1/organizations").set(CSRF).send({ name: "Estudio", slug: unique("org") }).expect(201);
    const organizationId = org.body.id as string;
    const siteSlug = unique("sitio");
    const site = await agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Estudio Luz", slug: siteSlug }).expect(201);
    const base = `/api/v1/organizations/${organizationId}/sites/${site.body.id}/booking`;
    await agent
      .put(`${base}/settings`)
      .set(CSRF)
      .send({ ...DEFAULT_BOOKING_SETTINGS, enabled: true, minNoticeMinutes: 0, weeklyHours: { ...EMPTY_WEEK, mon: [{ start: "09:00", end: "12:00" }] } })
      .expect(200);
    const deposit = options.deposit === undefined ? 5_000 : options.deposit;
    const service = await agent
      .post(`${base}/services`)
      .set(CSRF)
      .send({ name: "Sesión de fotos", durationMinutes: 45, priceAmount: 30_000, priceCurrency: "CLP", paymentUrl: "https://pago.ejemplo.cl/fotos", ...(deposit === null ? {} : { depositAmount: deposit }) })
      .expect(201);
    const account = { accessToken: `APP_USR-${randomBytes(12).toString("hex")}`, providerUserId: `${Date.now()}${Math.floor(Math.random() * 1000)}` };
    if (options.connected !== false) {
      await prisma.paymentAccount.create({
        data: {
          organizationId,
          provider: "MERCADO_PAGO",
          providerUserId: account.providerUserId,
          accessTokenEncrypted: encryptSecret(account.accessToken, env.AUTH_ENCRYPTION_KEY),
          refreshTokenEncrypted: encryptSecret("TG-refresh-de-pruebas", env.AUTH_ENCRYPTION_KEY),
          expiresAt: new Date(Date.now() + 90 * 24 * 3_600_000),
          liveMode: false,
        },
      });
    }
    emailAdapter.messages = [];
    return {
      agent,
      ownerEmail: email,
      organizationId,
      siteId: site.body.id as string,
      base,
      serviceId: service.body.id as string,
      account,
      agenda: `/api/v1/organizations/${organizationId}/bookings`,
      publicBase: `/api/v1/public/sites/${siteSlug}/booking`,
    };
  }

  async function book(publicBase: string, serviceId: string, startsAt: string) {
    const customerEmail = `cliente.${unique("c")}${TEST_EMAIL_DOMAIN}`;
    const res = await request(httpServer).post(publicBase).set(CSRF).send({ serviceId, startsAt, name: "Ana Pérez", email: customerEmail, consent: true }).expect(201);
    const confirmation = publicBookingConfirmationResponse.strict().parse(res.body);
    const booking = await prisma.booking.findFirstOrThrow({ where: { customerEmail }, orderBy: { createdAt: "desc" } });
    const manageToken = /\/reserva\/(\S+)/.exec(emailAdapter.messages.find((m) => m.to === customerEmail)?.text ?? "")?.[1];
    return { confirmation, booking, customerEmail, manageToken };
  }

  function webhook(bookingId: string, paymentId: string, signature?: string) {
    const requestId = unique("req");
    return request(httpServer)
      .post(`/api/v1/payments/mercadopago/bookings/${bookingId}/webhook?data.id=${paymentId}&type=payment`)
      .set("x-request-id", requestId)
      .set("x-signature", signature ?? sign(paymentId, requestId))
      .send({ type: "payment", data: { id: paymentId } });
  }

  it("el servicio valida la seña en el servidor: necesita precio y no puede superarlo", async () => {
    const { agent, base, serviceId } = await bookableSite();
    await agent.post(`${base}/services`).set(CSRF).send({ name: "Sin precio", durationMinutes: 30, depositAmount: 1000 }).expect(400);
    await agent.post(`${base}/services`).set(CSRF).send({ name: "Seña alta", durationMinutes: 30, priceAmount: 1000, priceCurrency: "CLP", depositAmount: 2000 }).expect(400);
    // Quitarle el precio a un servicio con seña deja un servicio inválido.
    await agent.patch(`${base}/services/${serviceId}`).set(CSRF).send({ priceAmount: null, priceCurrency: null }).expect(422);
    await agent.patch(`${base}/services/${serviceId}`).set(CSRF).send({ depositAmount: 40_000 }).expect(422);
    const edited = await agent.patch(`${base}/services/${serviceId}`).set(CSRF).send({ depositAmount: 8_000 }).expect(200);
    expect(edited.body.depositAmount).toBe(8_000);
  });

  it("sin cuenta conectada la reserva se confirma como siempre; con cuenta, la página muestra la seña", async () => {
    const off = await bookableSite({ connected: false });
    const offInfo = publicBookingInfoResponse.strict().parse((await request(httpServer).get(off.publicBase).expect(200)).body);
    expect(offInfo.services[0]!.depositAmount).toBeNull();
    const plain = await book(off.publicBase, off.serviceId, utcAt(monday, 9, 0));
    expect(plain.confirmation).toMatchObject({ status: "CONFIRMED", depositAmount: null, checkoutUrl: null, paymentUrl: "https://pago.ejemplo.cl/fotos" });
    expect(plain.booking).toMatchObject({ status: "CONFIRMED", depositAmount: null, checkoutPreferenceId: null });

    const on = await bookableSite();
    const onInfo = publicBookingInfoResponse.strict().parse((await request(httpServer).get(on.publicBase).expect(200)).body);
    expect(onInfo.services[0]!.depositAmount).toBe(5_000);
  });

  it("con seña: la hora queda tomada esperando el pago, el cobro se crea a nombre del negocio y el cliente recibe el enlace", async () => {
    const { publicBase, serviceId, account, ownerEmail } = await bookableSite();
    const startsAt = utcAt(monday, 9, 0);
    const before = Date.now();
    const { confirmation, booking, customerEmail, manageToken } = await book(publicBase, serviceId, startsAt);

    expect(confirmation).toMatchObject({ status: "PENDING_PAYMENT", depositAmount: 5_000, paymentUrl: null });
    expect(confirmation.checkoutUrl).toMatch(/^https:\/\/www\.mercadopago\.cl\//);
    const deadline = Date.parse(confirmation.paymentDeadline!);
    expect(deadline).toBeGreaterThanOrEqual(before + 29 * 60_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 30 * 60_000);
    expect(booking).toMatchObject({ status: "PENDING_PAYMENT", depositAmount: 5_000, checkoutUrl: confirmation.checkoutUrl });

    const preference = checkout.preferences.find((item) => item.externalReference === booking.id)!;
    expect(preference).toMatchObject({ accessToken: account.accessToken, title: "Seña: Sesión de fotos", quantity: 1, unitPrice: 5_000, currency: "CLP", payerEmail: customerEmail });
    expect(preference.notificationUrl).toBe(`${env.API_PUBLIC_URL}/api/v1/payments/mercadopago/bookings/${booking.id}/webhook`);
    expect(preference.backUrl).toContain("/reserva/");
    expect(preference.expiresAt.getTime()).toBe(deadline);

    // Al cliente se le pide la seña; al negocio todavía no se le avisa.
    expect(emailAdapter.messages.find((m) => m.to === customerEmail)?.subject).toContain("Paga la seña");
    expect(emailAdapter.messages.find((m) => m.to === ownerEmail)).toBeUndefined();

    // La hora está tomada: nadie más puede reservarla.
    const availability = await request(httpServer).get(`${publicBase}/availability?serviceId=${serviceId}&from=${monday}&days=1`).expect(200);
    expect(availability.body.days[0].slots).not.toContain(startsAt);
    await request(httpServer).post(publicBase).set(CSRF).send({ serviceId, startsAt, name: "Otra", email: `otra.${unique("c")}${TEST_EMAIL_DOMAIN}`, consent: true }).expect(409);

    const view = publicManagedBookingResponse.strict().parse((await request(httpServer).get(`/api/v1/public/bookings/${manageToken}`).set(CSRF).expect(200)).body);
    expect(view).toMatchObject({ status: "PENDING_PAYMENT", checkoutUrl: confirmation.checkoutUrl, paymentUrl: null, canChange: false, deposit: { amount: 5_000, status: null, paidAt: null } });
  });

  it("el aviso firmado de la seña confirma la reserva una sola vez y avisa al cliente y al negocio", async () => {
    const { publicBase, serviceId, account, ownerEmail, organizationId } = await bookableSite();
    const { booking, customerEmail } = await book(publicBase, serviceId, utcAt(monday, 10, 0));
    const paymentId = checkout.pay(booking.id, { collectorId: account.providerUserId });

    await webhook(booking.id, paymentId, sign(paymentId, "otro-request")).expect(401);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("PENDING_PAYMENT");

    emailAdapter.messages = [];
    expect((await webhook(booking.id, paymentId).expect(200)).body).toEqual({ result: "paid" });
    const paid = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(paid).toMatchObject({ status: "CONFIRMED", providerPaymentId: paymentId, paymentStatus: "approved" });
    expect(paid.depositPaidAt).not.toBeNull();
    expect(emailAdapter.messages.find((m) => m.to === customerEmail)?.subject).toContain("Recibimos tu seña");
    const toOwner = emailAdapter.messages.find((m) => m.to === ownerEmail);
    expect(toOwner?.subject).toContain("Nueva reserva con seña pagada");
    expect(toOwner?.text).toContain(paymentId);
    expect(await prisma.auditLog.count({ where: { organizationId, action: "booking.deposit_paid", targetId: booking.id } })).toBe(1);

    emailAdapter.messages = [];
    expect((await webhook(booking.id, paymentId).expect(200)).body).toEqual({ result: "unchanged" });
    expect(emailAdapter.messages).toHaveLength(0);
  });

  it("no confirma si el monto, la moneda, la reserva o la cuenta receptora no coinciden", async () => {
    const { publicBase, serviceId, account } = await bookableSite();
    const { booking } = await book(publicBase, serviceId, utcAt(monday, 9, 0));
    const other = await book(publicBase, serviceId, utcAt(monday, 11, 0));
    const payments = [
      checkout.pay(booking.id, { collectorId: account.providerUserId, amount: 30_000 }),
      checkout.pay(booking.id, { collectorId: account.providerUserId, currency: "USD" }),
      checkout.pay(booking.id, { collectorId: "999999" }),
      checkout.pay(other.booking.id, { collectorId: account.providerUserId }),
    ];
    for (const paymentId of payments) {
      expect((await webhook(booking.id, paymentId).expect(200)).body).toEqual({ result: "mismatch" });
    }
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ status: "PENDING_PAYMENT", providerPaymentId: null });
  });

  it("aislamiento (ADR-002/013): un pago de la cuenta de otro negocio nunca confirma una reserva ajena", async () => {
    const a = await bookableSite();
    const b = await bookableSite();
    const { booking: bookingA } = await book(a.publicBase, a.serviceId, utcAt(monday, 9, 0));
    const { booking: bookingB } = await book(b.publicBase, b.serviceId, utcAt(monday, 9, 0));
    const paymentOfB = checkout.pay(bookingB.id, { collectorId: b.account.providerUserId });
    const forgedForA = checkout.pay(bookingB.id, { collectorId: a.account.providerUserId, accessToken: b.account.accessToken });
    for (const paymentId of [paymentOfB, forgedForA]) {
      expect((await webhook(bookingA.id, paymentId).expect(200)).body).toEqual({ result: "mismatch" });
    }
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingA.id } })).status).toBe("PENDING_PAYMENT");
    // B no ve la reserva de A en su agenda.
    await b.agent.get(`${b.agenda}/${bookingA.id}`).expect(404);
  });

  it("al volver de Mercado Pago, 'Tu reserva' consulta el pago en el momento; un pago en revisión se informa", async () => {
    const { publicBase, serviceId, account } = await bookableSite();
    const { booking, manageToken } = await book(publicBase, serviceId, utcAt(monday, 9, 0));
    const pending = checkout.pay(booking.id, { collectorId: account.providerUserId, status: "in_process" });
    const inReview = publicManagedBookingResponse.parse((await request(httpServer).get(`/api/v1/public/bookings/${manageToken}?paymentId=${pending}`).set(CSRF).expect(200)).body);
    expect(inReview).toMatchObject({ status: "PENDING_PAYMENT", deposit: { status: "in_process" } });

    checkout.setStatus(pending, "approved");
    const done = publicManagedBookingResponse.parse((await request(httpServer).get(`/api/v1/public/bookings/${manageToken}?paymentId=${pending}`).set(CSRF).expect(200)).body);
    expect(done).toMatchObject({ status: "CONFIRMED", checkoutUrl: null, canChange: true });
    expect(done.deposit?.paidAt).not.toBeNull();
    expect((await webhook(booking.id, pending).expect(200)).body).toEqual({ result: "unchanged" });
  });

  it("pago tardío: si el worker liberó la hora y sigue libre se reconfirma; si la tomó otra persona, se avisa al negocio", async () => {
    const { publicBase, serviceId, account, ownerEmail } = await bookableSite();
    const free = await book(publicBase, serviceId, utcAt(monday, 9, 0));
    const taken = await book(publicBase, serviceId, utcAt(monday, 11, 0));
    // Lo que hace el worker al vencer el plazo (probado en apps/worker).
    const expired = { status: "CANCELLED" as const, cancelledAt: new Date(), paymentExpiredAt: new Date() };
    await prisma.booking.updateMany({ where: { id: { in: [free.booking.id, taken.booking.id] } }, data: expired });
    // Otra persona toma la hora de las 11:00.
    await request(httpServer).post(publicBase).set(CSRF).send({ serviceId, startsAt: utcAt(monday, 11, 0), name: "Otra", email: `otra.${unique("c")}${TEST_EMAIL_DOMAIN}`, consent: true }).expect(201);

    const lateFree = checkout.pay(free.booking.id, { collectorId: account.providerUserId });
    expect((await webhook(free.booking.id, lateFree).expect(200)).body).toEqual({ result: "paid" });
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: free.booking.id } })).toMatchObject({ status: "CONFIRMED", cancelledAt: null, providerPaymentId: lateFree });

    emailAdapter.messages = [];
    const lateTaken = checkout.pay(taken.booking.id, { collectorId: account.providerUserId });
    expect((await webhook(taken.booking.id, lateTaken).expect(200)).body).toEqual({ result: "paid_without_slot" });
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: taken.booking.id } })).toMatchObject({ status: "CANCELLED", providerPaymentId: lateTaken });
    expect(emailAdapter.messages.find((m) => m.to === ownerEmail)?.subject).toContain("ya no estaba activa");
  });

  it("el negocio ve la seña en su agenda, puede confirmar sin seña y nunca poner 'esperando seña' a mano", async () => {
    const { agent, publicBase, serviceId, agenda } = await bookableSite();
    const { booking } = await book(publicBase, serviceId, utcAt(monday, 9, 0));
    const view = bookingResponse.parse((await agent.get(`${agenda}/${booking.id}`).expect(200)).body);
    expect(view).toMatchObject({ status: "PENDING_PAYMENT", deposit: { amount: 5_000, paymentId: null, status: null } });

    await agent.patch(`${agenda}/${booking.id}`).set(CSRF).send({ status: "PENDING_PAYMENT" }).expect(400);
    const confirmed = await agent.patch(`${agenda}/${booking.id}`).set(CSRF).send({ status: "CONFIRMED" }).expect(200);
    expect(confirmed.body.status).toBe("CONFIRMED");
  });

  it("si Mercado Pago falla al crear el cobro, la reserva se confirma sin seña (nunca se pierde)", async () => {
    const { publicBase, serviceId, ownerEmail } = await bookableSite();
    checkout.failNextPreference = true;
    const { confirmation, booking, customerEmail } = await book(publicBase, serviceId, utcAt(monday, 9, 0));
    expect(confirmation).toMatchObject({ status: "CONFIRMED", checkoutUrl: null, depositAmount: null, paymentUrl: "https://pago.ejemplo.cl/fotos" });
    expect(booking).toMatchObject({ status: "CONFIRMED", depositAmount: null, paymentDeadline: null });
    expect(emailAdapter.messages.find((m) => m.to === customerEmail)?.subject).toContain("Reserva confirmada");
    expect(emailAdapter.messages.find((m) => m.to === ownerEmail)?.subject).toContain("Nueva reserva");
  });
});
