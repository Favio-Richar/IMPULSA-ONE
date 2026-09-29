import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { VISITOR_PROXY_HEADERS } from "@impulza/analytics";
import { abTestResponse, publicPageResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import { abVariantFor } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { BROWSER_USER_AGENT, startAnalyticsTestWorker } from "../../test-support/analytics-pipeline.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F6.5 — pruebas A/B: crear con validación estricta, la página pública trae solo la clave y los
// cambios de B, la API cuenta cada evento en la variante que calcula ella misma a partir del grupo
// que reenvía apps/web (nunca la declara el navegador), veredicto honesto y aplicar sin publicar.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@ab-tests-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Pruebas A/B (e2e) — F6.5", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let httpServer: Parameters<typeof request>[0];
  let pipeline: ReturnType<typeof startAnalyticsTestWorker>;
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
    pipeline = startAnalyticsTestWorker(prisma);
  });

  afterAll(async () => {
    await pipeline.close();
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

  async function setup(options: { roomy?: boolean } = { roomy: true }) {
    const { agent, email } = await register();
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org A/B", slug: uniqueSlug("org") }).expect(201);
    if (options.roomy !== false) {
      await assignRoomyPlan(prisma, org.body.id);
    }
    const siteSlug = uniqueSlug("site");
    const site = await agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF_HEADERS).send({ name: "Estudio", slug: siteSlug }).expect(201);
    const organizationId = org.body.id as string;
    const siteId = site.body.id as string;
    const pagesPath = `/api/v1/organizations/${organizationId}/sites/${siteId}/pages`;
    const home = (await agent.get(pagesPath).expect(200)).body.find((page: { isHome: boolean }) => page.isHome);
    const pagePath = `${pagesPath}/${home.id}`;
    const addBlock = async (type: string, config: unknown) => (await agent.post(`${pagePath}/blocks`).set(CSRF_HEADERS).send({ type, config }).expect(201)).body as { id: string };
    const publish = () => agent.post(`${pagePath}/publish`).set(CSRF_HEADERS).expect(201);
    const testsPath = `/api/v1/organizations/${organizationId}/sites/${siteId}/ab-tests`;
    return { agent, email, organizationId, siteId, siteSlug, pageId: home.id as string, pagePath, testsPath, addBlock, publish };
  }

  /** Un evento del visitante tal como llega por apps/web: con el secreto y su grupo A/B. */
  function visitorEvent(siteSlug: string, bucket: number | null, body: Record<string, unknown>, secret = env.INTERNAL_PROXY_SECRET) {
    const call = request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/events`)
      .set(CSRF_HEADERS)
      .set(VISITOR_PROXY_HEADERS.secret, secret)
      .set(VISITOR_PROXY_HEADERS.ip, `198.51.100.${Math.floor(Math.random() * 200) + 1}`)
      .set(VISITOR_PROXY_HEADERS.userAgent, BROWSER_USER_AGENT)
      // También en la conexión directa: sin secreto válido la API usa esta, y un navegador real no
      // se descarta como bot — así la prueba ejercita de verdad "grupo sin secreto no cuenta".
      .set("User-Agent", BROWSER_USER_AGENT);
    if (bucket !== null) {
      call.set(VISITOR_PROXY_HEADERS.abBucket, String(bucket));
    }
    return call.send(body);
  }

  it("valida al crear: solo bloques de acción publicados, cambios permitidos y distintos de A, uno por bloque", async () => {
    const { agent, testsPath, addBlock, publish } = await setup();
    const link = await addBlock("link", { label: "Ver", url: "https://example.com/tienda" });
    const text = await addBlock("text", { html: "<p>Hola</p>" });

    const unpublished = await agent.post(testsPath).set(CSRF_HEADERS).send({ blockId: link.id, name: "Texto del botón", variantB: { label: "Reserva hoy" } }).expect(422);
    expect(unpublished.body.code).toBe("AB_BLOCK_NOT_PUBLISHED");
    await publish();

    expect((await agent.post(testsPath).set(CSRF_HEADERS).send({ blockId: text.id, name: "x", variantB: { html: "<p>B</p>" } }).expect(422)).body.code).toBe("AB_BLOCK_NOT_SUPPORTED");
    expect((await agent.post(testsPath).set(CSRF_HEADERS).send({ blockId: link.id, name: "x", variantB: { url: "https://otro.example.com" } }).expect(422)).body.code).toBe("AB_VARIANT_INVALID");
    expect((await agent.post(testsPath).set(CSRF_HEADERS).send({ blockId: link.id, name: "x", variantB: { label: "Ver" } }).expect(422)).body.code).toBe("AB_VARIANT_INVALID");

    const created = await agent.post(testsPath).set(CSRF_HEADERS).send({ blockId: link.id, name: "Texto del botón", variantB: { label: "Reserva hoy", style: "outline" } }).expect(201);
    expect(abTestResponse.parse(created.body)).toMatchObject({ status: "RUNNING", variantA: { label: "Ver" }, variantB: { label: "Reserva hoy", style: "outline" }, results: { verdict: "insufficient_sample" } });
    const again = await agent.post(testsPath).set(CSRF_HEADERS).send({ blockId: link.id, name: "Otra", variantB: { label: "Otra cosa" } }).expect(409);
    expect(again.body.code).toBe("AB_TEST_ALREADY_RUNNING");
  });

  it("la página pública trae solo la clave y los cambios de B en ese bloque, y deja de traerlos al terminar", async () => {
    const { agent, siteSlug, testsPath, addBlock, publish } = await setup();
    await addBlock("profile", { name: "Estudio" });
    const link = await addBlock("link", { label: "Ver", url: "https://example.com/tienda" });
    await publish();
    const test = (await agent.post(testsPath).set(CSRF_HEADERS).send({ blockId: link.id, name: "Nombre interno secreto", variantB: { label: "Reserva hoy" } }).expect(201)).body;

    const page = publicPageResponse.parse((await request(httpServer).get(`/api/v1/public/sites/${siteSlug}/pages/inicio`).expect(200)).body);
    const tested = page.blocks.find((block) => block.type === "link");
    expect(tested?.experiment?.variantB).toEqual({ label: "Reserva hoy" });
    expect(tested?.experiment?.key).toMatch(/^[\w-]{12}$/);
    expect(page.blocks.find((block) => block.type === "profile")?.experiment).toBeUndefined();
    const json = JSON.stringify(page);
    expect(json).not.toContain("Nombre interno secreto");
    expect(json).not.toContain(test.id);

    await agent.post(`${testsPath}/${test.id}/stop`).set(CSRF_HEADERS).expect(200);
    const after = publicPageResponse.parse((await request(httpServer).get(`/api/v1/public/sites/${siteSlug}/pages/inicio`).expect(200)).body);
    expect(after.blocks.every((block) => block.experiment === undefined)).toBe(true);
  });

  it("cuenta exposiciones, clics y conversiones en la variante que calcula la API desde el grupo reenviado", async () => {
    const { agent, organizationId, siteId, siteSlug, testsPath, addBlock, publish } = await setup();
    await addBlock("profile", { name: "Estudio" });
    const link = await addBlock("link", { label: "Ver", url: "https://example.com/tienda" });
    await publish();
    const created = (await agent.post(testsPath).set(CSRF_HEADERS).send({ blockId: link.id, name: "Botón", variantB: { label: "Reserva hoy" } }).expect(201)).body;
    const { key } = (await prisma.abTest.findUniqueOrThrow({ where: { id: created.id } }));
    const bucketA = [...Array(100).keys()].find((bucket) => abVariantFor(key, bucket) === "a")!;
    const bucketB = [...Array(100).keys()].find((bucket) => abVariantFor(key, bucket) === "b")!;

    // A: 3 vistas y 1 clic. B: 2 vistas y 2 clics. Sin grupo o sin secreto: no cuentan en la prueba.
    for (let i = 0; i < 3; i++) await visitorEvent(siteSlug, bucketA, { type: "page_view", pageSlug: "inicio" }).expect(204);
    await visitorEvent(siteSlug, bucketA, { type: "block_click", pageSlug: "inicio", blockPosition: 1 }).expect(204);
    for (let i = 0; i < 2; i++) await visitorEvent(siteSlug, bucketB, { type: "page_view", pageSlug: "inicio" }).expect(204);
    for (let i = 0; i < 2; i++) await visitorEvent(siteSlug, bucketB, { type: "block_click", pageSlug: "inicio", blockPosition: 1 }).expect(204);
    await visitorEvent(siteSlug, null, { type: "page_view", pageSlug: "inicio" }).expect(204);
    await visitorEvent(siteSlug, bucketB, { type: "page_view", pageSlug: "inicio" }, "x".repeat(env.INTERNAL_PROXY_SECRET.length)).expect(204);
    // Un clic en otro bloque no cuenta para una prueba de botón.
    await visitorEvent(siteSlug, bucketB, { type: "block_click", pageSlug: "inicio", blockPosition: 0 }).expect(204);

    // Conversión: un envío de formulario del visitante del grupo B.
    const form = await agent
      .post(`/api/v1/organizations/${organizationId}/sites/${siteId}/forms`)
      .set(CSRF_HEADERS)
      .send({ name: "Contacto", fields: [{ type: "TEXT", label: "Nombre", required: true }] })
      .expect(201);
    await request(httpServer)
      .post(`/api/v1/public/sites/${siteSlug}/forms/${form.body.id}/submissions`)
      .set(CSRF_HEADERS)
      .set(VISITOR_PROXY_HEADERS.secret, env.INTERNAL_PROXY_SECRET)
      .set(VISITOR_PROXY_HEADERS.userAgent, BROWSER_USER_AGENT)
      .set(VISITOR_PROXY_HEADERS.abBucket, String(bucketB))
      .send({ [form.body.fields[0].id]: "Visitante" })
      .expect(201);

    await pipeline.drain();
    // Las 7 vistas se registraron (incluidas la sin grupo y la sin secreto: ninguna se descartó como
    // bot); solo las 5 con grupo de confianza cuentan en la prueba.
    const views = await prisma.analyticsAggregate.aggregate({ where: { siteId, metric: "page_view" }, _sum: { value: true } });
    expect(views._sum.value).toBe(7);
    const result = abTestResponse.parse((await agent.get(`${testsPath}/${created.id}`).expect(200)).body).results;
    expect(result.a).toEqual({ exposures: 3, clicks: 1, conversions: 0 });
    expect(result.b).toEqual({ exposures: 2, clicks: 2, conversions: 1 });
    expect(result).toMatchObject({ verdict: "insufficient_sample", winner: null, pValue: null });
  });

  it("con muestra suficiente y diferencia significativa recomienda un ganador; aplicarlo escribe el borrador sin publicar", async () => {
    const { agent, organizationId, siteId, pagePath, testsPath, addBlock, publish } = await setup();
    const link = await addBlock("link", { label: "Ver", url: "https://example.com/tienda" });
    await publish();
    const created = (await agent.post(testsPath).set(CSRF_HEADERS).send({ blockId: link.id, name: "Botón", variantB: { label: "Reserva hoy" } }).expect(201)).body;
    // Agregados como los escribe el worker (1.000 exposiciones por variante, 10 % contra 15 %).
    const period = new Date().toISOString().slice(0, 10);
    const rows: Array<[string, number]> = [
      [`ab:page_view:${created.id}:a`, 1000],
      [`ab:block_click:${created.id}:a`, 100],
      [`ab:page_view:${created.id}:b`, 1000],
      [`ab:block_click:${created.id}:b`, 150],
    ];
    await prisma.analyticsAggregate.createMany({ data: rows.map(([metric, value]) => ({ organizationId, siteId, period, metric, value })) });

    const results = abTestResponse.parse((await agent.get(`${testsPath}/${created.id}`).expect(200)).body).results;
    expect(results).toMatchObject({ verdict: "winner", winner: "b" });
    expect(results.pValue!).toBeLessThan(0.05);

    const versionsBefore = (await agent.get(`${pagePath}/versions`).expect(200)).body.length;
    const applied = abTestResponse.parse((await agent.post(`${testsPath}/${created.id}/apply`).set(CSRF_HEADERS).send({ variant: "b" }).expect(200)).body);
    expect(applied).toMatchObject({ status: "ENDED", appliedVariant: "b", variantA: { label: "Ver" } });
    const blocks = (await agent.get(`${pagePath}/blocks`).expect(200)).body as Array<{ id: string; config: { label: string; url: string } }>;
    expect(blocks.find((block) => block.id === link.id)?.config).toMatchObject({ label: "Reserva hoy", url: "https://example.com/tienda" });
    expect((await agent.get(`${pagePath}/versions`).expect(200)).body.length).toBe(versionsBefore);

    // Aplicar otra vez (doble clic, otra pestaña) no cambia la decisión ni reescribe el borrador.
    const blockVersions = await prisma.blockVersion.count({ where: { blockId: link.id } });
    const again = abTestResponse.parse((await agent.post(`${testsPath}/${created.id}/apply`).set(CSRF_HEADERS).send({ variant: "a" }).expect(200)).body);
    expect(again.appliedVariant).toBe("b");
    expect(await prisma.blockVersion.count({ where: { blockId: link.id } })).toBe(blockVersions);
  });

  it("el límite del plan cuenta las pruebas en curso, y un ANALYST lee pero no empieza ni termina", async () => {
    const { agent, organizationId, testsPath, addBlock, publish } = await setup({ roomy: false });
    const first = await addBlock("link", { label: "Uno", url: "https://example.com/1" });
    const second = await addBlock("whatsapp", { phone: "+56912345678", label: "Escríbenos" });
    await publish();
    const running = (await agent.post(testsPath).set(CSRF_HEADERS).send({ blockId: first.id, name: "Uno", variantB: { label: "Uno B" } }).expect(201)).body;
    const denied = await agent.post(testsPath).set(CSRF_HEADERS).send({ blockId: second.id, name: "Dos", variantB: { label: "Chatea" } }).expect(402);
    expect(denied.body).toMatchObject({ code: "PLAN_LIMIT_REACHED", limit: { key: "abTestsRunning", max: 1 } });

    const analyst = await register();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: analyst.email } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "ANALYST" } });
    await prisma.membership.create({ data: { organizationId, userId: user.id, roleId: role.id, status: "ACTIVE" } });
    expect((await analyst.agent.get(testsPath).expect(200)).body).toHaveLength(1);
    await analyst.agent.post(`${testsPath}/${running.id}/stop`).set(CSRF_HEADERS).expect(403);
    await analyst.agent.post(testsPath).set(CSRF_HEADERS).send({ blockId: second.id, name: "Dos", variantB: { label: "Chatea" } }).expect(403);

    // Terminar libera el cupo.
    await agent.post(`${testsPath}/${running.id}/stop`).set(CSRF_HEADERS).expect(200);
    await agent.post(testsPath).set(CSRF_HEADERS).send({ blockId: second.id, name: "Dos", variantB: { label: "Chatea" } }).expect(201);
  });
});
