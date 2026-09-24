import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { organizationPlanResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { BROWSER_USER_AGENT, startAnalyticsTestWorker } from "../../test-support/analytics-pipeline.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@plan-limits-e2e.test";
const TEST_PLAN_PREFIX = "test-cupo-uno";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Aplicación de límites de plan (e2e) — F4.2", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let httpServer: Parameters<typeof request>[0];
  let tinyPlanId: string;
  // El envío público de formulario encola eventos: se procesan acá, no quedan para otro archivo.
  let pipeline: ReturnType<typeof startAnalyticsTestWorker>;

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    httpServer = app.getHttpServer();
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
    pipeline = startAnalyticsTestWorker(prisma);

    // Un plan solo para estas pruebas: cupo 1 en todo, para ejercitar cada límite sin crear
    // cientos de filas. Las formas, `forms: null`, prueban además que "sin límite" nunca bloquea.
    const tiny = await prisma.plan.create({
      data: {
        code: uniqueSlug(TEST_PLAN_PREFIX),
        name: "Cupo uno (pruebas)",
        priceMonthly: 0,
        currency: "CLP",
        sortOrder: 99,
        limits: {
          sites: 1,
          pagesPerSite: 2,
          forms: null,
          contacts: 1,
          shortLinks: 1,
          qrCodes: 1,
          members: 1,
          analyticsHistoryDays: 30,
          storageMb: 1,
        },
      },
    });
    tinyPlanId = tiny.id;
  });

  afterAll(async () => {
    await pipeline.drain();
    await pipeline.close();
    await prisma.organization.deleteMany({
      where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await prisma.plan.deleteMany({ where: { code: { startsWith: TEST_PLAN_PREFIX } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function registerLoggedInUser() {
    const email = `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
    const password = "password1234";
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);
    return { email, agent };
  }

  async function createOrg(plan: "free" | "tiny") {
    const { agent } = await registerLoggedInUser();
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org", slug: uniqueSlug("org") }).expect(201);
    const organizationId = org.body.id as string;
    if (plan === "tiny") {
      await prisma.organization.update({ where: { id: organizationId }, data: { planId: tinyPlanId } });
    }
    return { agent, organizationId, base: `/api/v1/organizations/${organizationId}` };
  }

  it("Gratis: el segundo sitio responde 402 con código estable, límite, uso y plan", async () => {
    const { agent, base } = await createOrg("free");
    await agent.post(`${base}/sites`).set(CSRF_HEADERS).send({ name: "Uno", slug: uniqueSlug("s") }).expect(201);

    const response = await agent.post(`${base}/sites`).set(CSRF_HEADERS).send({ name: "Dos", slug: uniqueSlug("s") }).expect(402);
    expect(response.body).toMatchObject({
      statusCode: 402,
      code: "PLAN_LIMIT_REACHED",
      limit: { key: "sites", max: 1, used: 1 },
      plan: { code: "free", name: "Gratis" },
    });
    expect(response.body.message).toMatch(/máximo de sitios/);
  });

  it("archivar un sitio libera su cupo", async () => {
    const { agent, base } = await createOrg("free");
    const site = await agent.post(`${base}/sites`).set(CSRF_HEADERS).send({ name: "Uno", slug: uniqueSlug("s") }).expect(201);
    await agent.post(`${base}/sites/${site.body.id}/archive`).set(CSRF_HEADERS).expect(201);
    await agent.post(`${base}/sites`).set(CSRF_HEADERS).send({ name: "Otro", slug: uniqueSlug("s") }).expect(201);
  });

  it("páginas por sitio: crear y restaurar respetan el límite", async () => {
    const { agent, base } = await createOrg("tiny");
    const site = await agent.post(`${base}/sites`).set(CSRF_HEADERS).send({ name: "Uno", slug: uniqueSlug("s") }).expect(201);
    const pages = `${base}/sites/${site.body.id}/pages`;

    // La home ya ocupa 1 de 2.
    const second = await agent.post(pages).set(CSRF_HEADERS).send({ slug: "contacto" }).expect(201);
    const third = await agent.post(pages).set(CSRF_HEADERS).send({ slug: "blog" }).expect(402);
    expect(third.body.limit).toEqual({ key: "pagesPerSite", max: 2, used: 2 });

    // Borrar libera; restaurar vuelve a ocupar — y si otro tomó el lugar, no se puede.
    await agent.delete(`${pages}/${second.body.id}`).set(CSRF_HEADERS).expect(200);
    await agent.post(pages).set(CSRF_HEADERS).send({ slug: "servicios" }).expect(201);
    await agent.post(`${pages}/${second.body.id}/restore`).set(CSRF_HEADERS).expect(402);
  });

  it("enlaces, QR, contactos manuales y miembros: cada uno se corta en su límite", async () => {
    const { agent, base } = await createOrg("tiny");

    const link = await agent.post(`${base}/short-links`).set(CSRF_HEADERS).send({ slug: uniqueSlug("l"), destinationUrl: "https://ejemplo.cl" }).expect(201);
    await agent.post(`${base}/short-links`).set(CSRF_HEADERS).send({ slug: uniqueSlug("l"), destinationUrl: "https://ejemplo.cl" }).expect(402);

    await agent.post(`${base}/qr-codes`).set(CSRF_HEADERS).send({ shortLinkId: link.body.id, styleKey: "clasico" }).expect(201);
    await agent.post(`${base}/qr-codes`).set(CSRF_HEADERS).send({ directUrl: "https://ejemplo.cl", styleKey: "clasico" }).expect(402);

    await agent.post(`${base}/contacts`).set(CSRF_HEADERS).send({ name: "Uno" }).expect(201);
    await agent.post(`${base}/contacts`).set(CSRF_HEADERS).send({ name: "Dos" }).expect(402);

    // El OWNER ya ocupa el único lugar de miembros.
    const invitee = await registerLoggedInUser();
    const invite = await agent.post(`${base}/members`).set(CSRF_HEADERS).send({ email: invitee.email, role: "EDITOR" }).expect(402);
    expect(invite.body.limit.key).toBe("members");
  });

  it("'sin límite' (null) nunca bloquea", async () => {
    const { agent, base } = await createOrg("tiny");
    const site = await agent.post(`${base}/sites`).set(CSRF_HEADERS).send({ name: "Uno", slug: uniqueSlug("s") }).expect(201);
    for (let i = 0; i < 3; i++) {
      await agent
        .post(`${base}/sites/${site.body.id}/forms`)
        .set(CSRF_HEADERS)
        .send({ name: `Form ${i}`, fields: [{ type: "TEXT", label: "Nombre" }] })
        .expect(201);
    }
  });

  it("un contacto que llega por formulario público nunca se pierde por límite", async () => {
    const { agent, base, organizationId } = await createOrg("tiny");
    const siteSlug = uniqueSlug("s");
    const site = await agent.post(`${base}/sites`).set(CSRF_HEADERS).send({ name: "Uno", slug: siteSlug }).expect(201);
    const form = await agent
      .post(`${base}/sites/${site.body.id}/forms`)
      .set(CSRF_HEADERS)
      .send({ name: "Contacto", fields: [{ type: "EMAIL", label: "Correo", required: true }, { type: "CONSENT", label: "Acepto" }] })
      .expect(201);
    const [emailField, consentField] = form.body.fields as Array<{ id: string }>;
    await agent.post(`${base}/contacts`).set(CSRF_HEADERS).send({ name: "Manual" }).expect(201);

    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/forms/${form.body.id}/submissions`)
      .set(CSRF_HEADERS)
      .set("User-Agent", BROWSER_USER_AGENT)
      .send({ [emailField!.id]: `lead-${Date.now()}${TEST_EMAIL_DOMAIN}`, [consentField!.id]: true })
      .expect(201);

    const plan = organizationPlanResponse.parse((await agent.get(`${base}/plan`).expect(200)).body);
    // 2 contactos con límite 1: el exceso se ve, no se esconde ni se pierde el lead.
    expect(plan.usage.contacts).toBe(2);
    expect(await prisma.contact.count({ where: { organizationId } })).toBe(2);
  });

  it("carrera: altas simultáneas nunca superan el límite", async () => {
    const { agent, base, organizationId } = await createOrg("free");

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        agent.post(`${base}/sites`).set(CSRF_HEADERS).send({ name: `Sitio ${i}`, slug: uniqueSlug(`c${i}`) }),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 402)).toHaveLength(4);
    expect(await prisma.site.count({ where: { organizationId } })).toBe(1);
  });

  it("bajar de plan nunca borra: lo que excede queda, pero no se puede crear más", async () => {
    const { agent, base, organizationId } = await createOrg("free");
    await assignRoomyPlan(prisma, organizationId);
    for (let i = 0; i < 3; i++) {
      await agent.post(`${base}/sites`).set(CSRF_HEADERS).send({ name: `Sitio ${i}`, slug: uniqueSlug("s") }).expect(201);
    }

    // Vuelve a Gratis (sin plan asignado).
    await prisma.organization.update({ where: { id: organizationId }, data: { planId: null } });

    const sites = await agent.get(`${base}/sites`).expect(200);
    expect(sites.body).toHaveLength(3);
    await agent.post(`${base}/sites`).set(CSRF_HEADERS).send({ name: "Cuarto", slug: uniqueSlug("s") }).expect(402);

    const plan = organizationPlanResponse.parse((await agent.get(`${base}/plan`).expect(200)).body);
    expect(plan.plan.code).toBe("free");
    expect(plan.usage.sites).toBe(3);
  });
});
