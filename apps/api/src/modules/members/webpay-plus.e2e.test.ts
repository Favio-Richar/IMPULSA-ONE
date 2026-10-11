import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { encryptSecret, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { membershipCheckoutResponse, paymentAccountsResponse, publicMembershipPlansResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { FakeMercadoPagoCheckout, FakeWebpayPlus, WEBPAY_PLUS_INTEGRATION_CREDENTIALS } from "@impulza/payments";
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
import { MERCADO_PAGO_CHECKOUT, WEBPAY_PLUS_GATEWAY } from "../payment-accounts/checkout.tokens.js";

// F10.2c (ADR-030) — Webpay Plus como medio de cobro del negocio: conexión de la cuenta con sus propias credenciales y compra de una
// membresía con confirmación hecha por el servidor al volver el comprador.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@webpay-plus-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const SECRET = "CONTENIDO-SOLO-PARA-SOCIOS-WEBPAY";
const DAY = 86_400_000;
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;
const CREDENTIALS = { commerceCode: WEBPAY_PLUS_INTEGRATION_CREDENTIALS.commerceCode, apiKeySecret: WEBPAY_PLUS_INTEGRATION_CREDENTIALS.apiKeySecret, environment: "integration" };

describe("Webpay Plus del negocio (e2e) — F10.2c / ADR-030", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let webpay: FakeWebpayPlus;
  let mercadoPago: FakeMercadoPagoCheckout;
  let http: Parameters<typeof request>[0];

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
      .useValue({ checkout: mercadoPago, webhookSecret: "clave-de-firma-de-la-app-de-pruebas-0000" })
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
    webpay.rejectedCommerceCodes.clear();
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

  async function business(options: { webpay?: boolean; mercadoPago?: boolean } = {}) {
    const owner = await person("owner");
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Club Webpay", slug: unique("wp-org") }).expect(201);
    const organizationId = org.body.id as string;
    await assignRoomyPlan(prisma, organizationId);
    const siteSlug = unique("wp-site");
    const site = await owner.agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Club Webpay", slug: siteSlug }).expect(201);
    const siteId = site.body.id as string;
    const pagesPath = `/api/v1/organizations/${organizationId}/sites/${siteId}/pages`;
    const home = (await owner.agent.get(pagesPath).expect(200)).body[0] as { id: string; slug: string };
    await owner.agent.post(`${pagesPath}/${home.id}/blocks`).set(CSRF).send({ type: "text", config: { html: `<p>${SECRET}</p>`, alignment: "left" } }).expect(201);
    await owner.agent.post(`${pagesPath}/${home.id}/publish`).set(CSRF).expect(201);
    const base = `/api/v1/organizations/${organizationId}/sites/${siteId}/members`;
    await owner.agent.put(`${base}/pages/${home.id}`).set(CSRF).send({ enabled: true }).expect(200);

    if (options.mercadoPago) {
      await prisma.paymentAccount.create({
        data: {
          organizationId,
          provider: "MERCADO_PAGO",
          providerUserId: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
          accessTokenEncrypted: encryptSecret(`APP_USR-${randomBytes(12).toString("hex")}`, env.AUTH_ENCRYPTION_KEY),
          refreshTokenEncrypted: encryptSecret("TG-refresh-de-pruebas", env.AUTH_ENCRYPTION_KEY),
          expiresAt: new Date(Date.now() + 90 * DAY),
          liveMode: false,
        },
      });
    }
    if (options.webpay !== false) {
      await owner.agent.put(`/api/v1/organizations/${organizationId}/payment-accounts/webpay-plus`).set(CSRF).send(CREDENTIALS).expect(204);
    }
    return { owner, organizationId, siteId, siteSlug, pageSlug: home.slug, base, plans: `${base}/plans`, accounts: `/api/v1/organizations/${organizationId}/payment-accounts` };
  }

  async function plan(b: Awaited<ReturnType<typeof business>>) {
    const res = await b.owner.agent.post(b.plans).set(CSRF).send({ name: "Club Premium", priceAmount: 9990, priceCurrency: "CLP", period: "MONTHLY" }).expect(201);
    return res.body.id as string;
  }

  const startCheckout = (siteSlug: string, planId: string, body: Record<string, unknown>) =>
    request(http).post(`/api/v1/public/sites/${siteSlug}/members/plans/${planId}/checkout`).set(CSRF).send(body);

  async function buyWithWebpay(b: Awaited<ReturnType<typeof business>>, planId: string, email: string) {
    const res = await startCheckout(b.siteSlug, planId, { email, name: "Socia Webpay", provider: "WEBPAY_PLUS" }).expect(201);
    membershipCheckoutResponse.parse(res.body);
    const purchase = await prisma.membershipPurchase.findFirstOrThrow({ where: { member: { siteId: b.siteId, email } }, orderBy: { createdAt: "desc" } });
    const statusToken = /\/membresia\/([A-Za-z0-9_-]+)$/.exec(res.body.statusUrl as string)![1]!;
    return { purchase, statusToken, token: res.body.fields.token_ws as string, body: res.body as { checkoutUrl: string; statusUrl: string; method: string; fields: Record<string, string> } };
  }

  const returnUrl = (purchaseId: string, statusToken: string) => `/api/v1/payments/webpay/memberships/${purchaseId}/return?t=${encodeURIComponent(statusToken)}`;

  it("conectar: se comprueban las credenciales con Transbank, la llave queda cifrada y nunca vuelve a salir", async () => {
    const b = await business({ webpay: false });
    const before = await b.owner.agent.get(b.accounts).expect(200);
    paymentAccountsResponse.parse(before.body);
    expect(before.body.webpayPlus).toBeNull();

    emailAdapter.messages = [];
    await b.owner.agent.put(`${b.accounts}/webpay-plus`).set(CSRF).send(CREDENTIALS).expect(204);

    const after = await b.owner.agent.get(b.accounts).expect(200);
    paymentAccountsResponse.parse(after.body);
    expect(after.body.webpayPlus).toMatchObject({ status: "CONNECTED", liveMode: false, commerceCodeLast4: CREDENTIALS.commerceCode.slice(-4) });
    expect(JSON.stringify(after.body)).not.toContain(CREDENTIALS.apiKeySecret);
    expect(JSON.stringify(after.body)).not.toContain(CREDENTIALS.commerceCode);

    const row = await prisma.paymentAccount.findUniqueOrThrow({ where: { organizationId_provider: { organizationId: b.organizationId, provider: "WEBPAY_PLUS" } } });
    expect(row.accessTokenEncrypted).not.toContain(CREDENTIALS.apiKeySecret);
    expect(row).toMatchObject({ providerUserId: CREDENTIALS.commerceCode, liveMode: false, status: "CONNECTED" });
    expect(row.expiresAt.getFullYear()).toBeGreaterThan(2900);

    const audit = await prisma.auditLog.findMany({ where: { organizationId: b.organizationId, action: "payments.account_connected" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(CREDENTIALS.apiKeySecret);
    // La prueba contra Transbank no cobra nada: es una transacción pequeña que no se paga.
    expect(webpay.created.at(-1)).toMatchObject({ commerceCode: CREDENTIALS.commerceCode, amount: 50 });
  });

  it("valida la forma en el servidor, rechaza credenciales que Transbank no acepta y no guarda nada si Transbank no responde", async () => {
    const b = await business({ webpay: false });
    const url = `${b.accounts}/webpay-plus`;
    await b.owner.agent.put(url).set(CSRF).send({ ...CREDENTIALS, commerceCode: "12345" }).expect(400);
    await b.owner.agent.put(url).set(CSRF).send({ ...CREDENTIALS, apiKeySecret: "corta" }).expect(400);
    await b.owner.agent.put(url).set(CSRF).send({ ...CREDENTIALS, apiKeySecret: `${"a".repeat(31)}-` }).expect(400);
    await b.owner.agent.put(url).set(CSRF).send({ ...CREDENTIALS, environment: "sandbox" }).expect(400);
    await b.owner.agent.put(url).set(CSRF).send({ ...CREDENTIALS, extra: 1 }).expect(400);

    webpay.rejectedCommerceCodes.add(CREDENTIALS.commerceCode);
    const rejected = await b.owner.agent.put(url).set(CSRF).send(CREDENTIALS).expect(422);
    expect(rejected.body.code).toBe("WEBPAY_CREDENTIALS_REJECTED");
    webpay.rejectedCommerceCodes.clear();

    webpay.failNextCreate = true;
    const down = await b.owner.agent.put(url).set(CSRF).send(CREDENTIALS).expect(422);
    expect(down.body.code).toBe("WEBPAY_UNAVAILABLE");
    expect(await prisma.paymentAccount.count({ where: { organizationId: b.organizationId, provider: "WEBPAY_PLUS" } })).toBe(0);
  });

  it("solo quien tiene permiso de cobros conecta o desconecta; desconectar borra las credenciales", async () => {
    const b = await business();
    const editor = await person("editor");
    const invite = await b.owner.agent.post(`/api/v1/organizations/${b.organizationId}/members`).set(CSRF).send({ email: editor.email, role: "EDITOR" }).expect(201);
    await editor.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);

    await request(http).put(`${b.accounts}/webpay-plus`).set(CSRF).send(CREDENTIALS).expect(401);
    await editor.agent.put(`${b.accounts}/webpay-plus`).set(CSRF).send(CREDENTIALS).expect(403);
    await editor.agent.delete(`${b.accounts}/webpay-plus`).set(CSRF).expect(403);
    const other = await person("otro");
    await other.agent.put(`${b.accounts}/webpay-plus`).set(CSRF).send(CREDENTIALS).expect(403);

    await b.owner.agent.delete(`${b.accounts}/webpay-plus`).set(CSRF).expect(204);
    expect(await prisma.paymentAccount.count({ where: { organizationId: b.organizationId, provider: "WEBPAY_PLUS" } })).toBe(0);
    await b.owner.agent.delete(`${b.accounts}/webpay-plus`).set(CSRF).expect(404);
  });

  it("el visitante ve los medios que el negocio conectó y no puede elegir uno que no tiene", async () => {
    const onlyWebpay = await business();
    const planId = await plan(onlyWebpay);
    const plans = await request(http).get(`/api/v1/public/sites/${onlyWebpay.siteSlug}/members/plans`).expect(200);
    publicMembershipPlansResponse.parse(plans.body);
    expect(plans.body).toMatchObject({ checkoutAvailable: true, providers: ["WEBPAY_PLUS"] });
    await startCheckout(onlyWebpay.siteSlug, planId, { email: `a-${unique("p")}${DOMAIN}`, provider: "MERCADO_PAGO" }).expect(503);

    const both = await business({ mercadoPago: true });
    const bothPlan = await plan(both);
    const bothPlans = await request(http).get(`/api/v1/public/sites/${both.siteSlug}/members/plans`).expect(200);
    expect(bothPlans.body.providers).toEqual(["MERCADO_PAGO", "WEBPAY_PLUS"]);
    // Sin elegir, el primero disponible; eligiendo, el elegido.
    const defaulted = await startCheckout(both.siteSlug, bothPlan, { email: `d-${unique("p")}${DOMAIN}` }).expect(201);
    expect(defaulted.body.provider).toBe("MERCADO_PAGO");
    const chosen = await startCheckout(both.siteSlug, bothPlan, { email: `c-${unique("p")}${DOMAIN}`, provider: "WEBPAY_PLUS" }).expect(201);
    expect(chosen.body).toMatchObject({ provider: "WEBPAY_PLUS", method: "POST" });
    expect(chosen.body.fields.token_ws).toMatch(/^[0-9a-f]{40,}$/);
    expect(chosen.body.checkoutUrl).toMatch(/^https:\/\/webpay3gint\.transbank\.cl\//);
  });

  it("la compra crea la transacción en el comercio del negocio con el precio del plan y una orden de compra corta", async () => {
    const b = await business();
    const planId = await plan(b);
    const email = `socia-${unique("w")}${DOMAIN}`;
    const { purchase, statusToken, token, body } = await buyWithWebpay(b, planId, email);

    const created = webpay.created.find((item) => item.token === token)!;
    expect(created).toMatchObject({ commerceCode: CREDENTIALS.commerceCode, amount: 9990, sessionId: purchase.id });
    expect(created.buyOrder).toMatch(/^M[A-Za-z0-9]{1,25}$/);
    expect(created.returnUrl).toBe(`${env.API_PUBLIC_URL}${returnUrl(purchase.id, statusToken)}`);
    expect(body).toMatchObject({ provider: "WEBPAY_PLUS", method: "POST" });
    expect(purchase).toMatchObject({ paymentProvider: "WEBPAY_PLUS", status: "PENDING", amount: 9990, checkoutPreferenceId: token, providerOrderRef: created.buyOrder });

    // El enlace «Tu membresía» de una compra Webpay pendiente no ofrece un GET de pago (Webpay exige un POST con el token).
    const status = await request(http).get(`/api/v1/public/memberships/purchases/${statusToken}`).set(CSRF).expect(200);
    expect(status.body).toMatchObject({ status: "PENDING", checkoutUrl: null });
  });

  it("al volver el comprador, el servidor confirma, activa el periodo una sola vez, avisa y da acceso", async () => {
    const b = await business();
    const planId = await plan(b);
    const email = `socia-${unique("r")}${DOMAIN}`;
    const { purchase, statusToken, token } = await buyWithWebpay(b, planId, email);
    webpay.pay(token);
    emailAdapter.messages = [];

    const back = await request(http).get(returnUrl(purchase.id, statusToken)).query({ token_ws: token }).expect(303);
    expect(back.headers.location).toBe(`${env.PUBLIC_SITE_BASE_URL}/membresia/${statusToken}`);
    expect(back.headers["cache-control"]).toBe("no-store");

    const paid = await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(paid).toMatchObject({ status: "PAID", paymentStatus: "approved", paymentProvider: "WEBPAY_PLUS" });
    expect(paid.providerPaymentId).toBe(`webpay:${paid.providerOrderRef}`);
    expect(paid.periodEnd!.getTime() - paid.periodStart!.getTime()).toBe(30 * DAY);
    expect(await prisma.auditLog.count({ where: { organizationId: b.organizationId, action: "membership.purchase_paid", targetId: purchase.id } })).toBe(1);

    const mails = emailAdapter.messages.filter((m) => m.to === email);
    expect(mails).toHaveLength(1);
    const link = /\/miembros\/([A-Za-z0-9_-]{43})/.exec(mails[0]!.text ?? "")?.[1];
    expect(link).toBeTruthy();
    const session = await request(http).post("/api/v1/public/members/verify").set(CSRF).send({ token: link }).expect(200);
    const content = await request(http).get(`/api/v1/public/sites/${b.siteSlug}/members/pages/${b.pageSlug}`).set("x-member-session", session.body.sessionToken).expect(200);
    expect(JSON.stringify(content.body)).toContain(SECRET);

    // Recargar la URL de regreso, o que Transbank la repita: sin efecto ni correos nuevos.
    emailAdapter.messages = [];
    await request(http).get(returnUrl(purchase.id, statusToken)).query({ token_ws: token }).expect(303);
    await request(http).post(returnUrl(purchase.id, statusToken)).type("form").send({ token_ws: token }).expect(303);
    expect(emailAdapter.messages).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: "membership.purchase_paid", targetId: purchase.id } })).toBe(1);
  });

  it("Transbank vuelve por POST con el token en el cuerpo del formulario", async () => {
    const b = await business();
    const planId = await plan(b);
    const { purchase, statusToken, token } = await buyWithWebpay(b, planId, `socia-${unique("f")}${DOMAIN}`);
    webpay.pay(token);
    await request(http).post(returnUrl(purchase.id, statusToken)).type("form").send({ token_ws: token }).expect(303);
    expect((await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: purchase.id } })).status).toBe("PAID");
  });

  it("un token ajeno, un abandono o un enlace que no corresponde no activan nada", async () => {
    const b = await business();
    const planId = await plan(b);
    const mine = await buyWithWebpay(b, planId, `socia-${unique("a")}${DOMAIN}`);
    const other = await buyWithWebpay(b, planId, `otra-${unique("a")}${DOMAIN}`);
    webpay.pay(other.token);

    // El token de OTRA compra no sirve para esta.
    await request(http).get(returnUrl(mine.purchase.id, mine.statusToken)).query({ token_ws: other.token }).expect(303);
    expect((await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: mine.purchase.id } })).status).toBe("PENDING");
    expect((await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: other.purchase.id } })).status).toBe("PENDING");
    // Y, sobre todo, la transacción ajena NO se confirmó (una confirmación consume el token de quien sí la pagó).
    expect(webpay.isCommitted(other.token)).toBe(false);

    // Abandonó: Transbank manda TBK_TOKEN y no hay nada que confirmar.
    await request(http).get(returnUrl(mine.purchase.id, mine.statusToken)).query({ TBK_TOKEN: mine.token, TBK_ORDEN_COMPRA: "x" }).expect(303);
    expect((await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: mine.purchase.id } })).status).toBe("PENDING");

    // Una forma que no puede ser un token tampoco consulta nada.
    await request(http).get(returnUrl(mine.purchase.id, mine.statusToken)).query({ token_ws: "'; DROP TABLE x;--" }).expect(303);

    // Un enlace «Tu membresía» que no es el de la compra, o una compra inexistente: 404 sin pistas.
    await request(http).get(returnUrl(mine.purchase.id, other.statusToken)).query({ token_ws: mine.token }).expect(404);
    await request(http).get(returnUrl(mine.purchase.id, "x")).query({ token_ws: mine.token }).expect(404);
    await request(http).get(returnUrl("00000000-0000-4000-8000-000000000000", mine.statusToken)).query({ token_ws: mine.token }).expect(404);
    await request(http).get(returnUrl("no-es-uuid", mine.statusToken)).expect(404);
  });

  it("una tarjeta rechazada deja la compra pendiente con su motivo y se puede reintentar; un monto distinto no se aplica", async () => {
    const b = await business();
    const planId = await plan(b);
    const email = `socia-${unique("x")}${DOMAIN}`;
    const declined = await buyWithWebpay(b, planId, email);
    webpay.pay(declined.token, { status: "FAILED", responseCode: -1 });
    await request(http).get(returnUrl(declined.purchase.id, declined.statusToken)).query({ token_ws: declined.token }).expect(303);
    const row = await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: declined.purchase.id } });
    expect(row).toMatchObject({ status: "PENDING", paymentStatus: "rejected", providerPaymentId: null });

    // Reintenta desde el sitio y esta vez paga.
    const retry = await buyWithWebpay(b, planId, email);
    webpay.pay(retry.token);
    await request(http).get(returnUrl(retry.purchase.id, retry.statusToken)).query({ token_ws: retry.token }).expect(303);
    expect((await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: retry.purchase.id } })).status).toBe("PAID");

    // Un pago por un monto distinto del plan nunca activa nada.
    const tampered = await buyWithWebpay(b, planId, `socia-${unique("y")}${DOMAIN}`);
    webpay.pay(tampered.token, { amount: 100 });
    await request(http).get(returnUrl(tampered.purchase.id, tampered.statusToken)).query({ token_ws: tampered.token }).expect(303);
    expect((await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: tampered.purchase.id } })).status).toBe("PENDING");
  });

  it("dos regresos simultáneos del mismo token activan el periodo una sola vez", async () => {
    const b = await business();
    const planId = await plan(b);
    const { purchase, statusToken, token } = await buyWithWebpay(b, planId, `socia-${unique("c")}${DOMAIN}`);
    webpay.pay(token);
    emailAdapter.messages = [];
    const results = await Promise.all(Array.from({ length: 4 }, () => request(http).get(returnUrl(purchase.id, statusToken)).query({ token_ws: token })));
    expect(results.every((res) => res.status === 303)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "membership.purchase_paid", targetId: purchase.id } })).toBe(1);
    expect((await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: purchase.id } })).status).toBe("PAID");
  });

  it("las credenciales de un negocio no confirman la transacción de otro", async () => {
    const a = await business();
    const planId = await plan(a);
    const { purchase, statusToken, token } = await buyWithWebpay(a, planId, `socia-${unique("z")}${DOMAIN}`);
    webpay.pay(token);
    // El negocio cambia a otro comercio: la transacción creada con el anterior ya no es suya para Transbank.
    await a.owner.agent.put(`${a.accounts}/webpay-plus`).set(CSRF).send({ ...CREDENTIALS, commerceCode: "597055555599" }).expect(204);
    await request(http).get(returnUrl(purchase.id, statusToken)).query({ token_ws: token }).expect(303);
    expect((await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: purchase.id } })).status).toBe("PENDING");
  });
});
