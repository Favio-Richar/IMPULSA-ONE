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

// F2.2 — CRUD de sitios y reglas de slug, contra NestJS + Postgres/Redis reales.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@sites-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(prefix = "s2"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Sites (e2e) — F2.2", () => {
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

  async function createOrgWithOwner(): Promise<{
    organizationId: string;
    agent: ReturnType<typeof request.agent>;
    email: string;
  }> {
    const { agent, email } = await registerLoggedInUser();
    const response = await agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org Sitios", slug: uniqueSlug("org") })
      .expect(201);

    return { organizationId: response.body.id, agent, email };
  }

  async function inviteMemberWithRole(
    ownerAgent: ReturnType<typeof request.agent>,
    organizationId: string,
    role: string,
  ): Promise<ReturnType<typeof request.agent>> {
    const { agent, email } = await registerLoggedInUser();
    const invite = await ownerAgent
      .post(`/api/v1/organizations/${organizationId}/members`)
      .set(CSRF_HEADERS)
      .send({ email, role })
      .expect(201);
    await agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF_HEADERS).expect(204);
    return agent;
  }

  describe("creación y validación de slug", () => {
    it("crea un sitio en estado DRAFT y lo lista", async () => {
      const { organizationId, agent } = await createOrgWithOwner();
      const slug = uniqueSlug();

      const created = await agent
        .post(`/api/v1/organizations/${organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Mi sitio", slug })
        .expect(201);

      expect(created.body).toMatchObject({ name: "Mi sitio", slug, status: "DRAFT", organizationId });

      const list = await agent.get(`/api/v1/organizations/${organizationId}/sites`).expect(200);
      expect(list.body.map((s: { id: string }) => s.id)).toContain(created.body.id);
    });

    it("rechaza slugs con formato inválido (validación de servidor, no del cliente)", async () => {
      const { organizationId, agent } = await createOrgWithOwner();

      for (const slug of ["ab", "MAYUSCULAS", "-borde", "borde-", "con espacio", "con_guionbajo"]) {
        await agent
          .post(`/api/v1/organizations/${organizationId}/sites`)
          .set(CSRF_HEADERS)
          .send({ name: "Sitio", slug })
          .expect(400);
      }
    });

    it("rechaza slugs reservados por la plataforma", async () => {
      const { organizationId, agent } = await createOrgWithOwner();

      for (const slug of ["www", "api", "admin", "panel", "checkout", "sitemap"]) {
        const response = await agent
          .post(`/api/v1/organizations/${organizationId}/sites`)
          .set(CSRF_HEADERS)
          .send({ name: "Sitio", slug })
          .expect(400);
        expect(JSON.stringify(response.body)).toContain("reservado");
      }
    });

    it("rechaza un slug ya tomado, incluso por otra organización (es identidad pública global)", async () => {
      const first = await createOrgWithOwner();
      const second = await createOrgWithOwner();
      const slug = uniqueSlug();

      await first.agent
        .post(`/api/v1/organizations/${first.organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Primero", slug })
        .expect(201);

      await second.agent
        .post(`/api/v1/organizations/${second.organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Segundo", slug })
        .expect(409);
    });

    it("dos creaciones simultáneas del mismo slug dan 201 y 409, nunca un 500", async () => {
      // La comprobación previa de disponibilidad deja una ventana de carrera: ambas peticiones
      // pueden pasarla y una perder en el INSERT. Quien pierde debe ver el mismo 409 de siempre,
      // no una violación de restricción sin traducir.
      const first = await createOrgWithOwner();
      const second = await createOrgWithOwner();
      const slug = uniqueSlug();

      const responses = await Promise.all([
        first.agent
          .post(`/api/v1/organizations/${first.organizationId}/sites`)
          .set(CSRF_HEADERS)
          .send({ name: "Carrera A", slug }),
        second.agent
          .post(`/api/v1/organizations/${second.organizationId}/sites`)
          .set(CSRF_HEADERS)
          .send({ name: "Carrera B", slug }),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    });
  });

  describe("cambio de slug y redirecciones", () => {
    it("cambiar el slug de un sitio PUBLICADO deja una redirección desde el slug viejo", async () => {
      const { organizationId, agent } = await createOrgWithOwner();
      const oldSlug = uniqueSlug();
      const newSlug = uniqueSlug();

      const site = await agent
        .post(`/api/v1/organizations/${organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Publicado", slug: oldSlug })
        .expect(201);

      // La publicación real llega en F2.6; acá se fuerza el estado para probar la regla de slug.
      await prisma.site.update({ where: { id: site.body.id }, data: { status: "PUBLISHED" } });

      await agent
        .patch(`/api/v1/organizations/${organizationId}/sites/${site.body.id}`)
        .set(CSRF_HEADERS)
        .send({ slug: newSlug })
        .expect(200);

      const redirect = await prisma.siteSlugRedirect.findUnique({ where: { fromSlug: oldSlug } });
      expect(redirect).not.toBeNull();
      expect(redirect?.siteId).toBe(site.body.id);
    });

    it("cambiar el slug de un BORRADOR no genera redirección (nunca tuvo enlaces vivos)", async () => {
      const { organizationId, agent } = await createOrgWithOwner();
      const oldSlug = uniqueSlug();

      const site = await agent
        .post(`/api/v1/organizations/${organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Borrador", slug: oldSlug })
        .expect(201);

      await agent
        .patch(`/api/v1/organizations/${organizationId}/sites/${site.body.id}`)
        .set(CSRF_HEADERS)
        .send({ slug: uniqueSlug() })
        .expect(200);

      expect(await prisma.siteSlugRedirect.findUnique({ where: { fromSlug: oldSlug } })).toBeNull();
    });

    it("un slug ocupado por una redirección viva no puede ser tomado por otro sitio", async () => {
      const first = await createOrgWithOwner();
      const oldSlug = uniqueSlug();

      const site = await first.agent
        .post(`/api/v1/organizations/${first.organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Con historial", slug: oldSlug })
        .expect(201);
      await prisma.site.update({ where: { id: site.body.id }, data: { status: "PUBLISHED" } });
      await first.agent
        .patch(`/api/v1/organizations/${first.organizationId}/sites/${site.body.id}`)
        .set(CSRF_HEADERS)
        .send({ slug: uniqueSlug() })
        .expect(200);

      // Otro sitio intenta quedarse con el slug viejo: rompería las URLs redirigidas.
      const second = await createOrgWithOwner();
      await second.agent
        .post(`/api/v1/organizations/${second.organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Oportunista", slug: oldSlug })
        .expect(409);
    });

    it("el mismo sitio sí puede recuperar un slug propio que había dejado atrás", async () => {
      const { organizationId, agent } = await createOrgWithOwner();
      const originalSlug = uniqueSlug();

      const site = await agent
        .post(`/api/v1/organizations/${organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Ida y vuelta", slug: originalSlug })
        .expect(201);
      await prisma.site.update({ where: { id: site.body.id }, data: { status: "PUBLISHED" } });

      await agent
        .patch(`/api/v1/organizations/${organizationId}/sites/${site.body.id}`)
        .set(CSRF_HEADERS)
        .send({ slug: uniqueSlug() })
        .expect(200);

      const back = await agent
        .patch(`/api/v1/organizations/${organizationId}/sites/${site.body.id}`)
        .set(CSRF_HEADERS)
        .send({ slug: originalSlug })
        .expect(200);

      expect(back.body.slug).toBe(originalSlug);
      // La redirección hacia sí mismo se libera: apuntaría del slug actual a él mismo.
      expect(await prisma.siteSlugRedirect.findUnique({ where: { fromSlug: originalSlug } })).toBeNull();
    });

    it("un PATCH sin ningún campo se rechaza en vez de responder 200 sin hacer nada", async () => {
      const { organizationId, agent } = await createOrgWithOwner();
      const site = await agent
        .post(`/api/v1/organizations/${organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Vacío", slug: uniqueSlug() })
        .expect(201);

      await agent
        .patch(`/api/v1/organizations/${organizationId}/sites/${site.body.id}`)
        .set(CSRF_HEADERS)
        .send({})
        .expect(400);
    });
  });

  describe("archivado", () => {
    it("archiva el sitio y es idempotente (archivar dos veces no falla ni duplica auditoría)", async () => {
      const { organizationId, agent } = await createOrgWithOwner();
      const site = await agent
        .post(`/api/v1/organizations/${organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "A archivar", slug: uniqueSlug() })
        .expect(201);

      const first = await agent
        .post(`/api/v1/organizations/${organizationId}/sites/${site.body.id}/archive`)
        .set(CSRF_HEADERS)
        .expect(201);
      expect(first.body.status).toBe("ARCHIVED");

      await agent
        .post(`/api/v1/organizations/${organizationId}/sites/${site.body.id}/archive`)
        .set(CSRF_HEADERS)
        .expect(201);

      const audits = await prisma.auditLog.findMany({
        where: { action: "site.archived", targetId: site.body.id },
      });
      expect(audits).toHaveLength(1);
    });
  });

  describe("permisos por rol (F1.6 aplicado a sitios)", () => {
    it("EDITOR puede editar un sitio pero no crearlo ni archivarlo", async () => {
      const { organizationId, agent: ownerAgent } = await createOrgWithOwner();
      const editorAgent = await inviteMemberWithRole(ownerAgent, organizationId, "EDITOR");

      const site = await ownerAgent
        .post(`/api/v1/organizations/${organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Del owner", slug: uniqueSlug() })
        .expect(201);

      await editorAgent
        .patch(`/api/v1/organizations/${organizationId}/sites/${site.body.id}`)
        .set(CSRF_HEADERS)
        .send({ name: "Editado por EDITOR" })
        .expect(200);

      await editorAgent
        .post(`/api/v1/organizations/${organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "No permitido", slug: uniqueSlug() })
        .expect(403);

      await editorAgent
        .post(`/api/v1/organizations/${organizationId}/sites/${site.body.id}/archive`)
        .set(CSRF_HEADERS)
        .expect(403);
    });

    it("ANALYST solo lee: no crea, no edita, no archiva", async () => {
      const { organizationId, agent: ownerAgent } = await createOrgWithOwner();
      const analystAgent = await inviteMemberWithRole(ownerAgent, organizationId, "ANALYST");

      const site = await ownerAgent
        .post(`/api/v1/organizations/${organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Solo lectura", slug: uniqueSlug() })
        .expect(201);

      await analystAgent.get(`/api/v1/organizations/${organizationId}/sites`).expect(200);
      await analystAgent.get(`/api/v1/organizations/${organizationId}/sites/${site.body.id}`).expect(200);

      await analystAgent
        .post(`/api/v1/organizations/${organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "No", slug: uniqueSlug() })
        .expect(403);
      await analystAgent
        .patch(`/api/v1/organizations/${organizationId}/sites/${site.body.id}`)
        .set(CSRF_HEADERS)
        .send({ name: "No" })
        .expect(403);
      await analystAgent
        .post(`/api/v1/organizations/${organizationId}/sites/${site.body.id}/archive`)
        .set(CSRF_HEADERS)
        .expect(403);
    });
  });

  describe("auditoría", () => {
    it("registra site.created y site.updated con el actor real", async () => {
      const { organizationId, agent, email } = await createOrgWithOwner();
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });

      const site = await agent
        .post(`/api/v1/organizations/${organizationId}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Auditado", slug: uniqueSlug() })
        .expect(201);

      await agent
        .patch(`/api/v1/organizations/${organizationId}/sites/${site.body.id}`)
        .set(CSRF_HEADERS)
        .send({ name: "Auditado v2" })
        .expect(200);

      const logs = await prisma.auditLog.findMany({
        where: { targetId: site.body.id },
        orderBy: { createdAt: "asc" },
      });

      expect(logs.map((l) => l.action)).toEqual(["site.created", "site.updated"]);
      expect(logs.every((l) => l.actorId === user.id && l.organizationId === organizationId)).toBe(true);
    });
  });
});
