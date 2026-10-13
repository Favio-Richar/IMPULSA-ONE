import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { siteResponse } from "@impulza/contracts";
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

// Extra F10 — duplicar un sitio dentro de la misma organización: la copia nace en borrador con páginas, bloques, tema y fondo, y
// NO arrastra lo que es único por sitio. Respeta el límite del plan y el aislamiento entre organizaciones (ADR-002).

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@site-duplicate-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

describe("Duplicar sitio (e2e)", () => {
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
    emailAdapter.messages = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  async function loggedInUser() {
    const email = `${unique("user")}${DOMAIN}`;
    const password = "password1234";
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(http);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password }).expect(201);
    return { agent, email };
  }

  /** Organización con plan holgado, un sitio de origen con dos páginas y contenido de todo tipo. */
  async function business(options: { roomy?: boolean } = {}) {
    const { agent } = await loggedInUser();
    const org = await agent.post("/api/v1/organizations").set(CSRF).send({ name: "Duplicar", slug: unique("dup-org") }).expect(201);
    const organizationId = org.body.id as string;
    if (options.roomy !== false) await assignRoomyPlan(prisma, organizationId);
    const base = `/api/v1/organizations/${organizationId}/sites`;
    const slug = unique("dup-src");
    const site = await agent.post(base).set(CSRF).send({ name: "Origen", slug }).expect(201);
    const siteId = site.body.id as string;
    const pages = `${base}/${siteId}/pages`;
    const home = (await agent.get(pages).expect(200)).body[0] as { id: string };
    await agent.post(`${pages}/${home.id}/blocks`).set(CSRF).send({ type: "text", config: { html: "<p>Hola desde el origen</p>", alignment: "left" } }).expect(201);
    await agent.post(`${pages}/${home.id}/blocks`).set(CSRF).send({ type: "contact_form", config: { formId: "00000000-0000-4000-8000-000000000001" } }).expect(201);
    const extra = await agent.post(pages).set(CSRF).send({ slug: "servicios" }).expect(201);
    await agent.post(`${pages}/${extra.body.id}/blocks`).set(CSRF).send({ type: "text", config: { html: "<p>Servicios</p>", alignment: "left" } }).expect(201);
    return { agent, organizationId, siteId, slug, base, pages, homeId: home.id as string };
  }

  it("copia páginas, bloques, tema y fondo; nace en borrador y limpia lo que es único por sitio", async () => {
    const b = await business();
    await b.agent.put(`${b.base}/${b.siteId}/measurement`).set(CSRF).send({ ga4MeasurementId: "G-AB12CD34EF", metaPixelId: null }).expect(200);
    const theme = await prisma.theme.findFirstOrThrow({ where: { organizationId: null } });
    await b.agent.put(`${b.base}/${b.siteId}/theme`).set(CSRF).send({ themeId: theme.id }).expect(200);
    await b.agent.put(`${b.base}/${b.siteId}/background`).set(CSRF).send({ kind: "solid", color: "#0f172a" }).catch(() => undefined);
    await prisma.site.update({ where: { id: b.siteId }, data: { background: { kind: "solid", color: "#0f172a" } } });
    await b.agent.post(`${b.pages}/${b.homeId}/publish`).set(CSRF).expect(201);

    const newSlug = unique("dup-copy");
    const response = await b.agent.post(`${b.base}/${b.siteId}/duplicate`).set(CSRF).send({ name: "Copia del origen", slug: newSlug }).expect(201);
    siteResponse.parse(response.body);
    expect(response.body).toMatchObject({ name: "Copia del origen", slug: newSlug, status: "DRAFT", organizationId: b.organizationId, themeId: theme.id });
    const copyId = response.body.id as string;

    const copy = await prisma.site.findUniqueOrThrow({ where: { id: copyId }, include: { pages: { orderBy: { position: "asc" }, include: { blocks: { orderBy: { position: "asc" }, include: { versions: true } } } } } });
    expect(copy.background).toEqual({ kind: "solid", color: "#0f172a" });
    // Lo único por sitio queda limpio.
    expect(copy.ga4MeasurementId).toBeNull();
    expect(copy.metaPixelId).toBeNull();
    expect(await prisma.siteDomain.count({ where: { siteId: copyId } })).toBe(0);
    expect(await prisma.analyticsAggregate.count({ where: { siteId: copyId } })).toBe(0);
    expect(await prisma.analyticsEvent.count({ where: { siteId: copyId } })).toBe(0);

    // Páginas: las dos, en borrador, con la home preservada.
    expect(copy.pages.map((page) => [page.slug, page.isHome, page.status])).toEqual([
      ["inicio", true, "DRAFT"],
      ["servicios", false, "DRAFT"],
    ]);
    // Bloques: el texto viaja igual; el formulario pierde la referencia.
    const homeBlocks = copy.pages[0]!.blocks;
    expect(homeBlocks.map((block) => block.type)).toEqual(["text", "contact_form"]);
    expect(homeBlocks[0]!.versions[0]!.config).toMatchObject({ html: "<p>Hola desde el origen</p>" });
    expect((homeBlocks[1]!.versions[0]!.config as { formId: unknown }).formId).toBeNull();
    // Ningún bloque de la copia es el del origen.
    const sourceBlockIds = (await prisma.block.findMany({ where: { page: { siteId: b.siteId } }, select: { id: true } })).map((block) => block.id);
    expect(copy.pages.flatMap((page) => page.blocks).some((block) => sourceBlockIds.includes(block.id))).toBe(false);

    // Auditoría con el actor y el origen.
    const log = await prisma.auditLog.findFirstOrThrow({ where: { targetId: copyId, action: "site.duplicated" } });
    expect(log.organizationId).toBe(b.organizationId);
    expect(log.metadata).toMatchObject({ sourceSiteId: b.siteId, slug: newSlug, pages: 2, blocks: 3 });

    // El origen no cambió.
    expect((await prisma.site.findUniqueOrThrow({ where: { id: b.siteId } })).ga4MeasurementId).toBe("G-AB12CD34EF");
  });

  it("la copia es independiente: editar su contenido no toca el origen", async () => {
    const b = await business();
    const copy = (await b.agent.post(`${b.base}/${b.siteId}/duplicate`).set(CSRF).send({ name: "Copia", slug: unique("dup-ind") }).expect(201)).body as { id: string };
    const copyPages = `${b.base}/${copy.id}/pages`;
    const copyHome = (await b.agent.get(copyPages).expect(200)).body.find((page: { isHome: boolean }) => page.isHome) as { id: string };
    const blocks = (await b.agent.get(`${copyPages}/${copyHome.id}/blocks`).expect(200)).body as Array<{ id: string; type: string }>;
    const text = blocks.find((block) => block.type === "text")!;
    await b.agent.patch(`${copyPages}/${copyHome.id}/blocks/${text.id}`).set(CSRF).send({ config: { html: "<p>Solo en la copia</p>", alignment: "left" } }).expect(200);

    const sourceBlocks = (await b.agent.get(`${b.pages}/${b.homeId}/blocks`).expect(200)).body as Array<{ type: string; config: { html?: string } }>;
    expect(sourceBlocks.find((block) => block.type === "text")!.config.html).toBe("<p>Hola desde el origen</p>");
  });

  it("rechaza slug ocupado (409), slug inválido (400) y un sitio archivado (409)", async () => {
    const b = await business();
    await b.agent.post(`${b.base}/${b.siteId}/duplicate`).set(CSRF).send({ name: "Copia", slug: b.slug }).expect(409);
    await b.agent.post(`${b.base}/${b.siteId}/duplicate`).set(CSRF).send({ name: "Copia", slug: "MAL slug" }).expect(400);
    await b.agent.post(`${b.base}/${b.siteId}/duplicate`).set(CSRF).send({ name: "x", slug: unique("dup-x") }).expect(400);
    await b.agent.post(`${b.base}/${b.siteId}/archive`).set(CSRF).expect(201);
    await b.agent.post(`${b.base}/${b.siteId}/duplicate`).set(CSRF).send({ name: "Copia", slug: unique("dup-arch") }).expect(409);
  });

  it("respeta el límite de sitios del plan (402) y no deja una copia a medias", async () => {
    const b = await business({ roomy: false });
    const before = await prisma.site.count({ where: { organizationId: b.organizationId } });
    const response = await b.agent.post(`${b.base}/${b.siteId}/duplicate`).set(CSRF).send({ name: "Copia", slug: unique("dup-lim") });
    expect(response.status).toBe(402);
    expect(await prisma.site.count({ where: { organizationId: b.organizationId } })).toBe(before);
  });

  it("aislamiento: otra organización no puede duplicar mi sitio ni ve la copia", async () => {
    const mine = await business();
    const other = await business();
    // Con mi sitio en la ruta de su organización: no existe para ella.
    await other.agent.post(`${other.base}/${mine.siteId}/duplicate`).set(CSRF).send({ name: "Robo", slug: unique("dup-iso") }).expect(404);
    // Con la ruta de mi organización: no es miembro.
    await other.agent.post(`${mine.base}/${mine.siteId}/duplicate`).set(CSRF).send({ name: "Robo", slug: unique("dup-iso") }).expect(403);
    expect(await prisma.site.count({ where: { organizationId: other.organizationId } })).toBe(1);

    const copy = (await mine.agent.post(`${mine.base}/${mine.siteId}/duplicate`).set(CSRF).send({ name: "Mía", slug: unique("dup-own") }).expect(201)).body as { id: string };
    await other.agent.get(`${mine.base}/${copy.id}`).expect(403);
  });

  it("exige el permiso site.create: un ANALYST no puede duplicar", async () => {
    const b = await business();
    const { agent, email } = await loggedInUser();
    const invite = await b.agent.post(`/api/v1/organizations/${b.organizationId}/members`).set(CSRF).send({ email, role: "ANALYST" }).expect(201);
    await agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
    await agent.post(`${b.base}/${b.siteId}/duplicate`).set(CSRF).send({ name: "Copia", slug: unique("dup-perm") }).expect(403);
  });
});
