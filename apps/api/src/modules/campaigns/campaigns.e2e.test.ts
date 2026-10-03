import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { campaignAudienceResponse, campaignResponse, publicUnsubscribeResponse } from "@impulza/contracts";
import { signUnsubscribeToken, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";

// F5.6 — campañas: consentimiento de marketing aparte, segmento, saneo, prueba, envío congelado,
// una campaña a la vez, detener, baja firmada idempotente y permisos.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@campaigns-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Campañas de email (e2e) — F5.6", () => {
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

  async function loggedIn() {
    const email = `${unique("user")}${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    return { email, agent };
  }

  async function member(ownerAgent: ReturnType<typeof request.agent>, organizationId: string, role: string) {
    const user = await loggedIn();
    const invite = await ownerAgent.post(`/api/v1/organizations/${organizationId}/members`).set(CSRF).send({ email: user.email, role }).expect(201);
    await user.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
    return user.agent;
  }

  async function setup() {
    const owner = await loggedIn();
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Tienda Lumen", slug: unique("org") }).expect(201);
    await assignRoomyPlan(prisma, org.body.id);
    const organizationId = org.body.id as string;
    const now = new Date();
    const contact = (email: string, data: Record<string, unknown> = {}) =>
      prisma.contact.create({ data: { organizationId, email: `${email}-${unique("c")}${TEST_EMAIL_DOMAIN}`, ...data } });
    const vip = await contact("vip", { marketingConsentAt: now, tags: ["vip"], source: "form:x" });
    const plain = await contact("plain", { marketingConsentAt: now, tags: ["nuevo"], commercialStatus: "WON" });
    await contact("sin-marketing", { consentStatus: "GRANTED", tags: ["vip"] });
    await contact("baja", { marketingConsentAt: now, marketingUnsubscribedAt: now, tags: ["vip"] });
    return { owner: owner.agent, ownerEmail: owner.email, organizationId, base: `/api/v1/organizations/${organizationId}/campaigns`, vip, plain };
  }

  const draft = { name: "Otoño", subject: "Llegaron las velas de otoño", bodyHtml: '<p>Hola</p><script>alert(1)</script><p><a href="javascript:alert(1)">x</a></p>' };

  it("la audiencia solo cuenta a quienes aceptaron marketing y no se dieron de baja, filtrada por segmento", async () => {
    const { owner, base } = await setup();
    const all = campaignAudienceResponse.parse((await owner.post(`${base}/audience`).set(CSRF).send({}).expect(200)).body);
    expect(all).toEqual({ eligible: 2, withMarketingConsent: 2, totalContacts: 4 });
    expect((await owner.post(`${base}/audience`).set(CSRF).send({ tags: ["vip"] }).expect(200)).body.eligible).toBe(1);
    expect((await owner.post(`${base}/audience`).set(CSRF).send({ commercialStatuses: ["WON"] }).expect(200)).body.eligible).toBe(1);
    expect((await owner.post(`${base}/audience`).set(CSRF).send({ tags: ["vip"], commercialStatuses: ["WON"] }).expect(200)).body.eligible).toBe(0);
    await owner.post(`${base}/audience`).set(CSRF).send({ commercialStatuses: ["NADA"] }).expect(400);
    const options = (await owner.get(`${base}/segment-options`).expect(200)).body;
    expect(options.tags).toEqual(["nuevo", "vip"]);
    expect(options.sources).toEqual(["form:x"]);
  });

  it("crea un borrador saneado, envía una prueba al autor y al enviar congela la lista; el worker hace el resto", async () => {
    const { owner, ownerEmail, base, vip, plain } = await setup();
    const created = campaignResponse.strict().parse((await owner.post(base).set(CSRF).send(draft).expect(201)).body);
    expect(created.bodyHtml).not.toContain("<script");
    expect(created.bodyHtml).not.toContain("javascript:");
    expect(created.status).toBe("DRAFT");

    await owner.post(`${base}/${created.id}/test`).set(CSRF).expect(204);
    const test = emailAdapter.messages.at(-1)!;
    expect(test.to).toBe(ownerEmail);
    expect(test.subject).toBe("[Prueba] Llegaron las velas de otoño");
    expect(await prisma.campaignRecipient.count({ where: { campaignId: created.id } })).toBe(0);

    const sending = campaignResponse.parse((await owner.post(`${base}/${created.id}/send`).set(CSRF).expect(200)).body);
    expect(sending).toMatchObject({ status: "SENDING", recipientCount: 2, stats: { pending: 2, sent: 0 } });
    expect(sending.emailsPerHour).not.toBeUndefined();
    const recipients = await prisma.campaignRecipient.findMany({ where: { campaignId: created.id }, select: { contactId: true } });
    expect(recipients.map((r) => r.contactId).sort()).toEqual([vip.id, plain.id].sort());
    // La API nunca envía la campaña real: solo hubo la prueba.
    expect(emailAdapter.messages.filter((m) => m.subject === "Llegaron las velas de otoño")).toEqual([]);

    // Ya no es un borrador: no se edita, no se borra, no se vuelve a enviar.
    await owner.patch(`${base}/${created.id}`).set(CSRF).send({ subject: "Otro" }).expect(409);
    await owner.delete(`${base}/${created.id}`).set(CSRF).expect(409);
    await owner.post(`${base}/${created.id}/send`).set(CSRF).expect(409);
  });

  it("una campaña a la vez; detener deja lo pendiente sin enviar; sin audiencia no se envía", async () => {
    const { owner, base, organizationId } = await setup();
    const first = (await owner.post(base).set(CSRF).send(draft).expect(201)).body;
    const second = (await owner.post(base).set(CSRF).send({ ...draft, name: "Segunda" }).expect(201)).body;
    const empty = (await owner.post(base).set(CSRF).send({ ...draft, name: "Nadie", segment: { tags: ["no-existe"] } }).expect(201)).body;
    await owner.post(`${base}/${empty.id}/send`).set(CSRF).expect(422);

    await owner.post(`${base}/${first.id}/send`).set(CSRF).expect(200);
    await owner.post(`${base}/${second.id}/send`).set(CSRF).expect(409);
    const stopped = campaignResponse.parse((await owner.post(`${base}/${first.id}/cancel`).set(CSRF).expect(200)).body);
    expect(stopped).toMatchObject({ status: "CANCELLED", stats: { pending: 0, skipped: 2 } });
    await owner.post(`${base}/${first.id}/cancel`).set(CSRF).expect(409);
    await owner.post(`${base}/${second.id}/send`).set(CSRF).expect(200);
    const actions = (await prisma.auditLog.findMany({ where: { organizationId, action: { startsWith: "campaign." } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["campaign.created", "campaign.send_started", "campaign.cancelled"]));
  });

  it("el enlace de baja firmado se respeta de inmediato y es idempotente; uno alterado da 404", async () => {
    const { owner, base, vip } = await setup();
    const campaign = (await owner.post(base).set(CSRF).send(draft).expect(201)).body;
    await owner.post(`${base}/${campaign.id}/send`).set(CSRF).expect(200);
    const recipient = await prisma.campaignRecipient.findFirstOrThrow({ where: { campaignId: campaign.id, contactId: vip.id } });
    const token = signUnsubscribeToken(recipient.id, env.BOOKING_LINK_SECRET!);

    const view = publicUnsubscribeResponse.strict().parse((await request(httpServer).get(`/api/v1/public/unsubscribe/${token}`).expect(200)).body);
    expect(view).toMatchObject({ organizationName: "Tienda Lumen", unsubscribed: false });
    expect(view.maskedEmail).toMatch(/^vi•••@campaigns-e2e\.test$/);
    expect(JSON.stringify(view)).not.toContain(recipient.id);

    await request(httpServer).post(`/api/v1/public/unsubscribe/${token}`).expect(403);
    await request(httpServer).post(`/api/v1/public/unsubscribe/${token}`).set(CSRF).expect(200);
    await request(httpServer).post(`/api/v1/public/unsubscribe/${token}`).set(CSRF).expect(200);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: vip.id } })).marketingUnsubscribedAt).not.toBeNull();
    expect((await owner.post(`${base}/audience`).set(CSRF).send({}).expect(200)).body.eligible).toBe(1);
    expect((await owner.get(`${base}/${campaign.id}`).expect(200)).body.stats.unsubscribed).toBe(1);

    await request(httpServer).get(`/api/v1/public/unsubscribe/${token}x`).expect(404);
    await request(httpServer).get("/api/v1/public/unsubscribe/no-es-un-token").expect(404);
  });

  it("solo OWNER y ADMIN crean y envían; un EDITOR o un ANALYST solo miran", async () => {
    const { owner, base, organizationId } = await setup();
    const campaign = (await owner.post(base).set(CSRF).send(draft).expect(201)).body;
    for (const role of ["EDITOR", "ANALYST"]) {
      const agent = await member(owner, organizationId, role);
      await agent.get(base).expect(200);
      await agent.post(base).set(CSRF).send(draft).expect(403);
      await agent.post(`${base}/${campaign.id}/send`).set(CSRF).expect(403);
      await agent.post(`${base}/${campaign.id}/test`).set(CSRF).expect(403);
    }
    const admin = await member(owner, organizationId, "ADMIN");
    await admin.post(`${base}/${campaign.id}/send`).set(CSRF).expect(200);
  });

  it("la casilla de marketing de un pedido registra el consentimiento aparte; sin marcarla, no", async () => {
    const { owner, organizationId } = await setup();
    const site = await owner.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Lumen", slug: unique("sitio") }).expect(201);
    const product = await owner
      .post(`/api/v1/organizations/${organizationId}/sites/${site.body.id}/catalog/products`)
      .set(CSRF)
      .send({ name: "Guía", kind: "DIGITAL", priceAmount: 1000, priceCurrency: "CLP" })
      .expect(201);
    const order = (email: string, marketingConsent?: boolean) =>
      request(httpServer)
        .post(`/api/v1/public/sites/${site.body.slug}/catalog/orders`)
        .set(CSRF)
        .send({ productId: product.body.id, quantity: 1, name: "Ana", email, consent: true, ...(marketingConsent === undefined ? {} : { marketingConsent }) })
        .expect(201);
    const yes = `si-${unique("m")}${TEST_EMAIL_DOMAIN}`;
    const no = `no-${unique("m")}${TEST_EMAIL_DOMAIN}`;
    await order(yes, true);
    await order(no);
    const withConsent = await prisma.contact.findFirstOrThrow({ where: { organizationId, email: yes } });
    expect(withConsent.marketingConsentAt).not.toBeNull();
    expect(withConsent.marketingConsentSource).toBe(`order:${site.body.id}`);
    expect(withConsent.marketingConsentTextVersion).toBe("marketing-v1");
    expect((await prisma.contact.findFirstOrThrow({ where: { organizationId, email: no } })).marketingConsentAt).toBeNull();
  });

  it("F9.2: el correo de la campaña sale con el nombre, el logo y el color de la marca de la organización", async () => {
    const { owner, base, organizationId } = await setup();
    const logo = `https://media.test/branding/org/${organizationId}/logo_light-1.png`;
    await prisma.brandProfile.upsert({
      where: { organizationId },
      update: { displayName: "Velas Lumen", logoLightUrl: logo, primaryColor: "#1d4ed8", contactEmail: "hola@velaslumen.cl" },
      create: { organizationId, displayName: "Velas Lumen", logoLightUrl: logo, primaryColor: "#1d4ed8", contactEmail: "hola@velaslumen.cl" },
    });
    const created = campaignResponse.parse((await owner.post(base).set(CSRF).send(draft).expect(201)).body);

    await owner.post(`${base}/${created.id}/test`).set(CSRF).expect(204);
    const test = emailAdapter.messages.at(-1)!;
    expect(test.from).toEqual({ name: "Velas Lumen", email: null }); // sin dominio verificado: remitente de la plataforma
    expect(test.html).toContain(`<img src="${logo}"`);
    expect(test.html).toContain("Velas Lumen");
    expect(test.html).toContain("#1d4ed8");
    expect(test.html).toContain("hola@velaslumen.cl");
    expect(test.text).not.toContain("<img"); // la parte de texto no cambia
  });

  it("F9.2: una organización sin marca propia envía con el nombre de la plataforma, nunca con el logo de otra organización", async () => {
    const { owner, base } = await setup();
    const created = campaignResponse.parse((await owner.post(base).set(CSRF).send(draft).expect(201)).body);
    await owner.post(`${base}/${created.id}/test`).set(CSRF).expect(204);
    const test = emailAdapter.messages.at(-1)!;
    expect(test.from?.name).toBeTruthy();
    expect(test.html).not.toContain("branding/org/");
  });
});
