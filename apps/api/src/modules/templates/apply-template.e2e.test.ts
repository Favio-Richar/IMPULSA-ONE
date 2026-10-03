import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { applyTemplateResponse, blockResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { Prisma, PrismaClient } from "@impulza/database";
import { getCatalogTheme, TEMPLATE_CATALOG, THEME_CATALOG } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { listenForTests } from "../../test-support/http.js";

// PL4 — aplicar una plantilla a una página contra NestJS + Postgres reales: bloques, apariencia,
// cambios sin publicar, reversibilidad por historial y aislamiento entre organizaciones (ADR-002).

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@apply-template-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const CAFE = TEMPLATE_CATALOG.find((template) => template.code === "cafe-gastronomia")!;
const CREATOR = TEMPLATE_CATALOG.find((template) => template.code === "creador-personal")!;

describe("Aplicar plantilla (e2e) — PL4", () => {
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

    // Mismos upserts idempotentes que el seed: la suite no depende de que alguien lo haya corrido.
    for (const theme of THEME_CATALOG) {
      await prisma.theme.upsert({
        where: { code: theme.code },
        update: {},
        create: { code: theme.code, name: theme.name, tokens: theme.tokens as Prisma.InputJsonValue, organizationId: null },
      });
    }
    for (const template of TEMPLATE_CATALOG) {
      const data = {
        name: template.name,
        description: template.description,
        industryTags: [...template.industryTags],
        objectiveTags: [...template.objectiveTags],
        themeCode: template.themeCode,
        family: template.family,
        background: (template.background ?? undefined) as Prisma.InputJsonValue | undefined,
        previewImageUrl: template.previewImageUrl,
        blocksSeed: template.blocksSeed as Prisma.InputJsonValue,
        sortOrder: template.sortOrder,
      };
      await prisma.template.upsert({ where: { code: template.code }, update: {}, create: { code: template.code, ...data } });
    }
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } },
    });
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

  async function createOrgWithSite() {
    const email = `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
    const password = "password1234";
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org", slug: uniqueSlug("org") }).expect(201);
    const organizationId = org.body.id as string;
    await assignRoomyPlan(prisma, organizationId);

    const site = await agent
      .post(`/api/v1/organizations/${organizationId}/sites`)
      .set(CSRF_HEADERS)
      .send({ name: "Sitio", slug: uniqueSlug("pl4") })
      .expect(201);
    const siteId = site.body.id as string;
    const pages = await agent.get(`/api/v1/organizations/${organizationId}/sites/${siteId}/pages`).expect(200);
    const pageId = (pages.body as Array<{ id: string; isHome: boolean }>).find((page) => page.isHome)!.id;
    const base = `/api/v1/organizations/${organizationId}/sites/${siteId}/pages/${pageId}`;

    return { agent, organizationId, siteId, pageId, base };
  }

  it("aplica bloques, tema y fondo a una página nueva, con la personalización y auditoría", async () => {
    const { agent, organizationId, siteId, pageId, base } = await createOrgWithSite();

    const response = await agent
      .post(`${base}/apply-template`)
      .set(CSRF_HEADERS)
      .send({
        templateCode: CAFE.code,
        personalization: {
          name: "Café Prueba",
          headline: "Tostado en casa",
          bio: "Abierto <script>alert(1)</script> todos los días",
          whatsappPhone: "+56911112222",
          socials: [{ network: "instagram", url: "https://www.instagram.com/cafe.prueba" }],
          links: [{ label: "Mi tienda", url: "https://tienda.test/" }],
        },
        onboarding: { accountType: "negocio", objective: "vender", industry: "gastronomia" },
      })
      .expect(200);

    const body = applyTemplateResponse.parse(response.body);
    const templateTypes = CAFE.blocksSeed.map((block) => block.type);
    const expectedTypes = [...templateTypes];
    expectedTypes.splice(templateTypes.lastIndexOf("link") + 1, 0, "link");
    expect(body.blocks.map((block) => block.type)).toEqual(expectedTypes);
    expect(body.blocks.filter((block) => block.isPrimary).map((block) => block.type)).toEqual(["whatsapp"]);
    expect(body.blocks.every((block) => block.degraded === null && block.visible)).toBe(true);

    const profile = body.blocks[0]!.config as { name: string; headline: string; bio: string };
    expect(profile.name).toBe("Café Prueba");
    expect(profile.bio).not.toContain("<script");
    expect(body.blocks.find((block) => block.type === "whatsapp")!.config).toMatchObject({ phone: "+56911112222" });
    expect(body.appearance).toEqual({ applied: true, previous: { themeId: null, background: null } });

    const theme = await agent.get(`/api/v1/organizations/${organizationId}/sites/${siteId}/theme`).expect(200);
    expect(theme.body.code).toBe(CAFE.themeCode);
    const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    expect(site.background).toEqual(CAFE.background);

    // Los bloques quedan como bloques normales: editables de inmediato por los endpoints de siempre.
    const listed = z.array(blockResponse).parse((await agent.get(`${base}/blocks`).expect(200)).body);
    await agent
      .patch(`${base}/blocks/${listed[0]!.id}`)
      .set(CSRF_HEADERS)
      .send({ config: { ...(listed[0]!.config as object), name: "Nombre editado" } })
      .expect(200);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "page.template_applied", targetId: pageId } });
    expect(audit.metadata).toMatchObject({
      templateCode: CAFE.code,
      appearanceApplied: true,
      discardedUnpublishedChanges: false,
      onboarding: { accountType: "negocio", objective: "vender", industry: "gastronomia" },
    });
  });

  it("sin apariencia deja el tema y el fondo del sitio tal cual", async () => {
    const { agent, organizationId, siteId, base } = await createOrgWithSite();

    const response = await agent
      .post(`${base}/apply-template`)
      .set(CSRF_HEADERS)
      .send({ templateCode: CREATOR.code, applyAppearance: false })
      .expect(200);

    expect(applyTemplateResponse.parse(response.body).appearance.applied).toBe(false);
    const theme = await agent.get(`/api/v1/organizations/${organizationId}/sites/${siteId}/theme`).expect(200);
    expect(theme.body.isDefault).toBe(true);
    expect(getCatalogTheme(CREATOR.themeCode)?.family).toBe("oscuro");
  });

  it("exige confirmar si hay cambios sin publicar, y lo publicado se recupera desde el historial", async () => {
    const { agent, base } = await createOrgWithSite();

    // Página publicada con la plantilla de café.
    await agent.post(`${base}/apply-template`).set(CSRF_HEADERS).send({ templateCode: CAFE.code }).expect(200);
    const published = await agent.post(`${base}/publish`).set(CSRF_HEADERS).expect(201);
    const publishedVersionId = published.body.id as string;

    // Publicada y sin cambios: aplicar otra plantilla no pide confirmación.
    await agent.post(`${base}/apply-template`).set(CSRF_HEADERS).send({ templateCode: CREATOR.code }).expect(200);

    // Ahora hay cambios que ninguna versión guarda: 409 con código estable, y nada cambia.
    const before = z.array(blockResponse).parse((await agent.get(`${base}/blocks`).expect(200)).body);
    const conflict = await agent.post(`${base}/apply-template`).set(CSRF_HEADERS).send({ templateCode: CAFE.code }).expect(409);
    expect(conflict.body.code).toBe("UNPUBLISHED_CHANGES");
    const unchanged = z.array(blockResponse).parse((await agent.get(`${base}/blocks`).expect(200)).body);
    expect(unchanged.map((block) => block.id)).toEqual(before.map((block) => block.id));

    // Con la confirmación explícita, sí.
    await agent
      .post(`${base}/apply-template`)
      .set(CSRF_HEADERS)
      .send({ templateCode: CAFE.code, discardUnpublishedChanges: true })
      .expect(200);

    // Reversible: restaurar la versión publicada devuelve exactamente sus bloques.
    await agent.post(`${base}/apply-template`).set(CSRF_HEADERS).send({ templateCode: CREATOR.code, discardUnpublishedChanges: true }).expect(200);
    await agent.post(`${base}/versions/${publishedVersionId}/restore`).set(CSRF_HEADERS).expect(201);
    const restored = z.array(blockResponse).parse((await agent.get(`${base}/blocks`).expect(200)).body);
    expect(restored.map((block) => block.type)).toEqual(CAFE.blocksSeed.map((block) => block.type));
  });

  it("una página nunca publicada con bloques también pide confirmación", async () => {
    const { agent, base } = await createOrgWithSite();
    await agent
      .post(`${base}/blocks`)
      .set(CSRF_HEADERS)
      .send({ type: "text", config: { html: "<p>Trabajo sin publicar</p>", alignment: "left" } })
      .expect(201);

    const conflict = await agent.post(`${base}/apply-template`).set(CSRF_HEADERS).send({ templateCode: CAFE.code }).expect(409);
    expect(conflict.body.code).toBe("UNPUBLISHED_CHANGES");
  });

  it("devuelve la apariencia anterior para poder deshacerla", async () => {
    const { agent, organizationId, siteId, base } = await createOrgWithSite();
    const noche = await prisma.theme.findFirstOrThrow({ where: { code: "oscuro-noche", organizationId: null } });
    await agent
      .put(`/api/v1/organizations/${organizationId}/sites/${siteId}/theme`)
      .set(CSRF_HEADERS)
      .send({ themeId: noche.id })
      .expect(200);
    await agent
      .put(`/api/v1/organizations/${organizationId}/sites/${siteId}/background`)
      .set(CSRF_HEADERS)
      .send({ background: { kind: "gradient", gradient: "ciruela" } })
      .expect(200);

    const response = await agent.post(`${base}/apply-template`).set(CSRF_HEADERS).send({ templateCode: CAFE.code }).expect(200);
    expect(applyTemplateResponse.parse(response.body).appearance.previous).toEqual({
      themeId: noche.id,
      background: { kind: "gradient", gradient: "ciruela" },
    });
  });

  it("rechaza una plantilla inexistente (404) y una personalización inválida (400) sin tocar la página", async () => {
    const { agent, base } = await createOrgWithSite();
    await agent.post(`${base}/apply-template`).set(CSRF_HEADERS).send({ templateCode: "no-existe" }).expect(404);
    await agent
      .post(`${base}/apply-template`)
      .set(CSRF_HEADERS)
      .send({ templateCode: CAFE.code, personalization: { whatsappPhone: "12345" } })
      .expect(400);
    const blocks = z.array(blockResponse).parse((await agent.get(`${base}/blocks`).expect(200)).body);
    expect(blocks).toEqual([]);
  });

  it("aislamiento (ADR-002): nadie aplica una plantilla a la página de otra organización", async () => {
    const victim = await createOrgWithSite();
    await victim.agent.post(`${victim.base}/apply-template`).set(CSRF_HEADERS).send({ templateCode: CAFE.code }).expect(200);
    const victimBlocks = z.array(blockResponse).parse((await victim.agent.get(`${victim.base}/blocks`).expect(200)).body);

    const attacker = await createOrgWithSite();
    // Con su propia organización en la ruta y el sitio/página ajenos: 404, no 403.
    await attacker.agent
      .post(`/api/v1/organizations/${attacker.organizationId}/sites/${victim.siteId}/pages/${victim.pageId}/apply-template`)
      .set(CSRF_HEADERS)
      .send({ templateCode: CREATOR.code, discardUnpublishedChanges: true })
      .expect(404);
    // Con su propio sitio y la página ajena: 404.
    await attacker.agent
      .post(`/api/v1/organizations/${attacker.organizationId}/sites/${attacker.siteId}/pages/${victim.pageId}/apply-template`)
      .set(CSRF_HEADERS)
      .send({ templateCode: CREATOR.code, discardUnpublishedChanges: true })
      .expect(404);
    // Con la organización ajena en la ruta: no es miembro.
    await attacker.agent.post(`${victim.base}/apply-template`).set(CSRF_HEADERS).send({ templateCode: CREATOR.code }).expect(403);

    const after = z.array(blockResponse).parse((await victim.agent.get(`${victim.base}/blocks`).expect(200)).body);
    expect(after.map((block) => block.id)).toEqual(victimBlocks.map((block) => block.id));
    const victimSite = await prisma.site.findUniqueOrThrow({ where: { id: victim.siteId }, include: { theme: true } });
    expect(victimSite.theme?.code).toBe(CAFE.themeCode);
  });

  it("exige sesión y la cabecera CSRF", async () => {
    const { base } = await createOrgWithSite();
    await request(httpServer).post(`${base}/apply-template`).set(CSRF_HEADERS).send({ templateCode: CAFE.code }).expect(401);
    const { agent, base: ownBase } = await createOrgWithSite();
    await agent.post(`${ownBase}/apply-template`).send({ templateCode: CAFE.code }).expect(403);
  });

  it("F9.2: una página nueva nace con el nombre y el logo de la marca de la organización, sin pisar lo que la persona escribió", async () => {
    const { agent, organizationId, base } = await createOrgWithSite();
    const logo = `https://media.test/branding/org/${organizationId}/logo_light-1.png`;
    await prisma.brandProfile.upsert({
      where: { organizationId },
      update: { displayName: "Café de la Marca", logoLightUrl: logo },
      create: { organizationId, displayName: "Café de la Marca", logoLightUrl: logo },
    });

    const profileOf = (body: unknown) =>
      applyTemplateResponse.parse(body).blocks.find((block) => block.type === "profile")!.config as { name: string; avatar?: { url: string; alt: string } };

    // Sin nombre propio: toma el de la marca, y el logo como avatar.
    const sinNombre = profileOf((await agent.post(`${base}/apply-template`).set(CSRF_HEADERS).send({ templateCode: CAFE.code, discardUnpublishedChanges: true }).expect(200)).body);
    expect(sinNombre.name).toBe("Café de la Marca");
    expect(sinNombre.avatar?.url).toBe(logo);
    expect(sinNombre.avatar?.alt).toContain("Café de la Marca");

    // Con nombre propio: se respeta; el logo sigue siendo el avatar por defecto.
    const conNombre = profileOf(
      (await agent.post(`${base}/apply-template`).set(CSRF_HEADERS).send({ templateCode: CAFE.code, discardUnpublishedChanges: true, personalization: { name: "Mi nombre" } }).expect(200)).body,
    );
    expect(conNombre.name).toBe("Mi nombre");
    expect(conNombre.avatar?.url).toBe(logo);
  });

  it("F9.2: sin marca propia no se inventa un avatar ni se usa el logo de la plataforma", async () => {
    const { agent, base } = await createOrgWithSite();
    const response = await agent.post(`${base}/apply-template`).set(CSRF_HEADERS).send({ templateCode: CAFE.code }).expect(200);
    const profile = applyTemplateResponse.parse(response.body).blocks.find((block) => block.type === "profile")!.config as { name: string; avatar?: unknown };
    expect(profile.avatar).toBeUndefined();
    expect(profile.name).toBe("Tu Café de Barrio");
  });
});
