import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
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

// F2.3 — páginas: home automática, slug por sitio, orden, visibilidad y borrado lógico.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@pages-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(prefix = "p3"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Pages (e2e) — F2.3", () => {
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
    agent: ReturnType<typeof request.agent>;
    basePath: string;
  }> {
    const { agent } = await registerLoggedInUser();
    const org = await agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org Páginas", slug: uniqueSlug("org") })
      .expect(201);
    const site = await agent
      .post(`/api/v1/organizations/${org.body.id}/sites`)
      .set(CSRF_HEADERS)
      .send({ name: "Sitio", slug: uniqueSlug("site") })
      .expect(201);

    return {
      organizationId: org.body.id,
      siteId: site.body.id,
      agent,
      basePath: `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/pages`,
    };
  }

  describe("página de inicio", () => {
    it("todo sitio nuevo nace con su página de inicio, sin pedirla", async () => {
      const { agent, basePath } = await createSiteWithOwner();

      const pages = await agent.get(basePath).expect(200);

      expect(pages.body).toHaveLength(1);
      expect(pages.body[0]).toMatchObject({ slug: "inicio", isHome: true, position: 0, status: "DRAFT" });
    });

    it("la página de inicio no se puede eliminar ni renombrar", async () => {
      const { agent, basePath } = await createSiteWithOwner();
      const pages = await agent.get(basePath).expect(200);
      const home = pages.body[0];

      await agent.delete(`${basePath}/${home.id}`).set(CSRF_HEADERS).expect(400);
      await agent.patch(`${basePath}/${home.id}`).set(CSRF_HEADERS).send({ slug: "otro-nombre" }).expect(400);

      // Pero sí se le puede cambiar la visibilidad: es una propiedad legítima de la home.
      await agent.patch(`${basePath}/${home.id}`).set(CSRF_HEADERS).send({ visibility: "HIDDEN" }).expect(200);
    });
  });

  describe("slug por sitio", () => {
    it("el slug es único dentro del sitio pero se repite libremente entre sitios", async () => {
      const first = await createSiteWithOwner();

      await first.agent.post(first.basePath).set(CSRF_HEADERS).send({ slug: "contacto" }).expect(201);
      await first.agent.post(first.basePath).set(CSRF_HEADERS).send({ slug: "contacto" }).expect(409);

      // Otro sitio de la MISMA organización puede tener su propio "contacto".
      const otherSite = await first.agent
        .post(`/api/v1/organizations/${first.organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Otro sitio", slug: uniqueSlug("site") })
        .expect(201);

      await first.agent
        .post(`/api/v1/organizations/${first.organizationId}/sites/${otherSite.body.id}/pages`)
        .set(CSRF_HEADERS)
        .send({ slug: "contacto" })
        .expect(201);
    });

    it("aplica el formato, pero NO la lista de reservados del slug de sitio", async () => {
      const { agent, basePath } = await createSiteWithOwner();

      await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "MAYUS" }).expect(400);
      await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "ab" }).expect(400);
      await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "-borde" }).expect(400);

      // Dentro de su propio sitio el usuario sí puede usar estos nombres: la lista de reservados
      // protege el espacio de nombres de la plataforma, que está un nivel más arriba.
      await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "contacto" }).expect(201);
      await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "blog" }).expect(201);
      await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "admin" }).expect(201);
    });

    it("no se puede crear una segunda página con el slug de la home", async () => {
      const { agent, basePath } = await createSiteWithOwner();
      await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "inicio" }).expect(409);
    });
  });

  describe("orden y visibilidad", () => {
    it("las páginas nuevas se agregan al final y conservan el orden", async () => {
      const { agent, basePath } = await createSiteWithOwner();

      await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "servicios" }).expect(201);
      await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "contacto" }).expect(201);

      const pages = await agent.get(basePath).expect(200);
      expect(pages.body.map((p: { slug: string }) => p.slug)).toEqual(["inicio", "servicios", "contacto"]);
    });

    it("reordenar aplica el orden completo enviado", async () => {
      const { agent, basePath } = await createSiteWithOwner();
      await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "servicios" }).expect(201);
      await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "contacto" }).expect(201);

      const before = await agent.get(basePath).expect(200);
      const reversed = [...before.body].reverse().map((p: { id: string }) => p.id);

      const after = await agent.put(`${basePath}/reorder`).set(CSRF_HEADERS).send({ pageIds: reversed }).expect(200);

      expect(after.body.map((p: { slug: string }) => p.slug)).toEqual(["contacto", "servicios", "inicio"]);
    });

    it("reordenar rechaza listas incompletas, con repetidos o con páginas ajenas", async () => {
      const { agent, basePath } = await createSiteWithOwner();
      await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "servicios" }).expect(201);

      const pages = await agent.get(basePath).expect(200);
      const ids = pages.body.map((p: { id: string }) => p.id);

      // Incompleta.
      await agent.put(`${basePath}/reorder`).set(CSRF_HEADERS).send({ pageIds: [ids[0]] }).expect(400);
      // Con repetidos.
      await agent
        .put(`${basePath}/reorder`)
        .set(CSRF_HEADERS)
        .send({ pageIds: [ids[0], ids[0]] })
        .expect(400);
      // Con una página de otro sitio.
      const other = await createSiteWithOwner();
      const otherPages = await other.agent.get(other.basePath).expect(200);
      await agent
        .put(`${basePath}/reorder`)
        .set(CSRF_HEADERS)
        .send({ pageIds: [ids[0], otherPages.body[0].id] })
        .expect(400);
    });

    it("la visibilidad es independiente del estado de publicación", async () => {
      const { agent, basePath } = await createSiteWithOwner();
      const page = await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "oculta" }).expect(201);

      expect(page.body).toMatchObject({ visibility: "PUBLIC", status: "DRAFT" });

      const hidden = await agent
        .patch(`${basePath}/${page.body.id}`)
        .set(CSRF_HEADERS)
        .send({ visibility: "HIDDEN" })
        .expect(200);

      // Cambiar visibilidad no toca el estado de publicación, y viceversa.
      expect(hidden.body).toMatchObject({ visibility: "HIDDEN", status: "DRAFT" });
    });
  });

  describe("borrado lógico", () => {
    it("borrar una página conserva la fila y su historial de versiones", async () => {
      const { agent, basePath } = await createSiteWithOwner();
      const page = await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "temporal" }).expect(201);

      // Historial previo, como el que dejaría una publicación (F2.6).
      await prisma.pageVersion.create({
        data: { pageId: page.body.id, versionNumber: 1, contentSnapshot: { blocks: [] } },
      });

      await agent.delete(`${basePath}/${page.body.id}`).set(CSRF_HEADERS).expect(200);

      // Ya no aparece en el listado...
      const pages = await agent.get(basePath).expect(200);
      expect(pages.body.map((p: { id: string }) => p.id)).not.toContain(page.body.id);

      // ...pero ni la página ni su historial se destruyeron.
      const row = await prisma.page.findUnique({ where: { id: page.body.id } });
      expect(row).not.toBeNull();
      expect(row?.deletedAt).not.toBeNull();
      expect(await prisma.pageVersion.count({ where: { pageId: page.body.id } })).toBe(1);
    });

    it("el slug de una página borrada queda libre para volver a usarse", async () => {
      const { agent, basePath } = await createSiteWithOwner();
      const page = await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "reutilizable" }).expect(201);

      await agent.delete(`${basePath}/${page.body.id}`).set(CSRF_HEADERS).expect(200);

      // Sin el índice único *parcial* esto daría 409 para siempre.
      await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "reutilizable" }).expect(201);
    });

    it("restaurar devuelve la página, y falla con 409 si su slug fue reocupado", async () => {
      const { agent, basePath } = await createSiteWithOwner();
      const page = await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "volvera" }).expect(201);
      await agent.delete(`${basePath}/${page.body.id}`).set(CSRF_HEADERS).expect(200);

      // Nadie tomó el slug: restaura bien.
      await agent.post(`${basePath}/${page.body.id}/restore`).set(CSRF_HEADERS).expect(201);
      const restored = await agent.get(basePath).expect(200);
      expect(restored.body.map((p: { slug: string }) => p.slug)).toContain("volvera");

      // Ahora se borra de nuevo y otra página le roba el slug.
      await agent.delete(`${basePath}/${page.body.id}`).set(CSRF_HEADERS).expect(200);
      await agent.post(basePath).set(CSRF_HEADERS).send({ slug: "volvera" }).expect(201);

      await agent.post(`${basePath}/${page.body.id}/restore`).set(CSRF_HEADERS).expect(409);
    });
  });

  describe("permisos", () => {
    it("EDITOR gestiona páginas pero no las borra", async () => {
      const { organizationId, basePath, agent: ownerAgent } = await createSiteWithOwner();

      const { agent: editorAgent, email } = await registerLoggedInUser();
      const invite = await ownerAgent
        .post(`/api/v1/organizations/${organizationId}/members`)
        .set(CSRF_HEADERS)
        .send({ email, role: "EDITOR" })
        .expect(201);
      await editorAgent
        .post(`/api/v1/memberships/${invite.body.membershipId}/accept`)
        .set(CSRF_HEADERS)
        .expect(204);

      const page = await editorAgent.post(basePath).set(CSRF_HEADERS).send({ slug: "del-editor" }).expect(201);
      await editorAgent
        .patch(`${basePath}/${page.body.id}`)
        .set(CSRF_HEADERS)
        .send({ visibility: "HIDDEN" })
        .expect(200);

      await editorAgent.delete(`${basePath}/${page.body.id}`).set(CSRF_HEADERS).expect(403);
    });
  });
});
