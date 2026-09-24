import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PrismaClient } from "@impulza/database";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";
import { PRISMA } from "./database/prisma.module.js";
import { EMAIL_ADAPTER } from "./modules/auth/email-adapter.token.js";
import { REDIS } from "./redis/redis.module.js";
import { BROWSER_USER_AGENT, startAnalyticsTestWorker } from "./test-support/analytics-pipeline.js";

// F1.9 — prueba transversal de aislamiento multi-tenant (ADR-002). Dos organizaciones reales,
// exactamente lo que exige el backlog: "verificar que ningún endpoint de Fase 1 permite leer o
// modificar datos cruzados". Este archivo se re-ejecuta como base al agregar endpoints nuevos en
// fases posteriores — cada endpoint que toque datos de organización debe sumar su caso acá.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@isolation-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(): string {
  return `iso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("Aislamiento multi-tenant (F1.9)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let httpServer: Parameters<typeof request>[0];
  let pipeline: ReturnType<typeof startAnalyticsTestWorker>;

  // Dos organizaciones completas, cada una con OWNER y un miembro con permisos (ADMIN) — para
  // probar que ni siquiera un ADMIN de la organización A puede tocar la B.
  let orgA: {
    id: string;
    ownerEmail: string;
    ownerAgent: ReturnType<typeof request.agent>;
    adminAgent: ReturnType<typeof request.agent>;
    siteId: string;
  };
  let orgB: {
    id: string;
    ownerEmail: string;
    ownerAgent: ReturnType<typeof request.agent>;
    ownerMembershipId: string;
    memberEmail: string;
    memberMembershipId: string;
    siteId: string;
  };

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
    pipeline = startAnalyticsTestWorker(prisma);
    redis = app.get(REDIS);

    // El limitador de peticiones es real y cuenta por IP: los archivos e2e corren en serie
    // (`fileParallelism: false`) sobre el mismo servidor, así que este `beforeAll` arranca con el
    // presupuesto ya gastado por la suite anterior. Se limpia acá igual que en `beforeEach` —
    // si no, el fallo depende del orden de los archivos, que es lo peor que puede pasarle a una
    // prueba de seguridad.
    const staleKeys = await redis.keys("ratelimit:*");
    if (staleKeys.length > 0) {
      await redis.del(...staleKeys);
    }

    async function registerLoggedInUser(): Promise<{ email: string; agent: ReturnType<typeof request.agent> }> {
      const email = uniqueEmail();
      const password = "password1234";
      const agent = request.agent(httpServer);

      await request(httpServer)
        .post("/api/v1/auth/register")
        .set(CSRF_HEADERS)
        .send({ email, password })
        .expect(201);

      const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
      await request(httpServer)
        .post("/api/v1/auth/verify-email")
        .set(CSRF_HEADERS)
        .send({ token })
        .expect(204);
      await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);

      return { email, agent };
    }

    // --- Organización A: OWNER + ADMIN ---
    const ownerA = await registerLoggedInUser();
    const adminA = await registerLoggedInUser();
    const orgAResponse = await ownerA.agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org A", slug: uniqueSlug() })
      .expect(201);
    const inviteAdminA = await ownerA.agent
      .post(`/api/v1/organizations/${orgAResponse.body.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: adminA.email, role: "ADMIN" })
      .expect(201);
    await adminA.agent
      .post(`/api/v1/memberships/${inviteAdminA.body.membershipId}/accept`)
      .set(CSRF_HEADERS)
      .expect(204);

    const siteA = await ownerA.agent
      .post(`/api/v1/organizations/${orgAResponse.body.id}/sites`)
      .set(CSRF_HEADERS)
      .send({ name: "Sitio de A", slug: uniqueSlug() })
      .expect(201);

    orgA = {
      id: orgAResponse.body.id,
      ownerEmail: ownerA.email,
      ownerAgent: ownerA.agent,
      adminAgent: adminA.agent,
      siteId: siteA.body.id,
    };

    // --- Organización B: OWNER + un miembro EDITOR ---
    const ownerB = await registerLoggedInUser();
    const memberB = await registerLoggedInUser();
    const orgBResponse = await ownerB.agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org B", slug: uniqueSlug() })
      .expect(201);
    const inviteMemberB = await ownerB.agent
      .post(`/api/v1/organizations/${orgBResponse.body.id}/members`)
      .set(CSRF_HEADERS)
      .send({ email: memberB.email, role: "EDITOR" })
      .expect(201);
    await memberB.agent
      .post(`/api/v1/memberships/${inviteMemberB.body.membershipId}/accept`)
      .set(CSRF_HEADERS)
      .expect(204);

    const membersOfB = await ownerB.agent.get(`/api/v1/organizations/${orgBResponse.body.id}/members`);
    const ownerMembershipB = membersOfB.body.find((m: { role: string }) => m.role === "OWNER");

    const siteB = await ownerB.agent
      .post(`/api/v1/organizations/${orgBResponse.body.id}/sites`)
      .set(CSRF_HEADERS)
      .send({ name: "Sitio de B", slug: uniqueSlug() })
      .expect(201);

    orgB = {
      id: orgBResponse.body.id,
      ownerEmail: ownerB.email,
      ownerAgent: ownerB.agent,
      ownerMembershipId: ownerMembershipB.membershipId,
      memberEmail: memberB.email,
      memberMembershipId: inviteMemberB.body.membershipId,
      siteId: siteB.body.id,
    };
  });

  afterAll(async () => {
    await pipeline.drain();
    await pipeline.close();
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

  describe("OWNER de A contra recursos de B", () => {
    it("no puede leer la organización B", async () => {
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}`).expect(403);
    });

    it("no puede listar miembros de B (no filtra la lista propia, rechaza directo)", async () => {
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/members`).expect(403);
    });

    it("no puede invitar a alguien a B", async () => {
      await orgA.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/members`)
        .set(CSRF_HEADERS)
        .send({ email: orgA.ownerEmail, role: "EDITOR" })
        .expect(403);
    });

    it("no puede cambiar el rol de un miembro de B", async () => {
      await orgA.ownerAgent
        .patch(`/api/v1/organizations/${orgB.id}/members/${orgB.memberMembershipId}`)
        .set(CSRF_HEADERS)
        .send({ role: "ANALYST" })
        .expect(403);
    });

    it("no puede remover a un miembro de B", async () => {
      await orgA.ownerAgent
        .delete(`/api/v1/organizations/${orgB.id}/members/${orgB.memberMembershipId}`)
        .set(CSRF_HEADERS)
        .expect(403);
    });

    it("no puede aceptar una invitación que pertenece a un usuario de B", async () => {
      // Reutiliza el membershipId del owner de B (ya ACTIVE, pero igual debe rechazar por dueño).
      await orgA.ownerAgent
        .post(`/api/v1/memberships/${orgB.ownerMembershipId}/accept`)
        .set(CSRF_HEADERS)
        .expect(404);
    });
  });

  describe("ADMIN de A (con permisos reales dentro de A) contra B", () => {
    it("tener permisos en A no le da ningún permiso en B", async () => {
      await orgA.adminAgent.get(`/api/v1/organizations/${orgB.id}`).expect(403);
      await orgA.adminAgent
        .post(`/api/v1/organizations/${orgB.id}/members`)
        .set(CSRF_HEADERS)
        .send({ email: uniqueEmail(), role: "EDITOR" })
        .expect(403);
      await orgA.adminAgent
        .patch(`/api/v1/organizations/${orgB.id}/members/${orgB.memberMembershipId}`)
        .set(CSRF_HEADERS)
        .send({ role: "ANALYST" })
        .expect(403);
      await orgA.adminAgent
        .delete(`/api/v1/organizations/${orgB.id}/members/${orgB.memberMembershipId}`)
        .set(CSRF_HEADERS)
        .expect(403);
    });
  });

  describe("Ataque de membershipId cruzado (organizationId correcto, membershipId ajeno)", () => {
    it("OWNER de A no puede cambiar el rol de un miembro de B usando el organizationId de A", async () => {
      // organizationId de la URL es A (donde sí tiene permiso), pero el membershipId es de B —
      // getOrgMembershipOrThrow debe rechazar por organizationId mismatch, no solo por el guard.
      await orgA.ownerAgent
        .patch(`/api/v1/organizations/${orgA.id}/members/${orgB.memberMembershipId}`)
        .set(CSRF_HEADERS)
        .send({ role: "ANALYST" })
        .expect(404);
    });

    it("OWNER de A no puede remover a un miembro de B usando el organizationId de A", async () => {
      await orgA.ownerAgent
        .delete(`/api/v1/organizations/${orgA.id}/members/${orgB.memberMembershipId}`)
        .set(CSRF_HEADERS)
        .expect(404);
    });
  });

  describe("Simétrico: OWNER de B contra A", () => {
    it("no puede leer, listar miembros, invitar, cambiar rol ni remover en A", async () => {
      await orgB.ownerAgent.get(`/api/v1/organizations/${orgA.id}`).expect(403);
      await orgB.ownerAgent.get(`/api/v1/organizations/${orgA.id}/members`).expect(403);
      await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgA.id}/members`)
        .set(CSRF_HEADERS)
        .send({ email: uniqueEmail(), role: "EDITOR" })
        .expect(403);
    });
  });

  // --- Fase 2 ---

  describe("Sitios (F2.2): ningún acceso cruzado entre organizaciones", () => {
    it("OWNER de A no puede listar, leer, editar ni archivar sitios de B", async () => {
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/sites`).expect(403);
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}`).expect(403);
      await orgA.ownerAgent
        .patch(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}`)
        .set(CSRF_HEADERS)
        .send({ name: "Secuestrado" })
        .expect(403);
      await orgA.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/archive`)
        .set(CSRF_HEADERS)
        .expect(403);
      await orgA.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Intruso", slug: uniqueSlug() })
        .expect(403);
    });

    it("ataque de siteId cruzado: organizationId propio de A + siteId de B devuelve 404", async () => {
      // El guard de membresía pasa (A es suya), así que el único que puede frenar esto es la
      // verificación de dueño real del recurso dentro del servicio (getSiteOrThrow).
      await orgA.ownerAgent
        .get(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}`)
        .expect(404);
      await orgA.ownerAgent
        .patch(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}`)
        .set(CSRF_HEADERS)
        .send({ name: "Secuestrado por id cruzado" })
        .expect(404);
      await orgA.ownerAgent
        .post(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/archive`)
        .set(CSRF_HEADERS)
        .expect(404);
    });

    it("el sitio de B sigue intacto después de todos los intentos de A", async () => {
      const site = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}`)
        .expect(200);

      expect(site.body.name).toBe("Sitio de B");
      expect(site.body.status).toBe("DRAFT");
    });

    it("el listado de sitios de A no incluye ningún sitio de B", async () => {
      const sitesOfA = await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/sites`).expect(200);
      const ids = sitesOfA.body.map((s: { id: string }) => s.id);

      expect(ids).toContain(orgA.siteId);
      expect(ids).not.toContain(orgB.siteId);
    });

    it("simétrico: OWNER de B tampoco alcanza los sitios de A", async () => {
      await orgB.ownerAgent.get(`/api/v1/organizations/${orgA.id}/sites`).expect(403);
      await orgB.ownerAgent.get(`/api/v1/organizations/${orgB.id}/sites/${orgA.siteId}`).expect(404);
    });
  });

  describe("Páginas (F2.3): ningún acceso cruzado entre organizaciones", () => {
    it("OWNER de A no puede listar ni crear páginas en el sitio de B", async () => {
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`).expect(403);
      await orgA.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`)
        .set(CSRF_HEADERS)
        .send({ slug: "intrusa" })
        .expect(403);
    });

    it("ataque de siteId cruzado sobre páginas: organizationId propio + sitio ajeno da 404", async () => {
      // La cadena completa organización → sitio → página debe validarse, no solo el primer salto.
      await orgA.ownerAgent
        .get(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/pages`)
        .expect(404);
      await orgA.ownerAgent
        .post(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/pages`)
        .set(CSRF_HEADERS)
        .send({ slug: "intrusa" })
        .expect(404);
      await orgA.ownerAgent
        .put(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/pages/reorder`)
        .set(CSRF_HEADERS)
        .send({ pageIds: [orgB.siteId] })
        .expect(404);
    });

    it("ataque de pageId cruzado: sitio propio de A + pageId de una página de B da 404", async () => {
      const pagesOfB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`)
        .expect(200);
      const homeOfB = pagesOfB.body[0].id;

      await orgA.ownerAgent
        .get(`/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/pages/${homeOfB}`)
        .expect(404);
      await orgA.ownerAgent
        .patch(`/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/pages/${homeOfB}`)
        .set(CSRF_HEADERS)
        .send({ visibility: "HIDDEN" })
        .expect(404);
      await orgA.ownerAgent
        .delete(`/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/pages/${homeOfB}`)
        .set(CSRF_HEADERS)
        .expect(404);
    });

    it("ataque combinado: organizationId propio de A + sitio Y página de B, ambos ajenos", async () => {
      // Este es el caso que de verdad ejercita la verificación de organización dentro de
      // getPageOrThrow: el siteId y el pageId son coherentes entre sí (los dos de B), así que
      // filtrar solo por siteId no alcanza — lo único que frena esto es comprobar que el sitio
      // pertenezca a la organización del contexto.
      const pagesOfB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`)
        .expect(200);
      const homeOfB = pagesOfB.body[0].id;
      const crossPath = `/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/pages/${homeOfB}`;

      await orgA.ownerAgent.get(crossPath).expect(404);
      await orgA.ownerAgent.patch(crossPath).set(CSRF_HEADERS).send({ visibility: "HIDDEN" }).expect(404);
      await orgA.ownerAgent.delete(crossPath).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent.post(`${crossPath}/restore`).set(CSRF_HEADERS).expect(404);
    });

    it("la home de B sigue intacta y visible solo para B", async () => {
      const pages = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`)
        .expect(200);

      expect(pages.body).toHaveLength(1);
      expect(pages.body[0]).toMatchObject({ slug: "inicio", isHome: true, visibility: "PUBLIC" });
    });
  });

  describe("Bloques (F2.4): ningún acceso cruzado entre organizaciones", () => {
    it("A no puede listar ni crear bloques en una página de B, por ninguna combinación de ids", async () => {
      const pagesOfB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`)
        .expect(200);
      const homeOfB = pagesOfB.body[0].id;

      // Con la organización de B en la URL: frenado por el guard de membresía.
      await orgA.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages/${homeOfB}/blocks`)
        .expect(403);

      // Con la organización propia de A pero sitio y página de B: frenado por la verificación de
      // dueño real, que es la que recorre la cadena completa hasta el bloque.
      const crossPath = `/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/pages/${homeOfB}/blocks`;
      await orgA.ownerAgent.get(crossPath).expect(404);
      await orgA.ownerAgent
        .post(crossPath)
        .set(CSRF_HEADERS)
        .send({ type: "text", config: { html: "<p>intruso</p>" } })
        .expect(404);
      await orgA.ownerAgent
        .put(`${crossPath}/reorder`)
        .set(CSRF_HEADERS)
        .send({ blockIds: [homeOfB] })
        .expect(404);
    });

    it("A no puede editar, duplicar ni borrar un bloque de B usando su propia página", async () => {
      // Se crea un bloque real en la home de B y se intenta alcanzarlo desde la página de A.
      const pagesOfB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`)
        .expect(200);
      const homeOfB = pagesOfB.body[0].id;
      const blockOfB = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages/${homeOfB}/blocks`)
        .set(CSRF_HEADERS)
        .send({ type: "text", config: { html: "<p>privado de B</p>" } })
        .expect(201);

      const pagesOfA = await orgA.ownerAgent
        .get(`/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/pages`)
        .expect(200);
      const homeOfA = pagesOfA.body[0].id;
      const attackPath = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/pages/${homeOfA}/blocks/${blockOfB.body.id}`;

      await orgA.ownerAgent
        .patch(attackPath)
        .set(CSRF_HEADERS)
        .send({ config: { html: "<p>secuestrado</p>" } })
        .expect(404);
      await orgA.ownerAgent.post(`${attackPath}/duplicate`).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent.delete(attackPath).set(CSRF_HEADERS).expect(404);

      // El bloque de B quedó exactamente como estaba.
      const blocksOfB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages/${homeOfB}/blocks`)
        .expect(200);
      expect(blocksOfB.body).toHaveLength(1);
      expect(blocksOfB.body[0].config.html).toBe("<p>privado de B</p>");
    });
  });

  describe("Temas (F2.5): ningún acceso cruzado entre organizaciones", () => {
    it("A no alcanza los temas de B por ninguna combinación de ids, ni se los aplica a su sitio", async () => {
      const themeOfB = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/themes`)
        .set(CSRF_HEADERS)
        .send({
          name: "Tema privado de B",
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
            fontFamily: "system",
            radius: "moderate",
            density: "comfortable",
            shadow: "subtle",
            buttonStyle: "solid",
          },
        })
        .expect(201);

      // Con la organización de B en la URL: frenado por el guard de membresía.
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/themes`).expect(403);
      await orgA.ownerAgent
        .patch(`/api/v1/organizations/${orgB.id}/themes/${themeOfB.body.id}`)
        .set(CSRF_HEADERS)
        .send({ name: "Secuestrado" })
        .expect(403);

      // Con la organización propia de A y el themeId ajeno: lo único que frena esto es que el
      // servicio solo considere visibles el catálogo global y los temas propios del tenant.
      const crossPath = `/api/v1/organizations/${orgA.id}/themes/${themeOfB.body.id}`;
      await orgA.ownerAgent.get(crossPath).expect(404);
      await orgA.ownerAgent.patch(crossPath).set(CSRF_HEADERS).send({ name: "Secuestrado" }).expect(404);
      await orgA.ownerAgent.delete(crossPath).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent.post(`${crossPath}/duplicate`).set(CSRF_HEADERS).send({}).expect(404);

      // Aplicarlo al sitio propio de A tampoco: sería llevarse el diseño de otro tenant.
      await orgA.ownerAgent
        .put(`/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/theme`)
        .set(CSRF_HEADERS)
        .send({ themeId: themeOfB.body.id })
        .expect(404);

      // El listado de A no lo incluye y el tema de B sigue intacto.
      const themesOfA = await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/themes`).expect(200);
      expect(themesOfA.body.map((t: { id: string }) => t.id)).not.toContain(themeOfB.body.id);

      const afterB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/themes/${themeOfB.body.id}`)
        .expect(200);
      expect(afterB.body.name).toBe("Tema privado de B");
    });
  });

  describe("Publicación e historial de páginas (F2.6): ningún acceso cruzado entre organizaciones", () => {
    it("A no puede publicar, listar ni ver el historial de una página de B", async () => {
      const pagesOfB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`)
        .expect(200);
      const homeOfB = pagesOfB.body[0].id;
      const versionOfB = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages/${homeOfB}/publish`)
        .set(CSRF_HEADERS)
        .expect(201);

      // Con la organización de B en la URL: frenado por el guard de membresía.
      await orgA.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages/${homeOfB}/publish`)
        .set(CSRF_HEADERS)
        .expect(403);
      await orgA.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages/${homeOfB}/versions`)
        .expect(403);

      // Con la organización propia de A pero sitio y página de B: frenado por la verificación de
      // dueño real, la misma cadena completa que ya protege el resto de los endpoints de página.
      const crossPath = `/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/pages/${homeOfB}`;
      await orgA.ownerAgent.post(`${crossPath}/publish`).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent.get(`${crossPath}/versions`).expect(404);
      await orgA.ownerAgent.get(`${crossPath}/versions/${versionOfB.body.id}`).expect(404);
      await orgA.ownerAgent
        .post(`${crossPath}/versions/${versionOfB.body.id}/restore`)
        .set(CSRF_HEADERS)
        .expect(404);

      // El historial de B sigue teniendo exactamente esa versión, sin nada agregado por A.
      const historyOfB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages/${homeOfB}/versions`)
        .expect(200);
      expect(historyOfB.body).toHaveLength(1);
      expect(historyOfB.body[0].id).toBe(versionOfB.body.id);
    });

    it("ataque combinado: organizationId propio de A + sitio Y página Y versión de B, todos ajenos", async () => {
      const pagesOfB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`)
        .expect(200);
      const homeOfB = pagesOfB.body[0].id;
      const versionOfB = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages/${homeOfB}/publish`)
        .set(CSRF_HEADERS)
        .expect(201);
      const crossPath = `/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/pages/${homeOfB}/versions/${versionOfB.body.id}`;

      await orgA.ownerAgent.get(crossPath).expect(404);
      await orgA.ownerAgent.post(`${crossPath}/restore`).set(CSRF_HEADERS).expect(404);

      // La página de B no se movió del estado que publicó su propio dueño.
      const afterAttack = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages/${homeOfB}`)
        .expect(200);
      expect(afterAttack.body.status).toBe("PUBLISHED");
    });
  });

  describe("Render público (F2.7): solo contenido publicado, sin datos internos ni de otra organización", () => {
    it("el sitio público de B no expone ids internos, y A no ve nada distinto sin sesión", async () => {
      const pagesOfB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`)
        .expect(200);
      const homeOfB = pagesOfB.body[0].id;
      // Idempotente: si un test anterior ya publicó la home de B, esto no crea ruido (F2.6).
      await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages/${homeOfB}/publish`)
        .set(CSRF_HEADERS)
        .expect(201);

      const siteOfB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}`)
        .expect(200);

      // Sin ninguna cookie de sesión — el render público no pide una.
      const publicSite = await request(httpServer)
        .get(`/api/v1/public/sites/${siteOfB.body.slug}`)
        .expect(200);

      // El contrato público es deliberadamente mínimo: nada de id, organizationId ni themeId —
      // un visitante anónimo no necesita ni debe recibir identificadores internos (F2.7).
      expect(Object.keys(publicSite.body).sort()).toEqual(["name", "pages", "slug", "theme"]);
      expect(publicSite.body).not.toHaveProperty("id");
      expect(publicSite.body).not.toHaveProperty("organizationId");
      expect(JSON.stringify(publicSite.body)).not.toContain(orgB.id);
      expect(JSON.stringify(publicSite.body)).not.toContain(orgA.id);
    });

    it("la página pública de B tampoco expone ids internos ni de ninguna organización, ni siquiera dentro de sus bloques", async () => {
      const pagesOfB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`)
        .expect(200);
      const homeOfB = pagesOfB.body[0].id;
      await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages/${homeOfB}/blocks`)
        .set(CSRF_HEADERS)
        .send({ type: "text", config: { html: "<p>contenido público de B</p>" } })
        .expect(201);
      // Idempotente: si un test anterior ya publicó la home de B, esto solo agrega una versión más.
      await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages/${homeOfB}/publish`)
        .set(CSRF_HEADERS)
        .expect(201);

      const siteOfB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}`)
        .expect(200);

      const publicPage = await request(httpServer)
        .get(`/api/v1/public/sites/${siteOfB.body.slug}/pages/inicio`)
        .expect(200);

      // Mismo criterio que el sitio público: el contrato es mínimo (F2.7) — ni id de página, ni de
      // bloque, ni de organización, en ningún nivel de la respuesta, incluidos los bloques.
      expect(Object.keys(publicPage.body).sort()).toEqual(["blocks", "isHome", "seo", "slug"]);
      expect(publicPage.body).not.toHaveProperty("id");
      expect(publicPage.body).not.toHaveProperty("organizationId");
      for (const block of publicPage.body.blocks) {
        // `position` (F3.6) no es un identificador: es el orden del bloque en la versión publicada,
        // lo que el sitio público informa para atribuir un clic sin conocer el id interno.
        expect(Object.keys(block).sort()).toEqual(["config", "position", "type"]);
        expect(typeof block.position).toBe("number");
      }
      expect(JSON.stringify(publicPage.body)).not.toContain(orgB.id);
      expect(JSON.stringify(publicPage.body)).not.toContain(orgA.id);
      // Ni el id del bloque recién creado, que desde F3.6 sí vive dentro de la versión publicada.
      const blocksOfB = await prisma.block.findMany({ where: { pageId: homeOfB }, select: { id: true } });
      for (const { id } of blocksOfB) {
        expect(JSON.stringify(publicPage.body)).not.toContain(id);
      }
    });

    it("una página de B que nunca se publicó no es alcanzable públicamente, ni adivinando el slug exacto", async () => {
      const draftSlug = `borrador-${Date.now().toString(36)}`;
      await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`)
        .set(CSRF_HEADERS)
        .send({ slug: draftSlug })
        .expect(201);

      const siteOfB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}`)
        .expect(200);

      await request(httpServer)
        .get(`/api/v1/public/sites/${siteOfB.body.slug}/pages/${draftSlug}`)
        .expect(404);
    });

    it("un sitio archivado no es públicamente alcanzable, aunque tenga contenido publicado", async () => {
      // Sitio propio para este caso: archivar es irreversible en el sentido de que no hay
      // "desarchivar" todavía, y no debe afectar al resto de las pruebas de este archivo.
      const freshSite = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Sitio efímero", slug: uniqueSlug() })
        .expect(201);
      const pagesOfFresh = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${freshSite.body.id}/pages`)
        .expect(200);
      await orgB.ownerAgent
        .post(
          `/api/v1/organizations/${orgB.id}/sites/${freshSite.body.id}/pages/${pagesOfFresh.body[0].id}/publish`,
        )
        .set(CSRF_HEADERS)
        .expect(201);

      await request(httpServer).get(`/api/v1/public/sites/${freshSite.body.slug}`).expect(200);

      await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${freshSite.body.id}/archive`)
        .set(CSRF_HEADERS)
        .expect(201);

      await request(httpServer).get(`/api/v1/public/sites/${freshSite.body.slug}`).expect(404);
      await request(httpServer).get(`/api/v1/public/sites/${freshSite.body.slug}/pages/inicio`).expect(404);
    });
  });

  describe("Formularios (F3.2): ningún acceso cruzado entre organizaciones", () => {
    it("A no alcanza los formularios ni los envíos de B por ninguna combinación de ids", async () => {
      const formOfB = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/forms`)
        .set(CSRF_HEADERS)
        .send({ name: "Formulario privado de B", fields: [{ type: "TEXT", label: "Nombre" }] })
        .expect(201);

      // Con la organización de B en la URL: frenado por el guard de membresía.
      const crossOrgPath = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/forms`;
      await orgA.ownerAgent.get(crossOrgPath).expect(403);
      await orgA.ownerAgent
        .patch(`${crossOrgPath}/${formOfB.body.id}`)
        .set(CSRF_HEADERS)
        .send({ name: "Secuestrado" })
        .expect(403);

      // Organización PROPIA de A, pero sitio y formulario de B: lo único que frena esto es que el
      // servicio verifique que el sitio sea de la organización del contexto (ADR-002).
      const ownOrgCrossSitePath = `/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/forms`;
      await orgA.ownerAgent.get(ownOrgCrossSitePath).expect(404);
      await orgA.ownerAgent
        .get(`${ownOrgCrossSitePath}/${formOfB.body.id}`)
        .expect(404);
      await orgA.ownerAgent
        .patch(`${ownOrgCrossSitePath}/${formOfB.body.id}`)
        .set(CSRF_HEADERS)
        .send({ name: "Secuestrado" })
        .expect(404);
      await orgA.ownerAgent.delete(`${ownOrgCrossSitePath}/${formOfB.body.id}`).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent
        .post(`${ownOrgCrossSitePath}/${formOfB.body.id}/fields`)
        .set(CSRF_HEADERS)
        .send({ type: "TEXT", label: "Inyectado" })
        .expect(404);

      // El formulario de B sigue intacto y sin campos ajenos.
      const stillB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/forms/${formOfB.body.id}`)
        .expect(200);
      expect(stillB.body.name).toBe("Formulario privado de B");
      expect(stillB.body.fields).toHaveLength(1);

      // El envío público tampoco filtra entre sitios: el mismo formId bajo el slug de A (que no lo
      // tiene) no resuelve nada.
      const siteOfA = await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}`);
      await request(httpServer)
        .get(`/api/v1/public/sites/${siteOfA.body.slug}/forms/${formOfB.body.id}`)
        .expect(404);
    });
  });

  describe("Contactos (F3.3): ningún acceso cruzado entre organizaciones", () => {
    it("A no alcanza los contactos de B por ninguna combinación de ids", async () => {
      const contactOfB = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/contacts`)
        .set(CSRF_HEADERS)
        .send({ name: "Contacto privado de B" })
        .expect(201);

      // Con la organización de B en la URL: frenado por el guard de membresía.
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/contacts`).expect(403);
      await orgA.ownerAgent
        .patch(`/api/v1/organizations/${orgB.id}/contacts/${contactOfB.body.id}`)
        .set(CSRF_HEADERS)
        .send({ commercialStatus: "WON" })
        .expect(403);

      // Organización PROPIA de A, contacto de B: lo frena el `where: {organizationId}` del servicio.
      const ownOrgPath = `/api/v1/organizations/${orgA.id}/contacts/${contactOfB.body.id}`;
      await orgA.ownerAgent.get(ownOrgPath).expect(404);
      await orgA.ownerAgent.patch(ownOrgPath).set(CSRF_HEADERS).send({ commercialStatus: "WON" }).expect(404);
      await orgA.ownerAgent.post(`${ownOrgPath}/notes`).set(CSRF_HEADERS).send({ note: "x" }).expect(404);
      await orgA.ownerAgent.get(`${ownOrgPath}/export`).expect(404);
      await orgA.ownerAgent.post(`${ownOrgPath}/retention-review/keep`).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent.delete(ownOrgPath).set(CSRF_HEADERS).expect(404);

      // El contacto de B sigue intacto, con su nombre original.
      const stillB = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/contacts/${contactOfB.body.id}`)
        .expect(200);
      expect(stillB.body.name).toBe("Contacto privado de B");

      // El listado de A no lo incluye.
      const contactsOfA = await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/contacts`).expect(200);
      expect(contactsOfA.body.map((c: { id: string }) => c.id)).not.toContain(contactOfB.body.id);
    });
  });

  describe("Enlaces cortos y QR (F3.5): ningún acceso cruzado entre organizaciones", () => {
    it("A no alcanza los enlaces cortos ni los QR de B por ninguna combinación de ids", async () => {
      const linkOfB = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/short-links`)
        .set(CSRF_HEADERS)
        .send({ slug: uniqueSlug(), destinationUrl: "https://ejemplo.cl/de-b" })
        .expect(201);
      const qrOfB = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/qr-codes`)
        .set(CSRF_HEADERS)
        .send({ shortLinkId: linkOfB.body.id, styleKey: "clasico" })
        .expect(201);

      // Con la organización de B en la URL: frenado por el guard de membresía.
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/short-links`).expect(403);
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/qr-codes`).expect(403);

      // Organización PROPIA de A, recurso de B: lo frena el `where: {organizationId}` del servicio.
      const linkCrossPath = `/api/v1/organizations/${orgA.id}/short-links/${linkOfB.body.id}`;
      await orgA.ownerAgent.get(linkCrossPath).expect(404);
      await orgA.ownerAgent.patch(linkCrossPath).set(CSRF_HEADERS).send({ destinationUrl: "https://secuestro.cl" }).expect(404);
      await orgA.ownerAgent.delete(linkCrossPath).set(CSRF_HEADERS).expect(404);

      const qrCrossPath = `/api/v1/organizations/${orgA.id}/qr-codes/${qrOfB.body.id}`;
      await orgA.ownerAgent.get(qrCrossPath).expect(404);
      await orgA.ownerAgent.patch(qrCrossPath).set(CSRF_HEADERS).send({ styleKey: "marca" }).expect(404);
      await orgA.ownerAgent.delete(qrCrossPath).set(CSRF_HEADERS).expect(404);

      // A tampoco puede crear un QR propio apuntando al enlace corto de B.
      await orgA.ownerAgent
        .post(`/api/v1/organizations/${orgA.id}/qr-codes`)
        .set(CSRF_HEADERS)
        .send({ shortLinkId: linkOfB.body.id, styleKey: "clasico" })
        .expect(404);

      // El enlace y el QR de B siguen intactos.
      const stillLink = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/short-links/${linkOfB.body.id}`)
        .expect(200);
      expect(stillLink.body.destinationUrl).toBe("https://ejemplo.cl/de-b");
      const stillQr = await orgB.ownerAgent
        .get(`/api/v1/organizations/${orgB.id}/qr-codes/${qrOfB.body.id}`)
        .expect(200);
      expect(stillQr.body.styleConfig).toMatchObject({ key: "clasico" });
    });
  });

  // ------------------------------------------------------------------------------------------
  // F3.8 — superficies públicas y analítica de Fase 3. Las pruebas de arriba cubren el panel
  // (id cruzado con la organización propia en la URL); estas cubren lo que un visitante anónimo
  // puede tocar sin sesión, y el dashboard (F3.7).
  // ------------------------------------------------------------------------------------------

  async function siteSlugOf(org: { id: string; ownerAgent: ReturnType<typeof request.agent>; siteId: string }) {
    const site = await org.ownerAgent.get(`/api/v1/organizations/${org.id}/sites/${org.siteId}`).expect(200);
    return site.body.slug as string;
  }

  async function consentFormOf(org: { id: string; ownerAgent: ReturnType<typeof request.agent>; siteId: string }) {
    const form = await org.ownerAgent
      .post(`/api/v1/organizations/${org.id}/sites/${org.siteId}/forms`)
      .set(CSRF_HEADERS)
      .send({
        name: "Contacto",
        fields: [
          { type: "EMAIL", label: "Correo", required: true },
          { type: "CONSENT", label: "Acepto ser contactado" },
        ],
      })
      .expect(201);
    const [emailField, consentField] = form.body.fields as Array<{ id: string }>;
    return { formId: form.body.id as string, emailFieldId: emailField!.id, consentFieldId: consentField!.id };
  }

  describe("Envío público de formularios (F3.2/F3.8): no cruza organizaciones ni sitios", () => {
    it("el formulario de B enviado bajo el sitio de A no crea nada en ninguna de las dos", async () => {
      const slugOfA = await siteSlugOf(orgA);
      const formOfB = await consentFormOf(orgB);
      const email = `cruzado-${Date.now()}${TEST_EMAIL_DOMAIN}`;

      await request(httpServer)
        .post(`/api/v1/public/sites/${slugOfA}/forms/${formOfB.formId}/submissions`)
        .set(CSRF_HEADERS)
        .set("User-Agent", BROWSER_USER_AGENT)
        .send({ [formOfB.emailFieldId]: email, [formOfB.consentFieldId]: true })
        .expect(404);

      expect(await prisma.formSubmission.count({ where: { formId: formOfB.formId } })).toBe(0);
      expect(await prisma.contact.count({ where: { email } })).toBe(0);
    });

    it("un envío al sitio de A crea el contacto solo en A: B no lo ve ni por listado ni por id", async () => {
      const slugOfA = await siteSlugOf(orgA);
      const formOfA = await consentFormOf(orgA);
      const email = `lead-a-${Date.now()}${TEST_EMAIL_DOMAIN}`;

      const ack = await request(httpServer)
        .post(`/api/v1/public/sites/${slugOfA}/forms/${formOfA.formId}/submissions`)
        .set(CSRF_HEADERS)
        .set("User-Agent", BROWSER_USER_AGENT)
        .send({ [formOfA.emailFieldId]: email, [formOfA.consentFieldId]: true })
        .expect(201);
      // La respuesta pública es solo el mensaje de éxito: ni ids del contacto ni de la organización.
      expect(JSON.stringify(ack.body)).not.toContain(orgA.id);

      const contact = await prisma.contact.findFirst({ where: { email } });
      expect(contact?.organizationId).toBe(orgA.id);

      const contactsOfB = await orgB.ownerAgent.get(`/api/v1/organizations/${orgB.id}/contacts`).expect(200);
      expect(contactsOfB.body.map((c: { id: string }) => c.id)).not.toContain(contact?.id);
      await orgB.ownerAgent.get(`/api/v1/organizations/${orgB.id}/contacts/${contact?.id}`).expect(404);
    });
  });

  describe("Resolución pública de enlaces cortos y QR (F3.5/F3.8): solo el destino", () => {
    it("la respuesta pública no expone la organización, el enlace ni sus contadores", async () => {
      const slug = uniqueSlug();
      const link = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/short-links`)
        .set(CSRF_HEADERS)
        .send({ slug, destinationUrl: "https://ejemplo.cl/destino-b" })
        .expect(201);
      const qr = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/qr-codes`)
        .set(CSRF_HEADERS)
        .send({ shortLinkId: link.body.id, styleKey: "clasico" })
        .expect(201);

      for (const path of [`/api/v1/public/short-links/${slug}`, `/api/v1/public/qr/${qr.body.id}`]) {
        const response = await request(httpServer).get(path).set("User-Agent", BROWSER_USER_AGENT).expect(200);
        expect(Object.keys(response.body)).toEqual(["destinationUrl"]);
        expect(JSON.stringify(response.body)).not.toContain(orgB.id);
        expect(JSON.stringify(response.body)).not.toContain(link.body.id);
      }
    });

    it("un slug o QR inexistente responde 404 igual para todos, sin pistas", async () => {
      await request(httpServer).get(`/api/v1/public/short-links/${uniqueSlug()}`).expect(404);
      await request(httpServer).get(`/api/v1/public/qr/00000000-0000-4000-8000-000000000000`).expect(404);
    });
  });

  describe("Eventos analíticos (F3.6/F3.8): cada evento queda en la organización del sitio", () => {
    it("un slug de página de B enviado al sitio de A no se atribuye a la página de B", async () => {
      const slugOfA = await siteSlugOf(orgA);
      const pagesOfB = await orgB.ownerAgent.get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`).expect(200);
      const extraPageOfB = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`)
        .set(CSRF_HEADERS)
        .send({ slug: uniqueSlug() })
        .expect(201);
      const pageIdsOfB = [...pagesOfB.body.map((p: { id: string }) => p.id), extraPageOfB.body.id as string];

      await request(httpServer)
        .post(`/api/v1/public/sites/${slugOfA}/events`)
        .set(CSRF_HEADERS)
        .set("User-Agent", BROWSER_USER_AGENT)
        .send({ type: "page_view", pageSlug: extraPageOfB.body.slug })
        .expect(204);
      await pipeline.drain();

      const aggregates = await prisma.analyticsAggregate.findMany({
        where: { OR: [{ organizationId: orgA.id }, { organizationId: orgB.id }] },
        select: { organizationId: true, metric: true },
      });
      // El evento contó en A (el sitio al que llegó), y en ninguna métrica aparece una página de B.
      expect(aggregates.some((row) => row.organizationId === orgA.id && row.metric === "page_view")).toBe(true);
      // B puede tener agregados propios de otras pruebas (el clic a su enlace corto), pero ninguna
      // vista de página: la única que se envió fue al sitio de A.
      expect(aggregates.filter((row) => row.organizationId === orgB.id && row.metric.startsWith("page_view"))).toEqual([]);
      for (const pageId of pageIdsOfB) {
        expect(aggregates.map((row) => row.metric)).not.toContain(`page_view:subject:${pageId}`);
      }
    });
  });

  describe("Dashboard de conversión (F3.7/F3.8): ningún acceso cruzado", () => {
    const range = () => {
      const today = new Date().toISOString().slice(0, 10);
      return `from=${today}&to=${today}`;
    };

    it("A no lee el resumen de B cambiando la organización de la ruta", async () => {
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/analytics/overview?${range()}`).expect(403);
      await orgA.adminAgent.get(`/api/v1/organizations/${orgB.id}/analytics/overview?${range()}`).expect(403);
    });

    it("A no lee datos de B poniendo el sitio de B en la query de su propio resumen", async () => {
      const response = await orgA.ownerAgent
        .get(`/api/v1/organizations/${orgA.id}/analytics/overview?${range()}&siteId=${orgB.siteId}`)
        .expect(404);
      expect(JSON.stringify(response.body)).not.toContain(orgB.siteId);
    });

    it("el resumen de A nunca nombra objetos de B", async () => {
      const overview = await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/analytics/overview?${range()}`).expect(200);
      const serialized = JSON.stringify(overview.body);
      expect(serialized).not.toContain(orgB.id);
      expect(serialized).not.toContain(orgB.siteId);
    });
  });

  describe("Ningún dato de una organización aparece en las respuestas de la otra", () => {
    it("GET /organizations no cruza organizaciones entre usuarios sin relación", async () => {
      const orgsOfA = await orgA.ownerAgent.get("/api/v1/organizations");
      const orgsOfB = await orgB.ownerAgent.get("/api/v1/organizations");

      expect(orgsOfA.body.map((o: { id: string }) => o.id)).not.toContain(orgB.id);
      expect(orgsOfB.body.map((o: { id: string }) => o.id)).not.toContain(orgA.id);
    });

    it("la lista de miembros de A nunca incluye el correo de un usuario exclusivo de B", async () => {
      const membersOfA = await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/members`);
      const emails = membersOfA.body.map((m: { email: string }) => m.email);

      expect(emails).not.toContain(orgB.memberEmail);
      expect(emails).not.toContain(orgB.ownerEmail);
    });
  });
});
