import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { blockResponse } from "@impulza/contracts";
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
import { listenForTests } from "../../test-support/http.js";

// F2.4 — bloques tipados contra NestJS + Postgres reales.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@blocks-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(prefix = "b4"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Blocks (e2e) — F2.4", () => {
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
    emailAdapter.messages = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function createPageWithOwner(): Promise<{
    agent: ReturnType<typeof request.agent>;
    organizationId: string;
    siteId: string;
    pageId: string;
    basePath: string;
  }> {
    const email = uniqueEmail();
    const password = "password1234";
    const agent = request.agent(httpServer);

    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);

    const org = await agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org Bloques", slug: uniqueSlug("org") })
      .expect(201);
    const site = await agent
      .post(`/api/v1/organizations/${org.body.id}/sites`)
      .set(CSRF_HEADERS)
      .send({ name: "Sitio", slug: uniqueSlug("site") })
      .expect(201);
    const pages = await agent
      .get(`/api/v1/organizations/${org.body.id}/sites/${site.body.id}/pages`)
      .expect(200);
    const pageId = pages.body[0].id;

    return {
      agent,
      organizationId: org.body.id,
      siteId: site.body.id,
      pageId,
      basePath: `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/pages/${pageId}/blocks`,
    };
  }

  describe("tipos y validación de configuración", () => {
    it("crea un bloque de cada tipo del catálogo con una configuración válida", async () => {
      const { agent, basePath } = await createPageWithOwner();

      const samples: Array<[string, unknown]> = [
        ["profile", { name: "Ana Pérez", headline: "Abogada", verified: false }],
        ["hero", { title: "Bienvenido", alignment: "center" }],
        ["text", { html: "<p>Hola</p>", alignment: "left" }],
        ["link", { label: "Agenda", url: "https://ejemplo.cl/agenda", style: "primary" }],
        ["social", { links: [{ network: "instagram", url: "https://instagram.com/ana" }], style: "icons" }],
        ["image", { image: { url: "https://cdn.ejemplo.cl/a.jpg", alt: "Oficina" } }],
        ["gallery", { images: [{ url: "https://cdn.ejemplo.cl/b.jpg", alt: "Sala" }], layout: "grid" }],
        ["video", { video: "https://youtu.be/dQw4w9WgXcQ" }],
        ["whatsapp", { phone: "+56912345678", label: "Escríbenos" }],
        ["contact_actions", { email: "hola@ejemplo.cl", phone: "+56912345678" }],
        ["contact_form", { title: "Contáctanos", fields: ["name", "email"], submitLabel: "Enviar" }],
        ["service", { name: "Asesoría", priceAmount: 5000000, priceCurrency: "clp" }],
        ["divider", { style: "line", size: "md" }],
        ["faq", { items: [{ question: "¿Horario?", answer: "<p>9 a 18</p>" }] }],
        ["testimonials", { items: [{ quote: "Excelente", author: "Juan", rating: 5 }] }],
      ];

      for (const [type, config] of samples) {
        const response = await agent.post(basePath).set(CSRF_HEADERS).send({ type, config });
        expect(response.status, `${type}: ${JSON.stringify(response.body)}`).toBe(201);
        expect(response.body.type).toBe(type);
        expect(response.body.degraded).toBeNull();
      }

      const blocks = await agent.get(basePath).expect(200);
      expect(blocks.body).toHaveLength(samples.length);
    });

    it("rechaza un tipo que no está en el catálogo", async () => {
      const { agent, basePath } = await createPageWithOwner();

      for (const type of ["script", "iframe", "html", "custom"]) {
        await agent.post(basePath).set(CSRF_HEADERS).send({ type, config: {} }).expect(400);
      }
    });

    it("rechaza una configuración que no cumple el esquema del tipo, con el detalle del campo", async () => {
      const { agent, basePath } = await createPageWithOwner();

      const response = await agent
        .post(basePath)
        .set(CSRF_HEADERS)
        .send({ type: "link", config: { label: "Sin URL" } })
        .expect(422);

      expect(response.body.issues.map((i: { path: string }) => i.path)).toContain("url");
    });

    it("una imagen sin texto alternativo se rechaza al guardar, salvo que sea decorativa (PP2)", async () => {
      const { agent, basePath } = await createPageWithOwner();
      const photo = "https://ejemplo.com/foto.jpg";

      const rejected = await agent
        .post(basePath)
        .set(CSRF_HEADERS)
        .send({ type: "gallery", config: { layout: "grid", images: [{ url: photo, alt: "Local" }, { url: photo, alt: "  " }] } })
        .expect(422);
      expect(rejected.body.issues).toEqual([{ path: "images.1.alt", message: expect.stringMatching(/decorativa/) }]);

      await agent.post(basePath).set(CSRF_HEADERS).send({ type: "image", config: { image: { url: photo, alt: "", decorative: true } } }).expect(201);
      const described = await agent.post(basePath).set(CSRF_HEADERS).send({ type: "image", config: { image: { url: photo, alt: "Local" } } }).expect(201);
      await agent
        .patch(`${basePath}/${described.body.id}`)
        .set(CSRF_HEADERS)
        .send({ config: { image: { url: photo, alt: "" } } })
        .expect(422);
    });

    it("rechaza enlaces javascript: y data: en cualquier bloque", async () => {
      const { agent, basePath } = await createPageWithOwner();

      await agent
        .post(basePath)
        .set(CSRF_HEADERS)
        .send({ type: "link", config: { label: "x", url: "javascript:alert(1)" } })
        .expect(422);

      await agent
        .post(basePath)
        .set(CSRF_HEADERS)
        .send({
          type: "image",
          config: { image: { url: "data:text/html,<script>alert(1)</script>", alt: "x" } },
        })
        .expect(422);
    });

    it("solo acepta videos de proveedores de la lista blanca, y guarda proveedor + id", async () => {
      const { agent, basePath } = await createPageWithOwner();

      await agent
        .post(basePath)
        .set(CSRF_HEADERS)
        .send({ type: "video", config: { video: "https://evil.example.com/embed/x" } })
        .expect(422);

      const ok = await agent
        .post(basePath)
        .set(CSRF_HEADERS)
        .send({ type: "video", config: { video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } })
        .expect(201);

      // El contrato publicado en OpenAPI se ejecuta contra la respuesta real: un contrato que
      // nadie corre es documentación, no contrato.
      blockResponse.parse(ok.body);
      // No se guarda una URL de iframe: se guarda lo mínimo para que el render arme un src fijo.
      expect(ok.body.config.video).toEqual({ provider: "youtube", videoId: "dQw4w9WgXcQ" });
    });
  });

  describe("sanitización del texto enriquecido", () => {
    it("el HTML peligroso se limpia antes de guardarse, no al renderizar", async () => {
      const { agent, basePath } = await createPageWithOwner();

      const created = await agent
        .post(basePath)
        .set(CSRF_HEADERS)
        .send({
          type: "text",
          config: {
            html: '<p>Hola</p><script>alert(1)</script><img src=x onerror="alert(2)">',
            alignment: "left",
          },
        })
        .expect(201);

      expect(created.body.config.html).toBe("<p>Hola</p>");

      // Lo importante: lo que quedó guardado en la base ya está limpio.
      const stored = await prisma.blockVersion.findFirstOrThrow({
        where: { blockId: created.body.id },
        orderBy: { versionNumber: "desc" },
      });
      expect(JSON.stringify(stored.config)).not.toContain("script");
      expect(JSON.stringify(stored.config)).not.toContain("onerror");
    });

    it("también sanitiza los campos anidados en listas (faq)", async () => {
      const { agent, basePath } = await createPageWithOwner();

      const created = await agent
        .post(basePath)
        .set(CSRF_HEADERS)
        .send({
          type: "faq",
          config: { items: [{ question: "¿Y?", answer: "<p>ok</p><script>alert(1)</script>" }] },
        })
        .expect(201);

      expect(created.body.config.items[0].answer).toBe("<p>ok</p>");
    });
  });

  describe("versionado de la configuración", () => {
    it("cada guardado crea una versión nueva en vez de pisar la anterior", async () => {
      const { agent, basePath } = await createPageWithOwner();

      const block = await agent
        .post(basePath)
        .set(CSRF_HEADERS)
        .send({ type: "text", config: { html: "<p>v1</p>", alignment: "left" } })
        .expect(201);

      await agent
        .patch(`${basePath}/${block.body.id}`)
        .set(CSRF_HEADERS)
        .send({ config: { html: "<p>v2</p>", alignment: "left" } })
        .expect(200);

      const versions = await prisma.blockVersion.findMany({
        where: { blockId: block.body.id },
        orderBy: { versionNumber: "asc" },
      });

      expect(versions).toHaveLength(2);
      expect(versions[0]?.config).toMatchObject({ html: "<p>v1</p>" });
      expect(versions[1]?.config).toMatchObject({ html: "<p>v2</p>" });
    });

    it("cambiar solo la visibilidad no crea una versión de configuración", async () => {
      const { agent, basePath } = await createPageWithOwner();
      const block = await agent
        .post(basePath)
        .set(CSRF_HEADERS)
        .send({ type: "divider", config: { style: "line", size: "md" } })
        .expect(201);

      await agent.patch(`${basePath}/${block.body.id}`).set(CSRF_HEADERS).send({ visible: false }).expect(200);

      expect(await prisma.blockVersion.count({ where: { blockId: block.body.id } })).toBe(1);
    });
  });

  describe("orden, duplicado, ocultado y eliminación", () => {
    async function createThree(agent: ReturnType<typeof request.agent>, basePath: string) {
      const ids: string[] = [];
      for (const label of ["uno", "dos", "tres"]) {
        const response = await agent
          .post(basePath)
          .set(CSRF_HEADERS)
          .send({ type: "link", config: { label, url: "https://ejemplo.cl" } })
          .expect(201);
        ids.push(response.body.id);
      }
      return ids;
    }

    it("los bloques nuevos se agregan al final y el orden persiste", async () => {
      const { agent, basePath } = await createPageWithOwner();
      const ids = await createThree(agent, basePath);

      const blocks = await agent.get(basePath).expect(200);
      expect(blocks.body.map((b: { id: string }) => b.id)).toEqual(ids);
      expect(blocks.body.map((b: { position: number }) => b.position)).toEqual([0, 1, 2]);
    });

    it("reordenar aplica el orden completo enviado", async () => {
      const { agent, basePath } = await createPageWithOwner();
      const ids = await createThree(agent, basePath);
      const reversed = [...ids].reverse();

      const after = await agent.put(`${basePath}/reorder`).set(CSRF_HEADERS).send({ blockIds: reversed }).expect(200);

      expect(after.body.map((b: { id: string }) => b.id)).toEqual(reversed);
    });

    it("reordenar rechaza listas incompletas o con bloques ajenos", async () => {
      const { agent, basePath } = await createPageWithOwner();
      const ids = await createThree(agent, basePath);

      await agent.put(`${basePath}/reorder`).set(CSRF_HEADERS).send({ blockIds: [ids[0]] }).expect(400);

      const other = await createPageWithOwner();
      const otherBlock = await other.agent
        .post(other.basePath)
        .set(CSRF_HEADERS)
        .send({ type: "divider", config: {} })
        .expect(201);

      await agent
        .put(`${basePath}/reorder`)
        .set(CSRF_HEADERS)
        .send({ blockIds: [...ids.slice(0, 2), otherBlock.body.id] })
        .expect(400);
    });

    it("duplicar copia la configuración y queda justo debajo del original", async () => {
      const { agent, basePath } = await createPageWithOwner();
      const ids = await createThree(agent, basePath);

      const copy = await agent.post(`${basePath}/${ids[0]}/duplicate`).set(CSRF_HEADERS).expect(201);

      expect(copy.body.config).toMatchObject({ label: "uno" });

      const blocks = await agent.get(basePath).expect(200);
      expect(blocks.body.map((b: { id: string }) => b.id)).toEqual([ids[0], copy.body.id, ids[1], ids[2]]);
    });

    it("ocultar un bloque no lo borra: sigue existiendo con visible=false", async () => {
      const { agent, basePath } = await createPageWithOwner();
      const [first] = await createThree(agent, basePath);

      await agent.patch(`${basePath}/${first}`).set(CSRF_HEADERS).send({ visible: false }).expect(200);

      const blocks = await agent.get(basePath).expect(200);
      expect(blocks.body.find((b: { id: string }) => b.id === first).visible).toBe(false);
    });

    it("eliminar cierra el hueco de posiciones", async () => {
      const { agent, basePath } = await createPageWithOwner();
      const ids = await createThree(agent, basePath);

      await agent.delete(`${basePath}/${ids[1]}`).set(CSRF_HEADERS).expect(204);

      const blocks = await agent.get(basePath).expect(200);
      expect(blocks.body.map((b: { id: string }) => b.id)).toEqual([ids[0], ids[2]]);
      expect(blocks.body.map((b: { position: number }) => b.position)).toEqual([0, 1]);
    });
  });

  describe("degradación controlada", () => {
    it("un bloque guardado con un tipo desconocido se marca degradado en vez de romper el listado", async () => {
      const { agent, basePath, pageId } = await createPageWithOwner();
      await agent
        .post(basePath)
        .set(CSRF_HEADERS)
        .send({ type: "divider", config: { style: "line", size: "md" } })
        .expect(201);

      // Simula un bloque escrito por una versión futura del producto (o un rollback).
      const rogue = await prisma.block.create({
        data: { pageId, type: "bloque_del_futuro", position: 99, configSchemaVersion: 1 },
      });
      await prisma.blockVersion.create({
        data: { blockId: rogue.id, versionNumber: 1, config: { lo: "que sea" } },
      });

      const blocks = await agent.get(basePath).expect(200);

      expect(blocks.body).toHaveLength(2);
      expect(blocks.body.find((b: { id: string }) => b.id === rogue.id).degraded).toBe("unknown_type");
      // El bloque sano sigue perfectamente utilizable.
      expect(blocks.body.find((b: { type: string }) => b.type === "divider").degraded).toBeNull();
    });

    it("un bloque con configSchemaVersion futura se marca future_version", async () => {
      const { agent, basePath, pageId } = await createPageWithOwner();

      const future = await prisma.block.create({
        data: { pageId, type: "divider", position: 50, configSchemaVersion: 99 },
      });
      await prisma.blockVersion.create({
        data: { blockId: future.id, versionNumber: 1, config: { style: "line" } },
      });

      const blocks = await agent.get(basePath).expect(200);
      expect(blocks.body.find((b: { id: string }) => b.id === future.id).degraded).toBe("future_version");
    });
  });
});
