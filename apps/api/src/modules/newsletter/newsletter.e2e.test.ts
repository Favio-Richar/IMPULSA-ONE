import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { newsletterStatsResponse, publicNewsletterConfirmationResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import { NEWSLETTER_MAX_EMAILS_PER_DAY } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { hashToken } from "./newsletter.service.js";

// F7.4 — newsletter con doble confirmación (ADR-019): la solicitud no crea contacto ni revela nada;
// confirmar con un clic crea el contacto con su consentimiento de marketing, etiqueta, historial y
// auditoría; vencidos, inválidos, topes, honeypot y aislamiento entre organizaciones.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@newsletter-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Newsletter con doble confirmación (e2e) — F7.4", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let httpServer: Parameters<typeof request>[0];
  const emailAdapter = new FakeEmailAdapter();

  beforeAll(async () => {
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
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  async function owner() {
    const email = `owner-${unique("u")}${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password: "password1234" }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password: "password1234" }).expect(201);
    return agent;
  }

  /** Organización con un sitio cuya página publicada ofrece la newsletter. */
  async function setup({ withBlock = true } = {}) {
    const agent = await owner();
    const org = (await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Café Aroma", slug: unique("org") }).expect(201)).body;
    const siteSlug = unique("site");
    const site = (await agent.post(`/api/v1/organizations/${org.id}/sites`).set(CSRF_HEADERS).send({ name: "Café Aroma Providencia", slug: siteSlug }).expect(201)).body;
    const pagesPath = `/api/v1/organizations/${org.id}/sites/${site.id}/pages`;
    const page = (await agent.get(pagesPath).expect(200)).body[0];
    if (withBlock) {
      await agent.post(`${pagesPath}/${page.id}/blocks`).set(CSRF_HEADERS).send({ type: "newsletter", config: { title: "Novedades" } }).expect(201);
    }
    await agent.post(`${pagesPath}/${page.id}/publish`).set(CSRF_HEADERS).expect(201);
    return { agent, organizationId: org.id as string, siteId: site.id as string, signup: `/api/v1/public/sites/${siteSlug}/newsletter` };
  }

  const linkTokenOf = (message: EmailMessage | undefined) => /\/suscripcion\/([A-Za-z0-9_-]+)/.exec(message?.text ?? "")?.[1];
  const subscriber = () => `lector-${unique("x")}@ejemplo.cl`;

  it("pedir no crea contacto y no revela nada; confirmar con un clic crea el contacto con su consentimiento", async () => {
    const { agent, organizationId, siteId, signup } = await setup();
    const email = subscriber();
    const sent = emailAdapter.messages.length;
    const response = await request(httpServer).post(signup).set(CSRF_HEADERS).send({ email: email.toUpperCase(), name: "Ana", consent: true }).expect(202);
    expect(response.body).toEqual({ status: "pending" });
    expect(await prisma.contact.count({ where: { organizationId, email } })).toBe(0);

    const mail = emailAdapter.messages.at(-1)!;
    expect(emailAdapter.messages.length).toBe(sent + 1);
    expect(mail).toMatchObject({ to: email, subject: "Confirma tu suscripción a Café Aroma Providencia" });
    const token = linkTokenOf(mail)!;
    expect(token).toBeDefined();
    // Solo el hash queda guardado.
    const row = await prisma.newsletterConfirmation.findFirstOrThrow({ where: { siteId, email } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);

    // Abrir el enlace no confirma: solo muestra a quién corresponde.
    const view = publicNewsletterConfirmationResponse.parse((await request(httpServer).get(`/api/v1/public/newsletter/${token}`).set(CSRF_HEADERS).expect(200)).body);
    expect(view).toEqual({ organizationName: "Café Aroma", siteName: "Café Aroma Providencia", maskedEmail: expect.stringMatching(/^le•••@ejemplo\.cl$/), state: "pending" });
    expect(await prisma.contact.count({ where: { organizationId, email } })).toBe(0);

    const confirmed = (await request(httpServer).post(`/api/v1/public/newsletter/${token}`).set(CSRF_HEADERS).expect(200)).body;
    expect(confirmed.state).toBe("confirmed");
    const contact = await prisma.contact.findFirstOrThrow({ where: { organizationId, email }, include: { events: true } });
    expect(contact).toMatchObject({
      name: "Ana",
      marketingConsentSource: `newsletter:${siteId}:double_opt_in`,
      marketingConsentTextVersion: "newsletter-v1",
      marketingUnsubscribedAt: null,
      tags: ["newsletter"],
    });
    expect(contact.marketingConsentAt).not.toBeNull();
    expect(contact.events.map((event) => event.type)).toEqual(["NEWSLETTER"]);
    expect(await prisma.auditLog.count({ where: { organizationId, action: "contact.newsletter_subscribed", targetId: contact.id } })).toBe(1);

    // Idempotente: otro clic no duplica nada.
    await request(httpServer).post(`/api/v1/public/newsletter/${token}`).set(CSRF_HEADERS).expect(200);
    expect(await prisma.contactEvent.count({ where: { contactId: contact.id, type: "NEWSLETTER" } })).toBe(1);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).tags).toEqual(["newsletter"]);

    // Y el panel lo cuenta.
    const stats = newsletterStatsResponse.parse((await agent.get(`/api/v1/organizations/${organizationId}/newsletter/stats`).expect(200)).body);
    expect(stats).toEqual({ marketingAudience: 1, confirmedSubscribers: 1, pendingConfirmations: 0, confirmedLast30Days: 1 });
  });

  it("a quien ya está suscrito le llega un aviso sin enlace, con la misma respuesta pública", async () => {
    const { organizationId, signup } = await setup();
    const email = subscriber();
    await request(httpServer).post(signup).set(CSRF_HEADERS).send({ email, consent: true }).expect(202);
    await request(httpServer).post(`/api/v1/public/newsletter/${linkTokenOf(emailAdapter.messages.at(-1))}`).set(CSRF_HEADERS).expect(200);

    const again = await request(httpServer).post(signup).set(CSRF_HEADERS).send({ email, consent: true }).expect(202);
    expect(again.body).toEqual({ status: "pending" });
    const notice = emailAdapter.messages.at(-1)!;
    expect(notice.subject).toBe("Ya estás suscrito a Café Aroma Providencia");
    expect(linkTokenOf(notice)).toBeUndefined();
    expect(await prisma.contact.count({ where: { organizationId, email } })).toBe(1);
  });

  it("una baja anterior se deja sin efecto solo al volver a confirmar", async () => {
    const { organizationId, signup } = await setup();
    const email = subscriber();
    await request(httpServer).post(signup).set(CSRF_HEADERS).send({ email, consent: true }).expect(202);
    await request(httpServer).post(`/api/v1/public/newsletter/${linkTokenOf(emailAdapter.messages.at(-1))}`).set(CSRF_HEADERS).expect(200);
    await prisma.contact.updateMany({ where: { organizationId, email }, data: { marketingUnsubscribedAt: new Date() } });

    await request(httpServer).post(signup).set(CSRF_HEADERS).send({ email, consent: true }).expect(202);
    const token = linkTokenOf(emailAdapter.messages.at(-1));
    expect(token).toBeDefined();
    expect((await prisma.contact.findFirstOrThrow({ where: { organizationId, email } })).marketingUnsubscribedAt).not.toBeNull();
    await request(httpServer).post(`/api/v1/public/newsletter/${token}`).set(CSRF_HEADERS).expect(200);
    expect((await prisma.contact.findFirstOrThrow({ where: { organizationId, email } })).marketingUnsubscribedAt).toBeNull();
  });

  it("valida en el servidor: casilla marcada de verdad y correo válido; honeypot silencioso; tope diario por dirección", async () => {
    const { siteId, signup } = await setup();
    await request(httpServer).post(signup).set(CSRF_HEADERS).send({ email: subscriber(), consent: false }).expect(400);
    await request(httpServer).post(signup).set(CSRF_HEADERS).send({ email: subscriber(), consent: "true" }).expect(400);
    await request(httpServer).post(signup).set(CSRF_HEADERS).send({ email: "no-es-correo", consent: true }).expect(400);

    const sent = emailAdapter.messages.length;
    const bot = subscriber();
    expect((await request(httpServer).post(signup).set(CSRF_HEADERS).send({ email: bot, consent: true, website: "https://spam.example" }).expect(202)).body).toEqual({ status: "pending" });
    expect(emailAdapter.messages.length).toBe(sent);
    expect(await prisma.newsletterConfirmation.count({ where: { siteId, email: bot } })).toBe(0);

    const target = subscriber();
    for (let attempt = 0; attempt < NEWSLETTER_MAX_EMAILS_PER_DAY + 2; attempt++) {
      await redis.del(...((await redis.keys("ratelimit:*")).concat("ratelimit:none")));
      await request(httpServer).post(signup).set(CSRF_HEADERS).send({ email: target, consent: true }).expect(202);
    }
    expect(emailAdapter.messages.filter((message) => message.to === target)).toHaveLength(NEWSLETTER_MAX_EMAILS_PER_DAY);
  });

  it("un sitio sin bloque de newsletter publicado no envía nada; enlaces vencidos e inválidos responden con su estado", async () => {
    const without = await setup({ withBlock: false });
    await request(httpServer).post(without.signup).set(CSRF_HEADERS).send({ email: subscriber(), consent: true }).expect(404);
    await request(httpServer).post("/api/v1/public/sites/no-existe-este-sitio/newsletter").set(CSRF_HEADERS).send({ email: subscriber(), consent: true }).expect(404);

    const { organizationId, signup } = await setup();
    const email = subscriber();
    await request(httpServer).post(signup).set(CSRF_HEADERS).send({ email, consent: true }).expect(202);
    const token = linkTokenOf(emailAdapter.messages.at(-1))!;
    await prisma.newsletterConfirmation.updateMany({ where: { tokenHash: hashToken(token) }, data: { createdAt: new Date(Date.now() - 72 * 3_600_000), expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(httpServer).get(`/api/v1/public/newsletter/${token}`).set(CSRF_HEADERS).expect(200)).body.state).toBe("expired");
    expect((await request(httpServer).post(`/api/v1/public/newsletter/${token}`).set(CSRF_HEADERS).expect(410)).body.code).toBe("NEWSLETTER_CONFIRMATION_EXPIRED");
    expect(await prisma.contact.count({ where: { organizationId, email } })).toBe(0);

    await request(httpServer).get(`/api/v1/public/newsletter/${"a".repeat(43)}`).set(CSRF_HEADERS).expect(404);
    await request(httpServer).post("/api/v1/public/newsletter/..%2F..%2Fadmin").set(CSRF_HEADERS).expect(404);
  });

  it("aislamiento (ADR-002): la confirmación crea el contacto solo en la organización del sitio, y otra no ve sus números", async () => {
    const a = await setup();
    const b = await setup();
    const email = subscriber();
    await request(httpServer).post(a.signup).set(CSRF_HEADERS).send({ email, consent: true }).expect(202);
    await request(httpServer).post(`/api/v1/public/newsletter/${linkTokenOf(emailAdapter.messages.at(-1))}`).set(CSRF_HEADERS).expect(200);
    expect(await prisma.contact.count({ where: { organizationId: a.organizationId, email } })).toBe(1);
    expect(await prisma.contact.count({ where: { organizationId: b.organizationId, email } })).toBe(0);
    await b.agent.get(`/api/v1/organizations/${a.organizationId}/newsletter/stats`).expect(403);
    expect((await b.agent.get(`/api/v1/organizations/${b.organizationId}/newsletter/stats`).expect(200)).body.confirmedSubscribers).toBe(0);
  });
});
