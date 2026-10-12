import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { encryptSecret, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { bookingWebpayStartResponse, publicBookingConfirmationResponse, publicManagedBookingResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { FakeMercadoPagoCheckout, FakeWebpayPlus, WEBPAY_PLUS_INTEGRATION_CREDENTIALS } from "@impulza/payments";
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
import { MERCADO_PAGO_CHECKOUT, WEBPAY_PLUS_GATEWAY } from "../payment-accounts/checkout.tokens.js";

// F10.2e (ADR-030) — seña de reservas con Webpay Plus del propio negocio: la transacción se crea al pulsar «Pagar» en
// «Tu reserva», el servidor confirma al volver el cliente y la reserva se confirma una sola vez.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@booking-webpay-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const TZ = "America/Santiago";
const EMPTY_WEEK = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
const WEBHOOK_SECRET = "clave-de-firma-de-la-app-de-pruebas-0000";
const CREDENTIALS = { commerceCode: WEBPAY_PLUS_INTEGRATION_CREDENTIALS.commerceCode, apiKeySecret: WEBPAY_PLUS_INTEGRATION_CREDENTIALS.apiKeySecret, environment: "integration" };
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function nextMondayLocal(): string {
  let date = addDaysToDate(localDateOf(new Date(), TZ), 7);
  while (weekdayOf(date) !== 1) date = addDaysToDate(date, 1);
  return date;
}

function utcAt(date: string, hour: number, minute: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return zonedWallTimeToUtc({ year, month, day, hour, minute }, TZ)!.toISOString();
}

describe("Seña de reservas con Webpay Plus del negocio (e2e) — F10.2e / ADR-030", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let webpay: FakeWebpayPlus;
  let mercadoPago: FakeMercadoPagoCheckout;
  let http: Parameters<typeof request>[0];
  const monday = nextMondayLocal();
  /** Cada reserva toma una hora distinta del lunes para que no choquen entre sí. */
  let slotCursor = 0;
  const nextSlot = (): string => {
    return utcAt(monday, 9 + (slotCursor++ % 7), 0);
  };

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    webpay = new FakeWebpayPlus();
    mercadoPago = new FakeMercadoPagoCheckout();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(WEBPAY_PLUS_GATEWAY)
      .useValue(webpay)
      .overrideProvider(MERCADO_PAGO_CHECKOUT)
      .useValue({ checkout: mercadoPago, webhookSecret: WEBHOOK_SECRET })
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map((user) => user.id) } } });
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  /** Sitio con reservas los lunes 09:00–12:00 y un servicio de 45 min con precio y seña. */
  async function business(options: { webpay?: boolean; mercadoPago?: boolean; commerceCode?: string } = {}) {
    const email = `${unique("owner")}${DOMAIN}`;
    const owner = request.agent(http);
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    await owner.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const org = await owner.post("/api/v1/organizations").set(CSRF).send({ name: "Estudio", slug: unique("org") }).expect(201);
    const organizationId = org.body.id as string;
    const siteSlug = unique("sitio");
    const site = await owner.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Estudio Luz", slug: siteSlug }).expect(201);
    const base = `/api/v1/organizations/${organizationId}/sites/${site.body.id}/booking`;
    await owner
      .put(`${base}/settings`)
      .set(CSRF)
      .send({ ...DEFAULT_BOOKING_SETTINGS, enabled: true, minNoticeMinutes: 0, weeklyHours: { ...EMPTY_WEEK, mon: [{ start: "09:00", end: "17:00" }] } })
      .expect(200);
    const service = await owner
      .post(`${base}/services`)
      .set(CSRF)
      .send({ name: "Sesión de fotos", durationMinutes: 45, priceAmount: 30_000, priceCurrency: "CLP", depositAmount: 5_000, paymentUrl: "https://pago.ejemplo.cl/fotos" })
      .expect(201);

    const mp = { accessToken: `APP_USR-${randomBytes(12).toString("hex")}`, providerUserId: `${Date.now()}${Math.floor(Math.random() * 1000)}` };
    if (options.mercadoPago) {
      await prisma.paymentAccount.create({
        data: {
          organizationId,
          provider: "MERCADO_PAGO",
          providerUserId: mp.providerUserId,
          accessTokenEncrypted: encryptSecret(mp.accessToken, env.AUTH_ENCRYPTION_KEY),
          refreshTokenEncrypted: encryptSecret("TG-refresh-de-pruebas", env.AUTH_ENCRYPTION_KEY),
          expiresAt: new Date(Date.now() + 90 * 24 * 3_600_000),
          liveMode: false,
        },
      });
    }
    if (options.webpay !== false) {
      await owner
        .put(`/api/v1/organizations/${organizationId}/payment-accounts/webpay-plus`)
        .set(CSRF)
        .send({ ...CREDENTIALS, ...(options.commerceCode ? { commerceCode: options.commerceCode } : {}) })
        .expect(204);
    }
    emailAdapter.messages = [];
    return {
      owner,
      ownerEmail: email,
      organizationId,
      serviceId: service.body.id as string,
      agenda: `/api/v1/organizations/${organizationId}/bookings`,
      publicBase: `/api/v1/public/sites/${siteSlug}/booking`,
    };
  }

  async function book(b: Awaited<ReturnType<typeof business>>) {
    const customerEmail = `cliente.${unique("c")}${DOMAIN}`;
    const res = await request(http)
      .post(b.publicBase)
      .set(CSRF)
      .send({ serviceId: b.serviceId, startsAt: nextSlot(), name: "Ana Pérez", email: customerEmail, consent: true })
      .expect(201);
    const confirmation = publicBookingConfirmationResponse.strict().parse(res.body);
    const booking = await prisma.booking.findFirstOrThrow({ where: { customerEmail }, orderBy: { createdAt: "desc" } });
    const manageToken = /\/reserva\/([A-Za-z0-9_.-]+)/.exec(emailAdapter.messages.find((m) => m.to === customerEmail)?.text ?? "")?.[1];
    return { confirmation, booking, customerEmail, manageToken: manageToken! };
  }

  const startWebpay = (token: string) => request(http).post(`/api/v1/public/bookings/${token}/webpay`).set(CSRF);
  const view = async (token: string) => publicManagedBookingResponse.strict().parse((await request(http).get(`/api/v1/public/bookings/${token}`).set(CSRF).expect(200)).body);
  const returnGet = (token: string, query: Record<string, string>) => request(http).get(`/api/v1/payments/webpay/bookings/${token}/return`).query(query);
  const paidAudits = (organizationId: string, bookingId: string) => prisma.auditLog.count({ where: { organizationId, action: "booking.deposit_paid", targetId: bookingId } });

  async function startAndPay(manageToken: string, outcome: { status?: string; responseCode?: number; amount?: number } = {}): Promise<string> {
    const started = bookingWebpayStartResponse.parse((await startWebpay(manageToken).expect(200)).body);
    const token = started.fields.token_ws!;
    webpay.pay(token, outcome);
    return token;
  }

  it("un negocio solo con Webpay: la reserva espera la seña y ofrece pagar en «Tu reserva»", async () => {
    const b = await business();
    const before = mercadoPago.preferences.length;
    const { confirmation, booking, customerEmail, manageToken } = await book(b);

    expect(confirmation).toMatchObject({ status: "PENDING_PAYMENT", depositAmount: 5_000, checkoutUrl: null, paymentUrl: null, webpayUrl: `${env.PUBLIC_SITE_BASE_URL}/reserva/${manageToken}` });
    expect(mercadoPago.preferences.length).toBe(before);
    expect(booking).toMatchObject({ status: "PENDING_PAYMENT", webpayToken: null, providerPaymentId: null });
    // La transacción se crea al pulsar «Pagar»: cada intento necesita la suya.
    expect(webpay.created.filter((item) => item.sessionId === booking.id)).toHaveLength(0);

    const toCustomer = emailAdapter.messages.find((m) => m.to === customerEmail)!;
    expect(toCustomer.text).toContain("Webpay Plus");
    expect(toCustomer.text).not.toContain("Mercado Pago");
    expect(await view(manageToken)).toMatchObject({ status: "PENDING_PAYMENT", checkoutUrl: null, webpayAvailable: true });
  });

  it("crea la transacción con el comercio del negocio y la seña guardada, sin tomar nada del visitante", async () => {
    const b = await business();
    const { booking, manageToken } = await book(b);

    // El visitante intenta imponer un monto: se ignora (la API toma la seña de la reserva).
    const res = await startWebpay(manageToken).send({ amount: 1, depositAmount: 1 }).expect(200);
    const started = bookingWebpayStartResponse.parse(res.body);
    expect(started).toMatchObject({ method: "POST", checkoutUrl: "https://webpay3gint.transbank.cl/webpayserver/initTransaction" });
    const created = webpay.created.find((item) => item.token === started.fields.token_ws)!;
    expect(created).toMatchObject({ amount: 5_000, sessionId: booking.id, commerceCode: CREDENTIALS.commerceCode });
    expect(created.returnUrl).toBe(`${env.API_PUBLIC_URL}/api/v1/payments/webpay/bookings/${manageToken}/return`);
    expect(created.buyOrder).toMatch(/^[A-Za-z0-9]{1,26}$/);

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored).toMatchObject({ webpayToken: started.fields.token_ws, webpayBuyOrder: created.buyOrder, paymentProvider: "WEBPAY_PLUS", providerPaymentId: null, status: "PENDING_PAYMENT" });

    // Un enlace inventado no revela nada.
    await startWebpay(randomBytes(32).toString("base64url")).expect(404);
  });

  it("al volver autorizado, el servidor confirma, la reserva queda confirmada una sola vez y avisa con el nombre correcto", async () => {
    const b = await business();
    const { booking, customerEmail, manageToken } = await book(b);
    const token = await startAndPay(manageToken);
    emailAdapter.messages = [];

    const back = await returnGet(manageToken, { token_ws: token }).expect(303);
    expect(back.headers.location).toBe(`${env.PUBLIC_SITE_BASE_URL}/reserva/${manageToken}`);
    expect(back.headers["cache-control"]).toBe("no-store");

    const paid = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(paid).toMatchObject({ status: "CONFIRMED", paymentStatus: "approved", paymentProvider: "WEBPAY_PLUS" });
    expect(paid.providerPaymentId).toBe(`webpay:${paid.webpayBuyOrder}`);
    expect(paid.depositPaidAt).not.toBeNull();
    expect(webpay.isCommitted(token)).toBe(true);

    expect(emailAdapter.messages.find((m) => m.to === customerEmail)).toBeDefined();
    const toOwner = emailAdapter.messages.find((m) => m.to === b.ownerEmail)!;
    expect(toOwner.text).toContain("Webpay Plus");
    expect(toOwner.text).not.toContain("Mercado Pago");
    expect(toOwner.text).toContain(paid.webpayBuyOrder!);
    expect(await paidAudits(b.organizationId, booking.id)).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: b.organizationId, action: "booking.deposit_paid", targetId: booking.id } });
    expect(audit.metadata).toMatchObject({ provider: "WEBPAY_PLUS" });

    // Recargar la URL de regreso: sin efecto ni correos nuevos.
    emailAdapter.messages = [];
    await returnGet(manageToken, { token_ws: token }).expect(303);
    expect(emailAdapter.messages).toHaveLength(0);
    expect(await paidAudits(b.organizationId, booking.id)).toBe(1);

    expect(await view(manageToken)).toMatchObject({ status: "CONFIRMED", webpayAvailable: false });
    // Ya pagada: no se puede crear otra transacción.
    await startWebpay(manageToken).expect(409);
  });

  it("regresos simultáneos del mismo pago: una sola confirmación, un solo aviso", async () => {
    const b = await business();
    const { booking, manageToken } = await book(b);
    const token = await startAndPay(manageToken);
    emailAdapter.messages = [];

    const results = await Promise.all(Array.from({ length: 6 }, () => returnGet(manageToken, { token_ws: token })));
    expect(results.every((res) => res.status === 303)).toBe(true);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("CONFIRMED");
    expect(await paidAudits(b.organizationId, booking.id)).toBe(1);
    expect(emailAdapter.messages.filter((m) => m.to === b.ownerEmail)).toHaveLength(1);
  });

  it("tarjeta rechazada: queda constancia, la hora sigue tomada y se puede reintentar con una transacción nueva", async () => {
    const b = await business();
    const { booking, manageToken } = await book(b);
    const first = await startAndPay(manageToken, { status: "FAILED", responseCode: -1 });
    await returnGet(manageToken, { token_ws: first }).expect(303);

    const rejected = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(rejected).toMatchObject({ status: "PENDING_PAYMENT", paymentStatus: "rejected", providerPaymentId: null });
    expect(await view(manageToken)).toMatchObject({ status: "PENDING_PAYMENT", webpayAvailable: true });

    const second = await startAndPay(manageToken);
    expect(second).not.toBe(first);
    await returnGet(manageToken, { token_ws: second }).expect(303);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ status: "CONFIRMED", paymentStatus: "approved" });
    expect(await paidAudits(b.organizationId, booking.id)).toBe(1);
  });

  it("un monto distinto a la seña no confirma la reserva", async () => {
    const b = await business();
    const { booking, manageToken } = await book(b);
    const token = await startAndPay(manageToken, { amount: 100 });
    await returnGet(manageToken, { token_ws: token }).expect(303);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ status: "PENDING_PAYMENT", providerPaymentId: null });
    expect(await paidAudits(b.organizationId, booking.id)).toBe(0);
  });

  it("el token de la URL nunca se toma como verdad: uno ajeno no confirma ni consume la transacción de otra reserva", async () => {
    const b = await business();
    const mine = await book(b);
    const other = await book(b);
    await startAndPay(mine.manageToken);
    const otherToken = await startAndPay(other.manageToken);

    await returnGet(mine.manageToken, { token_ws: otherToken }).expect(303);
    expect(webpay.isCommitted(otherToken)).toBe(false);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: mine.booking.id } })).toMatchObject({ status: "PENDING_PAYMENT", providerPaymentId: null });
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: other.booking.id } })).toMatchObject({ status: "PENDING_PAYMENT", providerPaymentId: null });

    // Un enlace que no corresponde a ninguna reserva: 404, sin pistas.
    await returnGet("no-es-un-enlace", {}).expect(404);
    expect(webpay.isCommitted(otherToken)).toBe(false);
  });

  it("abandonar el pago en Webpay no cobra ni cambia nada", async () => {
    const b = await business();
    const { booking, manageToken } = await book(b);
    const token = await startAndPay(manageToken);
    await returnGet(manageToken, { TBK_TOKEN: token }).expect(303);
    expect(webpay.isCommitted(token)).toBe(false);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ status: "PENDING_PAYMENT", providerPaymentId: null, paymentStatus: null });
  });

  it("una reserva con el plazo vencido o cancelada no se puede pagar con Webpay", async () => {
    const b = await business();
    const expired = await book(b);
    await prisma.booking.update({ where: { id: expired.booking.id }, data: { paymentDeadline: new Date(Date.now() - 1000) } });
    await startWebpay(expired.manageToken).expect(409);
    expect(await view(expired.manageToken)).toMatchObject({ webpayAvailable: false });

    const cancelled = await book(b);
    await prisma.booking.update({ where: { id: cancelled.booking.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await startWebpay(cancelled.manageToken).expect(409);
  });

  it("si Transbank no responde, la reserva sigue esperando y se puede reintentar", async () => {
    const b = await business();
    const { booking, manageToken } = await book(b);
    webpay.failNextCreate = true;
    await startWebpay(manageToken).expect(503);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ status: "PENDING_PAYMENT", webpayToken: null });
    await startWebpay(manageToken).expect(200);
  });

  it("con Mercado Pago y Webpay: se ofrecen los dos y la reserva registra el medio que efectivamente cobró", async () => {
    const b = await business({ mercadoPago: true });
    const { confirmation, booking, customerEmail, manageToken } = await book(b);
    expect(confirmation.checkoutUrl).toMatch(/^https:\/\/www\.mercadopago\.cl\//);
    expect(confirmation.webpayUrl).toBe(`${env.PUBLIC_SITE_BASE_URL}/reserva/${manageToken}`);
    expect(emailAdapter.messages.find((m) => m.to === customerEmail)?.text).toContain("Mercado Pago o Webpay Plus");
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ paymentProvider: "MERCADO_PAGO" });

    // Pagó con Webpay: la reserva queda marcada con esa pasarela.
    const token = await startAndPay(manageToken);
    await returnGet(manageToken, { token_ws: token }).expect(303);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ status: "CONFIRMED", paymentProvider: "WEBPAY_PLUS" });
  });

  it("una seña pagada con Webpay no se devuelve por la API de Mercado Pago: se explica dónde hacerlo", async () => {
    const b = await business({ mercadoPago: true });
    const { booking, manageToken } = await book(b);
    const token = await startAndPay(manageToken);
    await returnGet(manageToken, { token_ws: token }).expect(303);

    const res = await b.owner.post(`${b.agenda}/${booking.id}/refund-deposit`).set(CSRF).set("Idempotency-Key", unique("refund")).send({}).expect(422);
    expect(JSON.stringify(res.body)).toContain("Transbank");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).depositRefundedAmount).toBe(0);
  });

  it("aislamiento: cada seña se cobra solo con el comercio de su propio negocio", async () => {
    const a = await business({ commerceCode: "597011111111" });
    const other = await business({ commerceCode: "597022222222" });
    const first = await book(a);
    const second = await book(other);
    await startWebpay(first.manageToken).expect(200);
    await startWebpay(second.manageToken).expect(200);
    expect(webpay.created.find((item) => item.sessionId === first.booking.id)?.commerceCode).toBe("597011111111");
    expect(webpay.created.find((item) => item.sessionId === second.booking.id)?.commerceCode).toBe("597022222222");

    // Un negocio sin Webpay conectado: sus reservas no ofrecen Webpay y no se puede iniciar.
    const bare = await business({ webpay: false });
    const bareBooking = await book(bare);
    expect(bareBooking.confirmation).toMatchObject({ webpayUrl: null, checkoutUrl: null, status: "CONFIRMED", depositAmount: null });
    await startWebpay(bareBooking.manageToken).expect(409);
  });
});
