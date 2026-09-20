import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { publicPageResponse, publicSiteResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { Prisma, type PrismaClient } from "@impulza/database";
import { DEFAULT_THEME_CODE } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F2.7 — render público: solo contenido publicado, filtrado de bloques ocultos/programados/
// degradados, y ningún borrador alcanzable ni adivinando el slug exacto.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@public-sites-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(prefix = "pub"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Public sites (e2e) — F2.7", () => {
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

    httpServer = app.getHttpServer();
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
    emailAdapter.messages = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function registerLoggedInUser(): Promise<{ email: string; agent: ReturnType<typeof request.agent> }> {
    const email = uniqueEmail();
    const password = "password1234";
    const agent = request.agent(httpServer);

    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);

    return { email, agent };
  }

  async function createSiteWithOwner(): Promise<{
    organizationId: string;
    siteId: string;
    siteSlug: string;
    agent: ReturnType<typeof request.agent>;
    pagesPath: string;
    sitesPath: string;
  }> {
    const { agent } = await registerLoggedInUser();
    const org = await agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org Pública", slug: uniqueSlug("org") })
      .expect(201);
    const siteSlug = uniqueSlug("site");
    const site = await agent
      .post(`/api/v1/organizations/${org.body.id}/sites`)
      .set(CSRF_HEADERS)
      .send({ name: "Sitio Público", slug: siteSlug })
      .expect(201);

    return {
      organizationId: org.body.id,
      siteId: site.body.id,
      siteSlug,
      agent,
      pagesPath: `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/pages`,
      sitesPath: `/api/v1/organizations/${org.body.id}/sites`,
    };
  }

  async function addTextBlock(
    agent: ReturnType<typeof request.agent>,
    pagesPath: string,
    pageId: string,
    html: string,
    extra: Record<string, unknown> = {},
  ) {
    return agent
      .post(`${pagesPath}/${pageId}/blocks`)
      .set(CSRF_HEADERS)
      .send({ type: "text", config: { html, alignment: "left" }, ...extra })
      .expect(201);
  }

  describe("sitio", () => {
    it("404 en un slug que no existe", async () => {
      await request(httpServer).get(`/api/v1/public/sites/${uniqueSlug("nada")}`).expect(404);
    });

    it("un sitio con la home publicada responde con nombre, tema por defecto y navegación", async () => {
      const { agent, siteSlug, pagesPath } = await createSiteWithOwner();
      const home = (await agent.get(pagesPath).expect(200)).body[0];
      await addTextBlock(agent, pagesPath, home.id, "<p>hola</p>");
      await agent.post(`${pagesPath}/${home.id}/publish`).set(CSRF_HEADERS).expect(201);

      const response = await request(httpServer).get(`/api/v1/public/sites/${siteSlug}`).expect(200);

      publicSiteResponse.parse(response.body);
      expect(response.body.slug).toBe(siteSlug);
      expect(response.body.theme.tokens.fontFamily).toBeDefined();
      // Tema por defecto del catálogo: el sitio nunca asignó uno propio (F2.5).
      const catalogDefault = await prisma.theme.findFirstOrThrow({
        where: { code: DEFAULT_THEME_CODE, organizationId: null },
      });
      expect(response.body.theme.tokens).toEqual(catalogDefault.tokens);
      expect(response.body.pages).toEqual([{ slug: "inicio", isHome: true }]);
    });

    it("un sitio sin ninguna página publicada responde igual (no hay un interruptor de 'sitio' aparte), pero su home todavía no", async () => {
      // Decisión de diseño explícita (F2.7): el único apagador de sitio completo es archivarlo
      // (F2.2, "deja de estar publicado"). Un sitio recién creado, nunca archivado, es alcanzable
      // aunque ninguna de sus páginas se haya publicado todavía — lo que decide si HAY algo que
      // mostrar es cada página, no un estado de "sitio publicado" que nadie pidió en el backlog.
      const { siteSlug } = await createSiteWithOwner();

      const site = await request(httpServer).get(`/api/v1/public/sites/${siteSlug}`).expect(200);
      expect(site.body.pages).toEqual([]);

      await request(httpServer).get(`/api/v1/public/sites/${siteSlug}/pages/inicio`).expect(404);
    });

    it("un sitio archivado ya no es alcanzable, ni el sitio ni sus páginas publicadas", async () => {
      const { agent, siteSlug, siteId, pagesPath, sitesPath } = await createSiteWithOwner();
      const home = (await agent.get(pagesPath).expect(200)).body[0];
      await addTextBlock(agent, pagesPath, home.id, "<p>antes de archivar</p>");
      await agent.post(`${pagesPath}/${home.id}/publish`).set(CSRF_HEADERS).expect(201);

      await request(httpServer).get(`/api/v1/public/sites/${siteSlug}`).expect(200);

      await agent.post(`${sitesPath}/${siteId}/archive`).set(CSRF_HEADERS).expect(201);

      await request(httpServer).get(`/api/v1/public/sites/${siteSlug}`).expect(404);
      await request(httpServer).get(`/api/v1/public/sites/${siteSlug}/pages/inicio`).expect(404);
    });

    it("aplica el tema propio del sitio cuando eligió uno, no el del catálogo", async () => {
      const { agent, organizationId, siteSlug, siteId, pagesPath } = await createSiteWithOwner();
      const home = (await agent.get(pagesPath).expect(200)).body[0];
      await addTextBlock(agent, pagesPath, home.id, "<p>con tema propio</p>");
      await agent.post(`${pagesPath}/${home.id}/publish`).set(CSRF_HEADERS).expect(201);

      const ownTheme = await agent
        .post(`/api/v1/organizations/${organizationId}/themes`)
        .set(CSRF_HEADERS)
        .send({
          name: "Tema del sitio",
          tokens: {
            palette: {
              background: "#ffffff",
              surface: "#f8fafc",
              foreground: "#0f172a",
              mutedForeground: "#475569",
              primary: "#1d4ed8",
              primaryForeground: "#ffffff",
              border: "#e2e8f0",
            },
            fontFamily: "serif",
            radius: "subtle",
            density: "compact",
            shadow: "none",
            buttonStyle: "outline",
          },
        })
        .expect(201);
      await agent
        .put(`/api/v1/organizations/${organizationId}/sites/${siteId}/theme`)
        .set(CSRF_HEADERS)
        .send({ themeId: ownTheme.body.id })
        .expect(200);

      const response = await request(httpServer).get(`/api/v1/public/sites/${siteSlug}`).expect(200);
      expect(response.body.theme.tokens.fontFamily).toBe("serif");
      expect(response.body.theme.tokens.palette.primary).toBe("#1d4ed8");
    });

    it("solo lista en la navegación páginas PUBLIC y publicadas; una HIDDEN publicada no aparece ahí", async () => {
      const { agent, siteSlug, pagesPath } = await createSiteWithOwner();
      const home = (await agent.get(pagesPath).expect(200)).body[0];
      await addTextBlock(agent, pagesPath, home.id, "<p>home</p>");
      await agent.post(`${pagesPath}/${home.id}/publish`).set(CSRF_HEADERS).expect(201);

      const hidden = await agent
        .post(pagesPath)
        .set(CSRF_HEADERS)
        .send({ slug: "secreta", visibility: "HIDDEN" })
        .expect(201);
      await addTextBlock(agent, pagesPath, hidden.body.id, "<p>oculta pero publicada</p>");
      await agent.post(`${pagesPath}/${hidden.body.id}/publish`).set(CSRF_HEADERS).expect(201);

      const draft = await agent.post(pagesPath).set(CSRF_HEADERS).send({ slug: "sin-publicar" }).expect(201);
      void draft;

      const response = await request(httpServer).get(`/api/v1/public/sites/${siteSlug}`).expect(200);
      expect(response.body.pages).toEqual([{ slug: "inicio", isHome: true }]);
    });
  });

  describe("página", () => {
    it("404 en un slug de página que no existe, y en uno que existe pero nunca se publicó", async () => {
      const { agent, siteSlug, pagesPath } = await createSiteWithOwner();
      await request(httpServer).get(`/api/v1/public/sites/${siteSlug}/pages/no-existe`).expect(404);

      await agent.post(pagesPath).set(CSRF_HEADERS).send({ slug: "todavia-borrador" }).expect(201);
      await request(httpServer)
        .get(`/api/v1/public/sites/${siteSlug}/pages/todavia-borrador`)
        .expect(404);
    });

    it("una página HIDDEN y publicada sí es alcanzable por enlace directo", async () => {
      const { agent, siteSlug, pagesPath } = await createSiteWithOwner();
      const hidden = await agent
        .post(pagesPath)
        .set(CSRF_HEADERS)
        .send({ slug: "directa", visibility: "HIDDEN" })
        .expect(201);
      await addTextBlock(agent, pagesPath, hidden.body.id, "<p>alcanzable directo</p>");
      await agent.post(`${pagesPath}/${hidden.body.id}/publish`).set(CSRF_HEADERS).expect(201);

      const response = await request(httpServer)
        .get(`/api/v1/public/sites/${siteSlug}/pages/directa`)
        .expect(200);
      publicPageResponse.parse(response.body);
      expect(response.body.blocks[0].config.html).toBe("<p>alcanzable directo</p>");
    });

    it("la home se resuelve con el slug fijo 'inicio'", async () => {
      const { agent, siteSlug, pagesPath } = await createSiteWithOwner();
      const home = (await agent.get(pagesPath).expect(200)).body[0];
      await addTextBlock(agent, pagesPath, home.id, "<p>soy la home</p>");
      await agent.post(`${pagesPath}/${home.id}/publish`).set(CSRF_HEADERS).expect(201);

      const response = await request(httpServer)
        .get(`/api/v1/public/sites/${siteSlug}/pages/inicio`)
        .expect(200);
      expect(response.body.isHome).toBe(true);
      expect(response.body.blocks[0].config.html).toBe("<p>soy la home</p>");
    });

    it("una página en la papelera no es alcanzable aunque tenga una versión publicada", async () => {
      const { agent, siteSlug, pagesPath } = await createSiteWithOwner();
      const page = await agent.post(pagesPath).set(CSRF_HEADERS).send({ slug: "efimera" }).expect(201);
      await addTextBlock(agent, pagesPath, page.body.id, "<p>antes de borrar</p>");
      await agent.post(`${pagesPath}/${page.body.id}/publish`).set(CSRF_HEADERS).expect(201);
      await request(httpServer).get(`/api/v1/public/sites/${siteSlug}/pages/efimera`).expect(200);

      await agent.delete(`${pagesPath}/${page.body.id}`).set(CSRF_HEADERS).expect(200);

      await request(httpServer).get(`/api/v1/public/sites/${siteSlug}/pages/efimera`).expect(404);
    });

    it("editar después de publicar no cambia lo que ve el público hasta el siguiente publish", async () => {
      const { agent, siteSlug, pagesPath } = await createSiteWithOwner();
      const page = await agent.post(pagesPath).set(CSRF_HEADERS).send({ slug: "estable" }).expect(201);
      const block = await addTextBlock(agent, pagesPath, page.body.id, "<p>v1</p>");
      await agent.post(`${pagesPath}/${page.body.id}/publish`).set(CSRF_HEADERS).expect(201);

      await agent
        .patch(`${pagesPath}/${page.body.id}/blocks/${block.body.id}`)
        .set(CSRF_HEADERS)
        .send({ config: { html: "<p>v2 sin publicar</p>", alignment: "left" } })
        .expect(200);

      const response = await request(httpServer)
        .get(`/api/v1/public/sites/${siteSlug}/pages/estable`)
        .expect(200);
      expect(response.body.blocks[0].config.html).toBe("<p>v1</p>");
    });

    describe("filtrado de bloques", () => {
      it("omite los bloques ocultos (visible: false)", async () => {
        const { agent, siteSlug, pagesPath } = await createSiteWithOwner();
        const page = await agent.post(pagesPath).set(CSRF_HEADERS).send({ slug: "con-ocultos" }).expect(201);
        await addTextBlock(agent, pagesPath, page.body.id, "<p>visible</p>");
        await addTextBlock(agent, pagesPath, page.body.id, "<p>oculto</p>", { visible: false });
        await agent.post(`${pagesPath}/${page.body.id}/publish`).set(CSRF_HEADERS).expect(201);

        const response = await request(httpServer)
          .get(`/api/v1/public/sites/${siteSlug}/pages/con-ocultos`)
          .expect(200);
        expect(response.body.blocks).toHaveLength(1);
        expect(response.body.blocks[0].config.html).toBe("<p>visible</p>");
      });

      it("omite un bloque que todavía no empieza y uno que ya expiró; incluye el vigente", async () => {
        const { agent, siteSlug, pagesPath } = await createSiteWithOwner();
        const page = await agent.post(pagesPath).set(CSRF_HEADERS).send({ slug: "programados" }).expect(201);

        const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        await addTextBlock(agent, pagesPath, page.body.id, "<p>futuro</p>", { scheduledStart: future });
        await addTextBlock(agent, pagesPath, page.body.id, "<p>expirado</p>", { scheduledEnd: past });
        await addTextBlock(agent, pagesPath, page.body.id, "<p>vigente</p>", {
          scheduledStart: past,
        });

        await agent.post(`${pagesPath}/${page.body.id}/publish`).set(CSRF_HEADERS).expect(201);

        const response = await request(httpServer)
          .get(`/api/v1/public/sites/${siteSlug}/pages/programados`)
          .expect(200);
        expect(response.body.blocks).toHaveLength(1);
        expect(response.body.blocks[0].config.html).toBe("<p>vigente</p>");
      });

      it("omite un bloque degradado (tipo desconocido o versión futura) sin romper el resto", async () => {
        const { agent, siteSlug, pagesPath } = await createSiteWithOwner();
        const page = await agent.post(pagesPath).set(CSRF_HEADERS).send({ slug: "con-degradado" }).expect(201);
        await addTextBlock(agent, pagesPath, page.body.id, "<p>bloque sano</p>");
        const published = await agent
          .post(`${pagesPath}/${page.body.id}/publish`)
          .set(CSRF_HEADERS)
          .expect(201);

        // Simula un bloque de un tipo que este despliegue ya no reconoce, inyectado directo en el
        // snapshot ya publicado — mismo escenario que blocks.e2e.test.ts prueba para la API
        // autenticada (rollback de una versión, o un tipo retirado del catálogo).
        const snapshot = published.body.contentSnapshot as { blocks: unknown[] };
        await prisma.pageVersion.update({
          where: { id: published.body.id },
          data: {
            contentSnapshot: {
              ...snapshot,
              blocks: [
                ...snapshot.blocks,
                {
                  type: "un_tipo_que_ya_no_existe",
                  position: 1,
                  configSchemaVersion: 1,
                  visible: true,
                  scheduledStart: null,
                  scheduledEnd: null,
                  config: {},
                },
              ],
            } as Prisma.InputJsonValue,
          },
        });

        const response = await request(httpServer)
          .get(`/api/v1/public/sites/${siteSlug}/pages/con-degradado`)
          .expect(200);
        expect(response.body.blocks).toHaveLength(1);
        expect(response.body.blocks[0].config.html).toBe("<p>bloque sano</p>");
      });
    });
  });
});
