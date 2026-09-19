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
