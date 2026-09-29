import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { publicPageResponse, smartCtaResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import { DEFAULT_BOOKING_SETTINGS } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F6.6 — Smart CTA: reglas de un catálogo cerrado que solo apuntan a botones de acción de la misma
// página, publicadas al sitio por posición (nunca por id) junto al horario del sitio, y el estado
// "¿quedan horas para reservar?" como un simple sí/no.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@smart-cta-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const ALL_DAY = { start: "00:00", end: "24:00" };
const ALWAYS_OPEN = { mon: [ALL_DAY], tue: [ALL_DAY], wed: [ALL_DAY], thu: [ALL_DAY], fri: [ALL_DAY], sat: [ALL_DAY], sun: [ALL_DAY] };

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Smart CTA (e2e) — F6.6", () => {
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
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function register() {
    const email = `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password: "password1234" }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password: "password1234" }).expect(201);
    return { agent, email };
  }

  async function setup() {
    const { agent } = await register();
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org CTA", slug: uniqueSlug("org") }).expect(201);
    await assignRoomyPlan(prisma, org.body.id);
    const siteSlug = uniqueSlug("site");
    const site = await agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF_HEADERS).send({ name: "Barbería", slug: siteSlug }).expect(201);
    const organizationId = org.body.id as string;
    const siteId = site.body.id as string;
    const sitePath = `/api/v1/organizations/${organizationId}/sites/${siteId}`;
    const pages = (await agent.get(`${sitePath}/pages`).expect(200)).body as Array<{ id: string; isHome: boolean }>;
    const home = pages.find((page) => page.isHome)!;
    const pagePath = `${sitePath}/pages/${home.id}`;
    const addBlock = async (type: string, config: unknown) => (await agent.post(`${pagePath}/blocks`).set(CSRF_HEADERS).send({ type, config }).expect(201)).body as { id: string };
    return { agent, organizationId, siteId, siteSlug, sitePath, pagePath, ctaPath: `${pagePath}/smart-cta`, addBlock };
  }

  it("guarda reglas que apuntan a botones de acción de la página; rechaza otros bloques, catálogo abierto y exceso", async () => {
    const { agent, sitePath, ctaPath, addBlock } = await setup();
    const profile = await addBlock("profile", { name: "Barbería" });
    const booking = await addBlock("booking", { label: "Reservar" });
    const whatsapp = await addBlock("whatsapp", { phone: "+56912345678" });

    expect(smartCtaResponse.parse((await agent.get(ctaPath).expect(200)).body)).toEqual({ rules: [], hoursConfigured: false });

    const rules = [
      { condition: { kind: "bookings_unavailable" }, blockId: whatsapp.id },
      { condition: { kind: "utm_campaign", value: " Black Friday " }, blockId: booking.id },
    ];
    const saved = smartCtaResponse.parse((await agent.put(ctaPath).set(CSRF_HEADERS).send({ rules }).expect(200)).body);
    expect(saved.rules[1]).toEqual({ condition: { kind: "utm_campaign", value: "black-friday" }, blockId: booking.id });

    const notAction = await agent.put(ctaPath).set(CSRF_HEADERS).send({ rules: [{ condition: { kind: "outside_hours" }, blockId: profile.id }] }).expect(422);
    expect(notAction.body.code).toBe("SMART_CTA_BLOCK_INVALID");
    // Un bloque de otra página del mismo sitio tampoco vale.
    const other = await agent.post(`${sitePath}/pages`).set(CSRF_HEADERS).send({ slug: "otra" }).expect(201);
    const otherBlock = (await agent.post(`${sitePath}/pages/${other.body.id}/blocks`).set(CSRF_HEADERS).send({ type: "link", config: { label: "X", url: "https://x.example.com" } }).expect(201)).body;
    await agent.put(ctaPath).set(CSRF_HEADERS).send({ rules: [{ condition: { kind: "outside_hours" }, blockId: otherBlock.id }] }).expect(422);
    await agent.put(ctaPath).set(CSRF_HEADERS).send({ rules: [{ condition: { kind: "country", value: "CL" }, blockId: whatsapp.id }] }).expect(400);
    await agent.put(ctaPath).set(CSRF_HEADERS).send({ rules: Array(6).fill({ condition: { kind: "outside_hours" }, blockId: whatsapp.id }) }).expect(400);

    // Lista vacía = sin reglas.
    expect((await agent.put(ctaPath).set(CSRF_HEADERS).send({ rules: [] }).expect(200)).body.rules).toEqual([]);
  });

  it("la página pública trae las reglas por posición publicada, sin ids, con el horario del sitio; omite lo que el visitante no ve", async () => {
    const { agent, siteId, siteSlug, pagePath, ctaPath, addBlock } = await setup();
    await addBlock("profile", { name: "Barbería" });
    const booking = await addBlock("booking", { label: "Reservar" });
    const whatsapp = await addBlock("whatsapp", { phone: "+56912345678" });
    const hiddenLink = await addBlock("link", { label: "Oculto", url: "https://oculto.example.com" });
    await agent.patch(`${pagePath}/blocks/${hiddenLink.id}`).set(CSRF_HEADERS).send({ visible: false }).expect(200);
    await agent.post(`${pagePath}/publish`).set(CSRF_HEADERS).expect(201);
    await agent
      .put(ctaPath)
      .set(CSRF_HEADERS)
      .send({
        rules: [
          { condition: { kind: "outside_hours" }, blockId: whatsapp.id },
          { condition: { kind: "device", device: "desktop" }, blockId: hiddenLink.id },
          { condition: { kind: "utm_source", value: "instagram" }, blockId: booking.id },
        ],
      })
      .expect(200);

    const fetchPage = async () => publicPageResponse.parse((await request(httpServer).get(`/api/v1/public/sites/${siteSlug}/pages/inicio`).expect(200)).body);
    const page = await fetchPage();
    expect(page.smartCta).toEqual({
      rules: [
        { condition: { kind: "outside_hours" }, position: 2 },
        { condition: { kind: "utm_source", value: "instagram" }, position: 1 },
      ],
      hours: null,
    });
    const json = JSON.stringify(page);
    expect(json).not.toContain(whatsapp.id);
    expect(json).not.toContain(booking.id);

    // Con horario configurado (el de reservas), viaja para evaluar "fuera de horario".
    await prisma.bookingSettings.create({ data: { siteId, organizationId: (await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).organizationId, weeklyHours: DEFAULT_BOOKING_SETTINGS.weeklyHours } });
    expect((await fetchPage()).smartCta?.hours).toMatchObject({ timeZone: "America/Santiago", weeklyHours: { sun: [] } });
    expect(smartCtaResponse.parse((await agent.get(ctaPath).expect(200)).body).hoursConfigured).toBe(true);

    await agent.put(ctaPath).set(CSRF_HEADERS).send({ rules: [] }).expect(200);
    expect((await fetchPage()).smartCta).toBeUndefined();
  });

  it("\"¿quedan horas?\" responde solo sí o no: apagado o sin servicios es no, con horas libres es sí", async () => {
    const { agent, sitePath, siteSlug } = await setup();
    const available = () => request(httpServer).get(`/api/v1/public/sites/${siteSlug}/booking/available`).set(CSRF_HEADERS);
    await request(httpServer).get(`/api/v1/public/sites/no-existe-${Date.now()}/booking/available`).set(CSRF_HEADERS).expect(404);
    expect((await available().expect(200)).body).toEqual({ available: false });

    await agent.put(`${sitePath}/booking/settings`).set(CSRF_HEADERS).send({ ...DEFAULT_BOOKING_SETTINGS, enabled: true, minNoticeMinutes: 0, weeklyHours: ALWAYS_OPEN }).expect(200);
    expect((await available().expect(200)).body).toEqual({ available: false });
    await agent.post(`${sitePath}/booking/services`).set(CSRF_HEADERS).send({ name: "Corte", durationMinutes: 30 }).expect(201);
    expect((await available().expect(200)).body).toEqual({ available: true });

    await agent.put(`${sitePath}/booking/settings`).set(CSRF_HEADERS).send({ ...DEFAULT_BOOKING_SETTINGS, enabled: false, weeklyHours: ALWAYS_OPEN }).expect(200);
    expect((await available().expect(200)).body).toEqual({ available: false });
  });

  it("un ANALYST ve las reglas pero no las cambia", async () => {
    const { agent, organizationId, ctaPath, addBlock } = await setup();
    const whatsapp = await addBlock("whatsapp", { phone: "+56912345678" });
    const analyst = await register();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: analyst.email } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "ANALYST" } });
    await prisma.membership.create({ data: { organizationId, userId: user.id, roleId: role.id, status: "ACTIVE" } });
    await analyst.agent.get(ctaPath).expect(200);
    await analyst.agent.put(ctaPath).set(CSRF_HEADERS).send({ rules: [{ condition: { kind: "outside_hours" }, blockId: whatsapp.id }] }).expect(403);
    expect((await agent.get(ctaPath).expect(200)).body.rules).toEqual([]);
  });
});
