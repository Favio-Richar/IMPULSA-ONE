import { createHmac, randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { encryptSecret, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { membershipPlanListResponse, membershipPlanResponse, publicMembershipPlansResponse, publicMembershipStatusResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { FakeMercadoPagoCheckout } from "@impulza/payments";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { MERCADO_PAGO_CHECKOUT } from "../payment-accounts/checkout.tokens.js";

// F10.2 (ADR-029) — planes de membresía y cobro por la cuenta de Mercado Pago del propio negocio.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@membership-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const WEBHOOK_SECRET = "clave-de-firma-de-la-app-de-pruebas-0000";
const SECRET = "CONTENIDO-SOLO-PARA-SOCIOS";
const DAY = 86_400_000;
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;

/** Firma un aviso como Mercado Pago (`x-signature: ts=…,v1=…`). */
function sign(dataId: string, requestId: string, secret = WEBHOOK_SECRET): string {
  const ts = String(Date.now());
  return `ts=${ts},v1=${createHmac("sha256", secret).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex")}`;
}

describe("Membresías con cobro por la cuenta del negocio (e2e) — F10.2 / ADR-029", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let checkout: FakeMercadoPagoCheckout;
  let http: Parameters<typeof request>[0];

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
    const keys = [...(await redis.keys("ratelimit:*")), ...(await redis.keys("member-access:*"))];
    if (keys.length > 0) await redis.del(...keys);
  });

  async function person(label: string): Promise<{ email: string; agent: Agent }> {
    const email = `${unique(label)}${DOMAIN}`;
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(http);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    return { email, agent };
  }

  /** Negocio con un sitio, una página publicada «solo miembros» con un texto exclusivo y (opcional) cuenta de cobro conectada. */
  async function business(options: { connected?: boolean } = {}) {
    const owner = await person("owner");
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Club de Lectura", slug: unique("club-org") }).expect(201);
    const organizationId = org.body.id as string;
    await assignRoomyPlan(prisma, organizationId);
    const siteSlug = unique("club-site");
    const site = await owner.agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Club Luna", slug: siteSlug }).expect(201);
    const siteId = site.body.id as string;
    const pagesPath = `/api/v1/organizations/${organizationId}/sites/${siteId}/pages`;
    const home = (await owner.agent.get(pagesPath).expect(200)).body[0] as { id: string; slug: string };
    await owner.agent.post(`${pagesPath}/${home.id}/blocks`).set(CSRF).send({ type: "text", config: { html: `<p>${SECRET}</p>`, alignment: "left" } }).expect(201);
    await owner.agent.post(`${pagesPath}/${home.id}/publish`).set(CSRF).expect(201);
    const base = `/api/v1/organizations/${organizationId}/sites/${siteId}/members`;
    await owner.agent.put(`${base}/pages/${home.id}`).set(CSRF).send({ enabled: true }).expect(200);

    const account = { accessToken: `APP_USR-${randomBytes(12).toString("hex")}`, providerUserId: `${Date.now()}${Math.floor(Math.random() * 1000)}` };
    if (options.connected !== false) {
      await prisma.paymentAccount.create({
        data: {
          organizationId,
          provider: "MERCADO_PAGO",
          providerUserId: account.providerUserId,
          accessTokenEncrypted: encryptSecret(account.accessToken, env.AUTH_ENCRYPTION_KEY),
          refreshTokenEncrypted: encryptSecret("TG-refresh-de-pruebas", env.AUTH_ENCRYPTION_KEY),
          expiresAt: new Date(Date.now() + 90 * DAY),
          liveMode: false,
        },
      });
    }
    return { owner, organizationId, siteId, siteSlug, pageSlug: home.slug, base, plans: `${base}/plans`, account };
  }

  async function plan(b: Awaited<ReturnType<typeof business>>, overrides: Record<string, unknown> = {}) {
    const res = await b.owner.agent
      .post(b.plans)
      .set(CSRF)
      .send({ name: "Club Premium", description: "Acceso a todas las lecturas.", priceAmount: 9990, priceCurrency: "CLP", period: "MONTHLY", ...overrides })
      .expect(201);
    membershipPlanResponse.parse(res.body);
    return res.body as { id: string; priceAmount: number };
  }

  const startCheckout = (siteSlug: string, planId: string, body: Record<string, unknown>) =>
    request(http).post(`/api/v1/public/sites/${siteSlug}/members/plans/${planId}/checkout`).set(CSRF).send(body);

  function webhook(purchaseId: string, paymentId: string, signature?: string) {
    const requestId = unique("req");
    return request(http)
      .post(`/api/v1/payments/mercadopago/memberships/${purchaseId}/webhook?data.id=${paymentId}&type=payment`)
      .set("x-request-id", requestId)
      .set("x-signature", signature ?? sign(paymentId, requestId))
      .send({ action: "payment.created", type: "payment", data: { id: paymentId } });
  }

  async function buy(b: Awaited<ReturnType<typeof business>>, planId: string, email: string) {
    const res = await startCheckout(b.siteSlug, planId, { email, name: "Socia Prueba" }).expect(201);
    const purchase = await prisma.membershipPurchase.findFirstOrThrow({ where: { member: { siteId: b.siteId, email } }, orderBy: { createdAt: "desc" } });
    return { purchase, statusUrl: res.body.statusUrl as string, checkoutUrl: res.body.checkoutUrl as string };
  }

  async function pay(b: Awaited<ReturnType<typeof business>>, purchaseId: string, overrides: { amount?: number; collectorId?: string } = {}) {
    const paymentId = checkout.pay(purchaseId, { collectorId: overrides.collectorId ?? b.account.providerUserId, amount: overrides.amount });
    return { paymentId, response: await webhook(purchaseId, paymentId) };
  }

  const memberPage = (b: { siteSlug: string; pageSlug: string }, session: string) =>
    request(http).get(`/api/v1/public/sites/${b.siteSlug}/members/pages/${b.pageSlug}`).set("x-member-session", session);

  /** Entra con el enlace que llegó por correo. */
  async function enter(email: string): Promise<string> {
    const mail = [...emailAdapter.messages].reverse().find((m) => m.to === email && /\/miembros\//.test(m.text ?? ""));
    const token = /\/miembros\/([A-Za-z0-9_-]{43})/.exec(mail?.text ?? "")?.[1];
    expect(token, `enlace de acceso para ${email}`).toBeTruthy();
    const res = await request(http).post("/api/v1/public/members/verify").set(CSRF).send({ token }).expect(200);
    return res.body.sessionToken as string;
  }

  it("panel: crea, valida, edita, archiva y restaura planes; el precio es entero positivo y la moneda compatible", async () => {
    const b = await business();
    const created = await plan(b);
    expect(created).toMatchObject({ priceAmount: 9990 });

    await b.owner.agent.post(b.plans).set(CSRF).send({ name: "x", priceAmount: 100, period: "MONTHLY" }).expect(400);
    await b.owner.agent.post(b.plans).set(CSRF).send({ name: "Plan", priceAmount: 99.5, period: "MONTHLY" }).expect(400);
    await b.owner.agent.post(b.plans).set(CSRF).send({ name: "Plan", priceAmount: 0, period: "MONTHLY" }).expect(400);
    await b.owner.agent.post(b.plans).set(CSRF).send({ name: "Plan", priceAmount: 100, period: "WEEKLY" }).expect(400);
    await b.owner.agent.post(b.plans).set(CSRF).send({ name: "Plan", priceAmount: 100, period: "MONTHLY", status: "ARCHIVED" }).expect(400);
    await b.owner.agent.post(b.plans).set(CSRF).send({ name: "Plan USD", priceAmount: 100, priceCurrency: "USD", period: "MONTHLY" }).expect(409);

    const updated = await b.owner.agent.put(`${b.plans}/${created.id}`).set(CSRF).send({ priceAmount: 14990, period: "YEARLY" }).expect(200);
    expect(updated.body).toMatchObject({ priceAmount: 14990, period: "YEARLY" });
    await b.owner.agent.put(`${b.plans}/${created.id}`).set(CSRF).send({}).expect(400);

    const archived = await b.owner.agent.post(`${b.plans}/${created.id}/archive`).set(CSRF).expect(200);
    expect(archived.body.status).toBe("ARCHIVED");
    expect((await request(http).get(`/api/v1/public/sites/${b.siteSlug}/members/plans`).expect(200)).body.plans).toEqual([]);
    await b.owner.agent.post(`${b.plans}/${created.id}/restore`).set(CSRF).expect(200);

    const list = await b.owner.agent.get(b.plans).expect(200);
    membershipPlanListResponse.parse(list.body);
    expect(list.body).toMatchObject({ checkoutAvailable: true, monthRevenue: [] });
  });

  it("permisos y aislamiento: sin sesión 401, editor 403, otra organización 403 y su sitio ajeno 404", async () => {
    const b = await business();
    const other = await business();
    const created = await plan(b);
    const editor = await person("editor");
    const invite = await b.owner.agent.post(`/api/v1/organizations/${b.organizationId}/members`).set(CSRF).send({ email: editor.email, role: "EDITOR" }).expect(201);
    await editor.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);

    await request(http).get(b.plans).expect(401);
    await editor.agent.get(b.plans).expect(403);
    await editor.agent.post(b.plans).set(CSRF).send({ name: "Plan", priceAmount: 100, period: "MONTHLY" }).expect(403);
    await other.owner.agent.get(b.plans).expect(403);
    await other.owner.agent.put(`${b.plans}/${created.id}`).set(CSRF).send({ priceAmount: 1 }).expect(403);
    // Con su propia organización pero el sitio y el plan de otra: no existen para ella.
    await other.owner.agent.get(`/api/v1/organizations/${other.organizationId}/sites/${b.siteId}/members/plans`).expect(404);
    await other.owner.agent.put(`/api/v1/organizations/${other.organizationId}/sites/${other.siteId}/members/plans/${created.id}`).set(CSRF).send({ priceAmount: 1 }).expect(404);
    await other.owner.agent.post(`/api/v1/organizations/${other.organizationId}/sites/${other.siteId}/members/plans/${created.id}/archive`).set(CSRF).expect(404);
    expect((await prisma.membershipPlan.findUniqueOrThrow({ where: { id: created.id } })).priceAmount).toBe(9990);
  });

  it("sin cuenta de cobro no se ofrece nada: planes vacíos y la compra responde 503", async () => {
    const b = await business({ connected: false });
    const created = await plan(b);
    const publicPlans = await request(http).get(`/api/v1/public/sites/${b.siteSlug}/members/plans`).expect(200);
    publicMembershipPlansResponse.parse(publicPlans.body);
    expect(publicPlans.body).toEqual({ checkoutAvailable: false, plans: [] });
    await startCheckout(b.siteSlug, created.id, { email: `a${unique("x")}${DOMAIN}` }).expect(503);
    expect((await b.owner.agent.get(b.plans).expect(200)).body.checkoutAvailable).toBe(false);
  });

  it("la compra crea el cobro en la cuenta del negocio con el precio del plan, nunca el que mande el visitante", async () => {
    const b = await business();
    const created = await plan(b);
    const email = `socia-${unique("c")}${DOMAIN}`;

    // El visitante no puede fijar el precio.
    await startCheckout(b.siteSlug, created.id, { email, priceAmount: 1 }).expect(400);
    const { purchase, statusUrl, checkoutUrl } = await buy(b, created.id, email);

    const preference = checkout.preferences.find((item) => item.externalReference === purchase.id)!;
    expect(preference).toMatchObject({ accessToken: b.account.accessToken, quantity: 1, unitPrice: 9990, currency: "CLP", payerEmail: email });
    expect(preference.title).toContain("Club Premium");
    expect(preference.notificationUrl).toBe(`${env.API_PUBLIC_URL}/api/v1/payments/mercadopago/memberships/${purchase.id}/webhook`);
    expect(preference.backUrl).toBe(statusUrl);
    expect(checkoutUrl).toMatch(/^https:\/\/www\.mercadopago\.cl\//);

    expect(purchase).toMatchObject({ status: "PENDING", amount: 9990, currency: "CLP", periodDays: 30, planName: "Club Premium", providerPaymentId: null });
    // El enlace de «Tu membresía» no se guarda: solo su hash.
    const token = /\/membresia\/([A-Za-z0-9_-]+)$/.exec(statusUrl)![1]!;
    expect(purchase.statusTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(purchase.statusTokenHash).not.toContain(token);
    // Sin pago no hay acceso: el miembro quedó como «comprador».
    const member = await prisma.siteMember.findUniqueOrThrow({ where: { siteId_email: { siteId: b.siteId, email } } });
    expect(member).toMatchObject({ source: "PURCHASED", status: "ACTIVE" });

    const status = await request(http).get(`/api/v1/public/memberships/purchases/${token}`).set(CSRF).expect(200);
    publicMembershipStatusResponse.strict().parse(status.body);
    expect(status.body).toMatchObject({ status: "PENDING", planName: "Club Premium", amount: 9990, checkoutUrl, periodEnd: null });
    expect(JSON.stringify(status.body)).not.toContain(email);
    await request(http).get(`/api/v1/public/memberships/purchases/${randomBytes(32).toString("base64url")}`).set(CSRF).expect(404);
  });

  it("el aviso firmado de un pago aprobado activa el periodo una sola vez, avisa por correo y da acceso", async () => {
    const b = await business();
    const created = await plan(b);
    const email = `socia-${unique("p")}${DOMAIN}`;
    const { purchase } = await buy(b, created.id, email);
    const paymentId = checkout.pay(purchase.id, { collectorId: b.account.providerUserId });

    // Sin firma válida no se lee nada.
    await webhook(purchase.id, paymentId, sign(paymentId, "otro-request")).expect(401);
    await webhook(purchase.id, paymentId, sign(paymentId, "x", "otra-clave-cualquiera-000000000")).expect(401);
    expect((await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: purchase.id } })).status).toBe("PENDING");

    emailAdapter.messages = [];
    expect((await webhook(purchase.id, paymentId).expect(200)).body).toEqual({ result: "paid" });
    const paid = await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(paid).toMatchObject({ status: "PAID", providerPaymentId: paymentId, paymentStatus: "approved" });
    expect(paid.periodEnd!.getTime() - paid.periodStart!.getTime()).toBe(30 * DAY);
    expect(await prisma.auditLog.count({ where: { organizationId: b.organizationId, action: "membership.purchase_paid", targetId: purchase.id } })).toBe(1);

    const mails = emailAdapter.messages.filter((m) => m.to === email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain("Club Premium");
    expect(mails[0]!.text).toMatch(/\/miembros\/[A-Za-z0-9_-]{43}/);

    // Con ese enlace entra y ve el contenido.
    const session = await enter(email);
    expect(JSON.stringify((await memberPage(b, session).expect(200)).body)).toContain(SECRET);

    // Mercado Pago repite el aviso: sin efecto ni correos nuevos.
    emailAdapter.messages = [];
    expect((await webhook(purchase.id, paymentId).expect(200)).body).toEqual({ result: "unchanged" });
    expect(emailAdapter.messages).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { organizationId: b.organizationId, action: "membership.purchase_paid", targetId: purchase.id } })).toBe(1);
  });

  it("un pago que no corresponde (monto, cuenta o pago ajeno) no activa nada", async () => {
    const b = await business();
    const created = await plan(b);
    const email = `socia-${unique("m")}${DOMAIN}`;
    const { purchase } = await buy(b, created.id, email);

    const wrongAmount = await pay(b, purchase.id, { amount: 100 });
    expect(wrongAmount.response.body).toEqual({ result: "mismatch" });
    const wrongCollector = await pay(b, purchase.id, { collectorId: "999999" });
    expect(wrongCollector.response.body).toEqual({ result: "mismatch" });
    // Un pago de otra cuenta (otro token) ni se ve con el token del negocio.
    const foreignId = checkout.pay(purchase.id, { collectorId: b.account.providerUserId, accessToken: "APP_USR-de-otra-cuenta" });
    expect((await webhook(purchase.id, foreignId)).body).toEqual({ result: "mismatch" });
    // Un pago aprobado de OTRA compra no sirve para esta.
    const another = await buy(b, created.id, `otra-${unique("m")}${DOMAIN}`);
    const otherPayment = checkout.pay(another.purchase.id, { collectorId: b.account.providerUserId });
    expect((await webhook(purchase.id, otherPayment)).body).toEqual({ result: "mismatch" });

    expect((await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: purchase.id } })).status).toBe("PENDING");
  });

  it("dos avisos simultáneos del mismo pago activan el periodo una sola vez", async () => {
    const b = await business();
    const created = await plan(b);
    const { purchase } = await buy(b, created.id, `socia-${unique("r")}${DOMAIN}`);
    const paymentId = checkout.pay(purchase.id, { collectorId: b.account.providerUserId });
    const results = await Promise.all([webhook(purchase.id, paymentId), webhook(purchase.id, paymentId)]);
    expect(results.map((res) => res.body.result).sort()).toEqual(["paid", "unchanged"]);
    expect(await prisma.auditLog.count({ where: { action: "membership.purchase_paid", targetId: purchase.id } })).toBe(1);
  });

  it("los periodos se apilan al renovar, vencen y se recuperan comprando de nuevo", async () => {
    const b = await business();
    const created = await plan(b);
    const email = `socia-${unique("a")}${DOMAIN}`;

    const first = await buy(b, created.id, email);
    await pay(b, first.purchase.id);
    const firstEnd = (await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: first.purchase.id } })).periodEnd!;

    // Renueva antes de vencer: el nuevo periodo empieza donde termina el vigente.
    const second = await buy(b, created.id, email);
    await pay(b, second.purchase.id);
    const secondRow = await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: second.purchase.id } });
    expect(secondRow.periodStart!.getTime()).toBe(firstEnd.getTime());
    expect(secondRow.periodEnd!.getTime()).toBe(firstEnd.getTime() + 30 * DAY);

    const session = await enter(email);
    await memberPage(b, session).expect(200);
    const list = await b.owner.agent.get(`${b.base}?search=${encodeURIComponent(email)}`).expect(200);
    expect(list.body.items[0]).toMatchObject({ source: "PURCHASED", status: "ACTIVE" });
    expect(new Date(list.body.items[0].paidUntil).getTime()).toBe(secondRow.periodEnd!.getTime());

    // Vence todo: la sesión sigue siendo válida pero el contenido pide renovar (403, no 401).
    await prisma.membershipPurchase.updateMany({ where: { memberId: first.purchase.memberId }, data: { periodEnd: new Date(Date.now() - 1000) } });
    const expired = await memberPage(b, session).expect(403);
    expect(expired.body.code).toBe("MEMBERSHIP_INACTIVE");
    await request(http).get(`/api/v1/public/sites/${b.siteSlug}/members/me`).set("x-member-session", session).expect(403);

    // Renueva: vuelve el acceso con la misma sesión.
    const third = await buy(b, created.id, email);
    await pay(b, third.purchase.id);
    await memberPage(b, session).expect(200);
    const thirdRow = await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: third.purchase.id } });
    // No había nada vigente: empieza ahora, no donde terminó el vencido.
    expect(Math.abs(thirdRow.periodStart!.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("un reembolso total corta el acceso; el ingreso del mes lo descuenta", async () => {
    const b = await business();
    const created = await plan(b);
    const email = `socia-${unique("d")}${DOMAIN}`;
    const { purchase } = await buy(b, created.id, email);
    const { paymentId } = await pay(b, purchase.id);
    const session = await enter(email);
    await memberPage(b, session).expect(200);

    let plans = await b.owner.agent.get(b.plans).expect(200);
    expect(plans.body.monthRevenue).toEqual([{ currency: "CLP", amount: 9990, purchases: 1 }]);
    expect(plans.body.plans[0].activeMembers).toBe(1);

    // El negocio devuelve el dinero desde Mercado Pago; el aviso lo registra.
    await checkout.refundPayment(b.account.accessToken, paymentId, undefined, unique("refund"));
    expect((await webhook(purchase.id, paymentId).expect(200)).body).toEqual({ result: "updated" });
    const row = await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(row).toMatchObject({ paymentStatus: "refunded", refundedAmount: 9990 });

    const denied = await memberPage(b, session).expect(403);
    expect(denied.body.code).toBe("MEMBERSHIP_INACTIVE");
    plans = await b.owner.agent.get(b.plans).expect(200);
    expect(plans.body.monthRevenue).toEqual([]);
    expect(plans.body.plans[0].activeMembers).toBe(0);
  });

  it("un miembro revocado no puede comprar, un plan archivado no se vende y una falla de la pasarela no deja nada a medias", async () => {
    const b = await business();
    const created = await plan(b);
    const revokedEmail = `revocada-${unique("v")}${DOMAIN}`;
    const member = await b.owner.agent.post(b.base).set(CSRF).send({ email: revokedEmail, sendAccess: false }).expect(201);
    await b.owner.agent.post(`${b.base}/${member.body.id}/revoke`).set(CSRF).expect(200);
    await startCheckout(b.siteSlug, created.id, { email: revokedEmail }).expect(409);
    expect(await prisma.membershipPurchase.count({ where: { memberId: member.body.id } })).toBe(0);

    const archived = await plan(b, { name: "Plan viejo" });
    await b.owner.agent.post(`${b.plans}/${archived.id}/archive`).set(CSRF).expect(200);
    await startCheckout(b.siteSlug, archived.id, { email: `n-${unique("a")}${DOMAIN}` }).expect(404);
    await startCheckout(b.siteSlug, "no-es-uuid", { email: `n-${unique("a")}${DOMAIN}` }).expect(404);

    checkout.failNextPreference = true;
    const failEmail = `falla-${unique("f")}${DOMAIN}`;
    await startCheckout(b.siteSlug, created.id, { email: failEmail }).expect(503);
    const failed = await prisma.membershipPurchase.findFirstOrThrow({ where: { member: { siteId: b.siteId, email: failEmail } } });
    expect(failed.status).toBe("EXPIRED");
    // Reintenta y funciona.
    await startCheckout(b.siteSlug, created.id, { email: failEmail }).expect(201);
  });

  it("un sitio despublicado o de una organización bloqueada no vende membresías", async () => {
    const b = await business();
    const created = await plan(b);
    await prisma.site.update({ where: { id: b.siteId }, data: { moderationHiddenAt: new Date() } });
    await startCheckout(b.siteSlug, created.id, { email: `s-${unique("h")}${DOMAIN}` }).expect(404);
    await request(http).get(`/api/v1/public/sites/${b.siteSlug}/members/plans`).expect(404);
  });
});
