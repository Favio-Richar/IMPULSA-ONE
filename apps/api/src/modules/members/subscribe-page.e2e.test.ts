import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { freeSubscribeResponse, publicSubscribePageResponse, subscribePageAdminResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// Página de suscripción del sitio: el negocio la personaliza, la persona se suscribe gratis (miembro FREE con enlace por
// correo) o elige un plan de pago (eso ya lo cubren las pruebas de membresías).

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@subscribe-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Página de suscripción (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let http: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EMAIL_ADAPTER).useValue(emailAdapter).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  async function business() {
    const email = `${unique("owner")}${DOMAIN}`;
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(http);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const org = await agent.post("/api/v1/organizations").set(CSRF).send({ name: "Creador", slug: unique("sub-org") }).expect(201);
    const organizationId = org.body.id as string;
    const siteSlug = unique("sub-site");
    const site = await agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Portal", slug: siteSlug }).expect(201);
    const siteId = site.body.id as string;
    // El sitio tiene que estar publicado para que el público lo vea.
    const pagesPath = `/api/v1/organizations/${organizationId}/sites/${siteId}/pages`;
    const home = (await agent.get(pagesPath).expect(200)).body[0] as { id: string };
    await agent.post(`${pagesPath}/${home.id}/publish`).set(CSRF).expect(201);
    return { agent, organizationId, siteId, siteSlug, panel: `/api/v1/organizations/${organizationId}/sites/${siteId}/subscribe-page` };
  }

  const PAGE = { enabled: true, title: "Únete a mi comunidad", description: "Contenido semanal.", benefits: ["Clases en vivo", "Recursos descargables"], freeEnabled: true };

  async function lastLinkFor(to: string): Promise<string | null> {
    for (let i = 0; i < 20; i += 1) {
      const message = [...emailAdapter.messages].reverse().find((item) => item.to === to);
      const token = /\/miembros\/([A-Za-z0-9_-]{43})/.exec(message?.text ?? "")?.[1];
      if (token) return token;
      await wait(50);
    }
    return null;
  }

  it("el negocio crea y edita su página, y vuelve a leerla", async () => {
    const b = await business();
    const empty = subscribePageAdminResponse.parse((await b.agent.get(b.panel).expect(200)).body);
    expect(empty.page).toBeNull();

    const saved = subscribePageAdminResponse.parse((await b.agent.put(b.panel).set(CSRF).send(PAGE).expect(200)).body);
    expect(saved.page).toMatchObject({ enabled: true, title: PAGE.title, benefits: PAGE.benefits, freeEnabled: true });
    const edited = subscribePageAdminResponse.parse((await b.agent.put(b.panel).set(CSRF).send({ ...PAGE, title: "Nuevo título", benefits: [] }).expect(200)).body);
    expect(edited.page).toMatchObject({ title: "Nuevo título", benefits: [] });
  });

  it("valida en el servidor: título corto, demasiados beneficios y campos desconocidos", async () => {
    const b = await business();
    await b.agent.put(b.panel).set(CSRF).send({ ...PAGE, title: "a" }).expect(400);
    await b.agent.put(b.panel).set(CSRF).send({ ...PAGE, benefits: Array.from({ length: 9 }, (_, i) => `Beneficio ${i}`) }).expect(400);
    await b.agent.put(b.panel).set(CSRF).send({ ...PAGE, extra: true }).expect(400);
  });

  it("el público solo ve una página activa", async () => {
    const b = await business();
    const url = `/api/v1/public/sites/${b.siteSlug}/subscribe`;
    await request(http).get(url).set(CSRF).expect(404);
    await b.agent.put(b.panel).set(CSRF).send({ ...PAGE, enabled: false }).expect(200);
    await request(http).get(url).set(CSRF).expect(404);
    await b.agent.put(b.panel).set(CSRF).send(PAGE).expect(200);
    const view = publicSubscribePageResponse.parse((await request(http).get(url).set(CSRF).expect(200)).body);
    expect(view).toMatchObject({ title: PAGE.title, siteSlug: b.siteSlug, freeEnabled: true });
  });

  it("suscribirse gratis crea un miembro FREE y le envía su enlace; la respuesta no revela nada", async () => {
    const b = await business();
    await b.agent.put(b.panel).set(CSRF).send(PAGE).expect(200);
    const url = `/api/v1/public/sites/${b.siteSlug}/subscribe/free`;
    const email = `fan-${unique("x")}${DOMAIN}`;

    const first = await request(http).post(url).set(CSRF).send({ email, name: "Fan" }).expect(200);
    expect(freeSubscribeResponse.parse(first.body)).toEqual({ sent: true });
    const member = await prisma.siteMember.findUnique({ where: { siteId_email: { siteId: b.siteId, email } } });
    expect(member).toMatchObject({ source: "FREE", status: "ACTIVE", name: "Fan" });
    const token = await lastLinkFor(email);
    expect(token).not.toBeNull();

    // El enlace sirve para entrar (sesión de miembro), igual que el de cualquier miembro.
    const session = await request(http).post("/api/v1/public/members/verify").set(CSRF).send({ token }).expect(200);
    expect(session.body.siteSlug).toBe(b.siteSlug);

    // Repetir el alta no duplica al miembro y responde igual.
    const again = await request(http).post(url).set(CSRF).send({ email }).expect(200);
    expect(again.body).toEqual(first.body);
    expect(await prisma.siteMember.count({ where: { siteId: b.siteId, email } })).toBe(1);

    // Aparece en el panel como miembro activo del sitio.
    const admin = subscribePageAdminResponse.parse((await b.agent.get(b.panel).expect(200)).body);
    expect(admin.activeMembers).toBe(1);
  });

  it("no crea nada con el campo trampa, ni con la suscripción gratuita apagada; un revocado no recibe enlace", async () => {
    const b = await business();
    await b.agent.put(b.panel).set(CSRF).send(PAGE).expect(200);
    const url = `/api/v1/public/sites/${b.siteSlug}/subscribe/free`;

    const bot = `bot-${unique("x")}${DOMAIN}`;
    await request(http).post(url).set(CSRF).send({ email: bot, website: "https://spam.test" }).expect(200);
    expect(await prisma.siteMember.count({ where: { siteId: b.siteId, email: bot } })).toBe(0);

    const revoked = `rev-${unique("x")}${DOMAIN}`;
    await prisma.siteMember.create({ data: { organizationId: b.organizationId, siteId: b.siteId, email: revoked, source: "FREE", status: "REVOKED" } });
    const before = emailAdapter.messages.length;
    await request(http).post(url).set(CSRF).send({ email: revoked }).expect(200);
    await wait(150);
    expect(emailAdapter.messages.slice(before).some((m) => m.to === revoked)).toBe(false);
    expect((await prisma.siteMember.findUnique({ where: { siteId_email: { siteId: b.siteId, email: revoked } } }))?.status).toBe("REVOKED");

    await b.agent.put(b.panel).set(CSRF).send({ ...PAGE, freeEnabled: false }).expect(200);
    await request(http).post(url).set(CSRF).send({ email: `x-${unique("y")}${DOMAIN}` }).expect(404);
  });

  it("limita las altas por correo: pasado el tope responde igual pero no envía más", async () => {
    const b = await business();
    await b.agent.put(b.panel).set(CSRF).send(PAGE).expect(200);
    const url = `/api/v1/public/sites/${b.siteSlug}/subscribe/free`;
    const email = `lim-${unique("x")}${DOMAIN}`;
    const before = emailAdapter.messages.length;
    for (let i = 0; i < 5; i += 1) await request(http).post(url).set(CSRF).send({ email }).expect(200);
    await wait(300);
    expect(emailAdapter.messages.slice(before).filter((m) => m.to === email).length).toBe(3);
  });

  it("aislamiento: otra organización no ve ni edita la página de la mía", async () => {
    const mine = await business();
    await mine.agent.put(mine.panel).set(CSRF).send(PAGE).expect(200);
    const other = await business();
    await other.agent.get(mine.panel).expect(403);
    await other.agent.put(mine.panel).set(CSRF).send(PAGE).expect(403);
    // Con mi organización pero el sitio ajeno: no existe para mí.
    await mine.agent.get(`/api/v1/organizations/${mine.organizationId}/sites/${other.siteId}/subscribe-page`).expect(404);
    // Un miembro FREE del sitio A no existe en el B.
    const email = `iso-${unique("x")}${DOMAIN}`;
    await request(http).post(`/api/v1/public/sites/${mine.siteSlug}/subscribe/free`).set(CSRF).send({ email }).expect(200);
    expect(await prisma.siteMember.count({ where: { siteId: other.siteId, email } })).toBe(0);
  });
});
