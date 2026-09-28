import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FakeProvider, type AiRequest, type FakeStep } from "@impulza/ai";
import { aiBlockProposalsResponse, aiSeoProposalsResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
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
import { AI_PROVIDER_FACTORY } from "./ai.service.js";

// F6.3 — asistente de textos: la IA propone, el servidor valida cada propuesta contra el esquema del
// bloque y nada se guarda hasta que el usuario aplica con la edición normal. Proveedor falso: sin red.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@page-ai-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const PREFIX = `e2e-page-ai-${Date.now().toString(36)}`;

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Asistente de textos (e2e) — F6.3", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let httpServer: Parameters<typeof request>[0];
  const emailAdapter = new FakeEmailAdapter();
  let fake = new FakeProvider();
  let savedRoutes: Array<{ id: string; task: string; position: number; connectionId: string }> = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(AI_PROVIDER_FACTORY)
      .useValue(() => fake)
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    httpServer = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
    // Las rutas son globales: se guardan y se restauran para no borrar la configuración real local.
    savedRoutes = await prisma.aiRoute.findMany();
    await prisma.aiRoute.deleteMany({});
    await prisma.aiConnection.create({
      data: {
        name: `${PREFIX}-local`,
        kind: "OPENAI_COMPATIBLE",
        baseUrl: "http://ia.interna:11434/v1",
        model: "modelo-local",
        routes: { create: [{ task: "short_copy", position: 0 }, { task: "seo", position: 0 }, { task: "translate", position: 0 }] },
      },
    });
  });

  afterAll(async () => {
    await prisma.aiConnection.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.aiRoute.deleteMany({});
    await prisma.aiRoute.createMany({ data: savedRoutes });
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    fake = new FakeProvider();
    const keys = [...(await redis.keys("ratelimit:*")), ...(await redis.keys("ai:quota:*"))];
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  const respond = (...steps: FakeStep[]) => fake.enqueue(...steps);
  const lastRequest = (): AiRequest<unknown> => fake.requests.at(-1)!;

  async function register(): Promise<{ agent: ReturnType<typeof request.agent>; email: string }> {
    const email = `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
    const password = "password1234";
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);
    return { agent, email };
  }

  async function createHomePage() {
    const { agent } = await register();
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org Textos", slug: uniqueSlug("org") }).expect(201);
    await assignRoomyPlan(prisma, org.body.id);
    const site = await agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF_HEADERS).send({ name: "Estudio Lumen", slug: uniqueSlug("site") }).expect(201);
    const pagesPath = `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/pages`;
    const pages = await agent.get(pagesPath).expect(200);
    const home = pages.body.find((page: { isHome: boolean }) => page.isHome);
    const pagePath = `${pagesPath}/${home.id}`;
    const addBlock = async (type: string, config: unknown) =>
      (await agent.post(`${pagePath}/blocks`).set(CSRF_HEADERS).send({ type, config }).expect(201)).body as { id: string };
    return { agent, organizationId: org.body.id as string, siteId: site.body.id as string, pageId: home.id as string, pagePath, addBlock };
  }

  it("propone textos de un bloque, validados, sin guardar nada, y la propuesta aplicada se guarda por la edición normal", async () => {
    const { agent, pagePath, addBlock } = await createHomePage();
    await addBlock("profile", { name: "Estudio Lumen", headline: "Fotografía" });
    const link = await addBlock("link", { label: "Ver", url: "https://lumen.example.com/tienda" });
    respond({
      output: {
        proposals: [
          { values: { label: "Ver la tienda", description: "Fotos de producto listas para vender" } },
          { values: { label: "Ver la tienda", description: "Fotos de producto listas para vender" } },
          { values: { label: "Agenda tu sesión", description: "Cupos esta semana" } },
        ],
      },
    });

    const response = await agent.post(`${pagePath}/ai/block-copy`).set(CSRF_HEADERS).send({ blockId: link.id, instructions: "más directo" }).expect(200);
    const body = aiBlockProposalsResponse.parse(response.body);
    expect(body.fields.map((field) => field.key)).toEqual(["label", "description"]);
    expect(body.current).toEqual({ label: "Ver", description: "" });
    // Duplicados fuera.
    expect(body.proposals).toHaveLength(2);

    // El modelo recibió el contenido visible de la página delimitado y la preferencia, nunca la URL.
    const sent = lastRequest();
    expect(sent.prompt).toContain("Estudio Lumen");
    expect(sent.prompt).toContain("<preferencia>más directo</preferencia>");
    expect(sent.prompt).not.toContain("lumen.example.com");

    // Nada cambió en la base: la última versión del bloque sigue siendo la original.
    const blocks = await agent.get(`${pagePath}/blocks`).expect(200);
    expect(blocks.body.find((block: { id: string }) => block.id === link.id).config.label).toBe("Ver");
  });

  it("descarta la propuesta que rompería el bloque o repite lo actual; sin ninguna útil responde 502", async () => {
    const { agent, pagePath, addBlock } = await createHomePage();
    const booking = await addBlock("booking", { label: "Reservar hora" });
    respond({ output: { proposals: [{ values: { label: "Reservar hora" } }] } });
    const none = await agent.post(`${pagePath}/ai/block-copy`).set(CSRF_HEADERS).send({ blockId: booking.id }).expect(502);
    expect(none.body.code).toBe("AI_NO_USEFUL_PROPOSAL");

    // Una salida que no cumple el largo del campo es inválida para el motor (se reintenta y se agota).
    respond({ output: { proposals: [{ values: { label: "x".repeat(81) } }] } }, { output: { proposals: [{ values: { label: "x".repeat(81) } }] } });
    await agent.post(`${pagePath}/ai/block-copy`).set(CSRF_HEADERS).send({ blockId: booking.id }).expect(503);
  });

  it("un bloque sin textos de venta, o con configuración rota, no admite propuestas", async () => {
    const { agent, pagePath, addBlock } = await createHomePage();
    const divider = await addBlock("divider", { style: "line" });
    const res = await agent.post(`${pagePath}/ai/block-copy`).set(CSRF_HEADERS).send({ blockId: divider.id }).expect(422);
    expect(res.body.code).toBe("AI_BLOCK_NOT_SUPPORTED");

    const link = await addBlock("link", { label: "Tienda", url: "https://tienda.example.com" });
    await prisma.blockVersion.create({ data: { blockId: link.id, versionNumber: 99, config: { label: "Sin URL" } } });
    await agent.post(`${pagePath}/ai/block-copy`).set(CSRF_HEADERS).send({ blockId: link.id }).expect(422);
    expect(fake.requests).toHaveLength(0);
  });

  it("traduce los textos visibles con el HTML sanitizado y respeta la lista cerrada de idiomas", async () => {
    const { agent, pagePath, addBlock } = await createHomePage();
    const faq = await addBlock("faq", { title: "Preguntas", items: [{ question: "¿Hacen envíos?", answer: "<p>Sí, a todo Chile.</p>" }] });
    respond({
      output: {
        proposals: [{ values: { title: "Questions", "items.0.question": "Do you ship?", "items.0.answer": '<p>Yes, <script>alert(1)</script>nationwide.</p>' } }],
      },
    });

    const response = await agent.post(`${pagePath}/ai/translate`).set(CSRF_HEADERS).send({ blockId: faq.id, locale: "en" }).expect(200);
    const body = aiBlockProposalsResponse.parse(response.body);
    expect(body.proposals[0]!.values["items.0.answer"]).toBe("<p>Yes, nationwide.</p>");
    expect(body.fields.find((field) => field.key === "items.0.answer")?.rich).toBe(true);
    expect(lastRequest().system).toContain("inglés");

    await agent.post(`${pagePath}/ai/translate`).set(CSRF_HEADERS).send({ blockId: faq.id, locale: "xx" }).expect(400);
  });

  it("propone SEO desde el contenido visible; sin contenido responde 422 sin llamar al modelo", async () => {
    const { agent, pagePath, addBlock } = await createHomePage();
    await agent.post(`${pagePath}/ai/seo`).set(CSRF_HEADERS).send({}).expect(422);
    expect(fake.requests).toHaveLength(0);

    await addBlock("profile", { name: "Estudio Lumen", headline: "Fotografía de producto en Santiago" });
    respond({ output: { proposals: [{ title: "Estudio Lumen · Fotografía de producto", description: "Fotos de producto que venden, en Santiago." }] } });
    const response = await agent.post(`${pagePath}/ai/seo`).set(CSRF_HEADERS).send({}).expect(200);
    expect(aiSeoProposalsResponse.parse(response.body)).toMatchObject({ current: { title: null, description: null }, proposals: [{ title: "Estudio Lumen · Fotografía de producto" }] });
    expect(lastRequest().prompt).toContain("Fotografía de producto en Santiago");
  });

  it("un miembro sin permiso de edición no genera propuestas (ni gasta cuota)", async () => {
    const { agent, organizationId, pagePath, addBlock } = await createHomePage();
    const block = await addBlock("booking", { label: "Reservar hora" });
    const viewer = await register();
    const viewerUser = await prisma.user.findUniqueOrThrow({ where: { email: viewer.email } });
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { name: "ANALYST" } });
    await prisma.membership.create({ data: { organizationId, userId: viewerUser.id, roleId: viewerRole.id, status: "ACTIVE" } });

    await viewer.agent.post(`${pagePath}/ai/block-copy`).set(CSRF_HEADERS).send({ blockId: block.id }).expect(403);
    expect(fake.requests).toHaveLength(0);
    await agent.get(`/api/v1/organizations/${organizationId}/ai/status`).expect(200);
  });
});
