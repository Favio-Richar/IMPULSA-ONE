import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { pageHealthResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { listenForTests } from "../../test-support/http.js";

// F6.1 — salud de página: el servidor evalúa el estado vivo real, no lo que diga el panel.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@page-health-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Salud de página (e2e) — F6.1", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let httpServer: Parameters<typeof request>[0];

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
    httpServer = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function createHomePage() {
    const email = `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
    const password = "password1234";
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);

    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org Salud", slug: uniqueSlug("org") }).expect(201);
    await assignRoomyPlan(prisma, org.body.id);
    const site = await agent
      .post(`/api/v1/organizations/${org.body.id}/sites`)
      .set(CSRF_HEADERS)
      .send({ name: "Sitio", slug: uniqueSlug("site") })
      .expect(201);
    const pagesPath = `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/pages`;
    const pages = await agent.get(pagesPath).expect(200);
    const home = pages.body.find((page: { isHome: boolean }) => page.isHome);
    return { agent, organizationId: org.body.id as string, pagePath: `${pagesPath}/${home.id}`, pageId: home.id as string };
  }

  const codes = (body: { findings: Array<{ code: string }> }) => body.findings.map((finding) => finding.code);

  it("una página nueva sale sin publicar y vacía; con encabezado, acción principal y publicada llega a 100", async () => {
    const { agent, pagePath } = await createHomePage();

    const initial = await agent.get(`${pagePath}/health`).expect(200);
    expect(pageHealthResponse.parse(initial.body)).toBeTruthy();
    expect(codes(initial.body)).toEqual(expect.arrayContaining(["page_not_published", "page_empty"]));
    expect(initial.body.score).toBeLessThan(60);

    await agent
      .post(`${pagePath}/blocks`)
      .set(CSRF_HEADERS)
      .send({ type: "profile", config: { name: "Estudio Lumen", headline: "Fotografía de producto" } })
      .expect(201);
    const whatsapp = await agent
      .post(`${pagePath}/blocks`)
      .set(CSRF_HEADERS)
      .send({ type: "whatsapp", config: { phone: "+56912345678" } })
      .expect(201);

    const withoutPrimary = await agent.get(`${pagePath}/health`).expect(200);
    expect(codes(withoutPrimary.body)).toEqual(["page_not_published", "no_primary_action"]);

    await agent.put(`${pagePath}/blocks/primary`).set(CSRF_HEADERS).send({ blockId: whatsapp.body.id }).expect(200);
    await agent.post(`${pagePath}/publish`).set(CSRF_HEADERS).expect(201);

    const healthy = await agent.get(`${pagePath}/health`).expect(200);
    expect(healthy.body).toMatchObject({ score: 100, findings: [] });
  });

  it("un formulario sin configurar se detecta sobre el estado vivo, con el bloque afectado", async () => {
    const { agent, pagePath } = await createHomePage();
    await agent.post(`${pagePath}/blocks`).set(CSRF_HEADERS).send({ type: "profile", config: { name: "Lumen" } }).expect(201);
    const form = await agent.post(`${pagePath}/blocks`).set(CSRF_HEADERS).send({ type: "contact_form", config: {} }).expect(201);

    const health = await agent.get(`${pagePath}/health`).expect(200);
    expect(health.body.findings).toContainEqual({ code: "form_not_configured", severity: "critical", category: "action", blockId: form.body.id, blockType: "contact_form" });
  });

  it("una configuración guardada que ya no cumple su esquema se informa como bloque que no se muestra", async () => {
    const { agent, pagePath, pageId } = await createHomePage();
    const link = await agent
      .post(`${pagePath}/blocks`)
      .set(CSRF_HEADERS)
      .send({ type: "link", config: { label: "Tienda", url: "https://tienda.example.com" } })
      .expect(201);
    // Simula un dato que quedó mal en la base (migración incompleta): el render lo omite y la salud lo dice.
    await prisma.blockVersion.create({ data: { blockId: link.body.id, versionNumber: 99, config: { label: "Sin URL" } } });

    const health = await agent.get(`${pagePath}/health`).expect(200);
    expect(health.body.findings).toContainEqual(expect.objectContaining({ code: "block_unrenderable", blockId: link.body.id }));
    expect(await prisma.block.count({ where: { pageId } })).toBe(1);
  });

  it("otra organización recibe 404 al pedir la salud de una página ajena", async () => {
    const owner = await createHomePage();
    const stranger = await createHomePage();
    const foreign = owner.pagePath.replace(owner.organizationId, stranger.organizationId);
    await stranger.agent.get(`${foreign}/health`).expect(404);
    await stranger.agent.get(`${owner.pagePath}/health`).expect(403);
  });
});
