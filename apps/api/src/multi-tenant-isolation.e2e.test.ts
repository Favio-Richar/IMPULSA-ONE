import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PrismaClient } from "@impulza/database";
import { signBookingLinkToken, signUnsubscribeToken, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import {
  publicBookingConfirmationResponse,
  publicManagedBookingResponse,
  publicOrderConfirmationResponse,
  publicUnsubscribeResponse,
} from "@impulza/contracts";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";
import { PRISMA } from "./database/prisma.module.js";
import { env } from "./env.js";
import { EMAIL_ADAPTER } from "./modules/auth/email-adapter.token.js";
import { REDIS } from "./redis/redis.module.js";
import { BROWSER_USER_AGENT, startAnalyticsTestWorker } from "./test-support/analytics-pipeline.js";
import { assignRoomyPlan } from "./test-support/plans.js";
import { listenForTests } from "./test-support/http.js";
import { FeatureFlagsService } from "./modules/feature-flags/feature-flags.service.js";

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

    httpServer = await listenForTests(app);
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
    // Plan con cupo (F4.2): esta suite verifica aislamiento, no los límites de Gratis.
    await assignRoomyPlan(prisma, orgAResponse.body.id);
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
    await assignRoomyPlan(prisma, orgBResponse.body.id);
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
      // PP5: tampoco puede elegir ni quitar la acción principal de una página de B.
      await orgA.ownerAgent.put(`${crossPath}/primary`).set(CSRF_HEADERS).send({ blockId: null }).expect(404);
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
      // PP5: ni marcar el bloque de B como acción principal de la página de A.
      await orgA.ownerAgent
        .put(`/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/pages/${homeOfA}/blocks/primary`)
        .set(CSRF_HEADERS)
        .send({ blockId: blockOfB.body.id })
        .expect(404);
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
      // un visitante anónimo no necesita ni debe recibir identificadores internos (F2.7). `background`
      // (PP3) es el fondo ya resuelto para pintar, sin ids. `measurement` (F7.1, ADR-016) son los
      // identificadores de GA4 y del píxel de Meta, públicos por naturaleza (van en el HTML de
      // cualquier sitio que los usa) y no son ids de Impulza. `homePageSlug` (F7.7, ADR-022) es el
      // slug de la página que se sirve en la raíz (una campaña que toma el inicio): un slug público.
      expect(Object.keys(publicSite.body).sort()).toEqual(["background", "homePageSlug", "measurement", "name", "pages", "slug", "theme"]);
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
        // `primary` (PP5) tampoco: es un booleano, la acción principal de la página.
        expect(Object.keys(block).sort()).toEqual(["config", "position", "primary", "type"]);
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

  // --- F4.9: plan y uso, soporte, medios y administración ---

  describe("Plan y uso (F4.1-F4.3/F4.9): ningún acceso cruzado ni cambio de plan desde el cliente", () => {
    it("A no lee el plan ni el uso de B, y su propio uso nunca cuenta objetos de B", async () => {
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/plan`).expect(403);

      const before = (await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/plan`).expect(200)).body;
      // B crea un sitio más: el uso de A no se mueve.
      await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites`)
        .set(CSRF_HEADERS)
        .send({ name: "Otro sitio de B", slug: uniqueSlug() })
        .expect(201);
      const after = (await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/plan`).expect(200)).body;
      expect(after.usage).toEqual(before.usage);
    });

    it("el plan no se puede cambiar desde el panel: no hay ruta de escritura y un planId enviado se ignora", async () => {
      const paid = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
      for (const method of ["put", "patch", "post"] as const) {
        const response = await orgA.ownerAgent[method](`/api/v1/organizations/${orgA.id}/plan`).set(CSRF_HEADERS).send({ planId: paid.id });
        expect(response.status, method).toBe(404);
      }
      // Tampoco se cuela al crear una organización: nace con el plan por defecto.
      const created = await orgA.ownerAgent
        .post("/api/v1/organizations")
        .set(CSRF_HEADERS)
        .send({ name: "Org con plan colado", slug: uniqueSlug(), planId: paid.id })
        .expect(201);
      const plan = (await orgA.ownerAgent.get(`/api/v1/organizations/${created.body.id}/plan`).expect(200)).body;
      expect(plan.source).toBe("default");
      expect(plan.plan.code).not.toBe("agencia");
      // Y la ruta de administración que sí lo cambia no se abre con la sesión del panel.
      await orgA.ownerAgent
        .put(`/api/v1/admin/organizations/${orgA.id}/plan`)
        .set(CSRF_HEADERS)
        .send({ planId: paid.id, reason: "intento desde el panel" })
        .expect(401);
    });
  });

  describe("Soporte (F4.5/F4.9): ningún acceso cruzado entre organizaciones", () => {
    it("A no ve, no lista ni responde una solicitud de B por ninguna combinación de ids", async () => {
      const ticketOfB = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/support-tickets`)
        .set(CSRF_HEADERS)
        .send({ subject: "Consulta privada de B", body: "Detalle privado de la organización B." })
        .expect(201);
      const ticketId = ticketOfB.body.id as string;

      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/support-tickets`).expect(403);
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/support-tickets/${ticketId}`).expect(403);
      await orgA.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/support-tickets/${ticketId}/messages`)
        .set(CSRF_HEADERS)
        .send({ body: "Respuesta que no debería llegar." })
        .expect(403);

      // Organización propia de A con la solicitud de B.
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/support-tickets/${ticketId}`).expect(404);
      await orgA.ownerAgent
        .post(`/api/v1/organizations/${orgA.id}/support-tickets/${ticketId}/messages`)
        .set(CSRF_HEADERS)
        .send({ body: "Respuesta que no debería llegar." })
        .expect(404);

      const listOfA = await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/support-tickets`).expect(200);
      expect(JSON.stringify(listOfA.body)).not.toContain(ticketId);
      expect(await prisma.supportMessage.count({ where: { ticketId } })).toBe(1);
    });
  });

  describe("Medios (PP1-PP2/F4.9): ningún acceso cruzado entre organizaciones", () => {
    it("A no ve, no confirma ni borra un archivo de B por ninguna combinación de ids", async () => {
      // Directo en la base: esta prueba mide el aislamiento, no el proveedor de almacenamiento.
      const assetOfB = await prisma.mediaAsset.create({
        data: { organizationId: orgB.id, kind: "IMAGE", fileName: "privada-de-b.jpg", mimeType: "image/jpeg", sizeBytes: 1024 },
      });

      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/media`).expect(403);
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/media/${assetOfB.id}`).expect(403);

      const ownOrgPath = `/api/v1/organizations/${orgA.id}/media/${assetOfB.id}`;
      await orgA.ownerAgent.get(ownOrgPath).expect(404);
      await orgA.ownerAgent.post(`${ownOrgPath}/confirm`).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent.delete(ownOrgPath).set(CSRF_HEADERS).expect(404);

      const listOfA = await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/media`).expect(200);
      expect(JSON.stringify(listOfA.body)).not.toContain(assetOfB.id);
      expect(await prisma.mediaAsset.findUnique({ where: { id: assetOfB.id } })).not.toBeNull();
    });
  });

  describe("Dominios propios (F4.7/F4.9): ningún acceso cruzado entre organizaciones", () => {
    it("A no ve, no verifica ni quita un dominio de B por ninguna combinación de ids", async () => {
      const domainOfB = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/domains`)
        .set(CSRF_HEADERS)
        .send({ domain: `${uniqueSlug()}.isolation-e2e.cl` })
        .expect(201);
      const domainId = domainOfB.body.id as string;

      // Con la organización de B en la URL: frenado por el guard de membresía.
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/domains`).expect(403);
      await orgA.ownerAgent.post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/domains/${domainId}/verify`).set(CSRF_HEADERS).expect(403);
      await orgA.ownerAgent.delete(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/domains/${domainId}`).set(CSRF_HEADERS).expect(403);

      // Organización propia de A con el sitio de B: 404.
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/domains`).expect(404);
      await orgA.ownerAgent
        .post(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/domains`)
        .set(CSRF_HEADERS)
        .send({ domain: `${uniqueSlug()}.isolation-e2e.cl` })
        .expect(404);

      // Organización y sitio propios de A con el dominio de B: 404.
      const ownPath = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/domains/${domainId}`;
      await orgA.ownerAgent.post(`${ownPath}/verify`).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent.delete(ownPath).set(CSRF_HEADERS).expect(404);

      const listOfA = await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/domains`).expect(200);
      expect(JSON.stringify(listOfA.body)).not.toContain(domainId);
      const stillB = await prisma.siteDomain.findUniqueOrThrow({ where: { id: domainId } });
      expect(stillB.verificationStatus).toBe("PENDING");
      expect(stillB.lastCheckedAt).toBeNull();
    });
  });

  describe("Configuración de reservas (F5.1/F5.7): ningún acceso cruzado entre organizaciones", () => {
    it("A no lee ni cambia la configuración, los servicios ni los bloqueos de B por ninguna combinación de ids", async () => {
      const baseB = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/booking`;
      const serviceOfB = await orgB.ownerAgent.post(`${baseB}/services`).set(CSRF_HEADERS).send({ name: "Servicio de B", durationMinutes: 30 }).expect(201);
      const blackoutOfB = await orgB.ownerAgent
        .post(`${baseB}/blackouts`)
        .set(CSRF_HEADERS)
        .send({ startsAt: "2030-01-01T10:00:00Z", endsAt: "2030-01-01T12:00:00Z" })
        .expect(201);
      const serviceId = serviceOfB.body.id as string;
      const blackoutId = blackoutOfB.body.id as string;

      // Con la organización de B en la URL: 403.
      await orgA.ownerAgent.get(`${baseB}/settings`).expect(403);
      await orgA.ownerAgent.get(`${baseB}/services`).expect(403);
      await orgA.ownerAgent.patch(`${baseB}/services/${serviceId}`).set(CSRF_HEADERS).send({ name: "Tomado" }).expect(403);

      // Organización propia de A con el sitio de B: 404.
      const aWithSiteB = `/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/booking`;
      await orgA.ownerAgent.get(`${aWithSiteB}/settings`).expect(404);
      await orgA.ownerAgent.put(`${aWithSiteB}/settings`).set(CSRF_HEADERS).send({
        enabled: true,
        timeZone: "America/Santiago",
        weeklyHours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
        minNoticeMinutes: 0,
        maxAdvanceDays: 30,
        bufferMinutes: 0,
        slotIntervalMinutes: 30,
      }).expect(404);
      await orgA.ownerAgent.get(`${aWithSiteB}/services`).expect(404);

      // Organización y sitio propios de A con los ids de B: 404.
      const baseA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/booking`;
      await orgA.ownerAgent.patch(`${baseA}/services/${serviceId}`).set(CSRF_HEADERS).send({ name: "Tomado" }).expect(404);
      await orgA.ownerAgent.delete(`${baseA}/services/${serviceId}`).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent.get(`${baseA}/availability?serviceId=${serviceId}&from=2030-01-01&days=1`).expect(404);
      await orgA.ownerAgent.delete(`${baseA}/blackouts/${blackoutId}`).set(CSRF_HEADERS).expect(404);

      expect((await prisma.bookableService.findUniqueOrThrow({ where: { id: serviceId } })).name).toBe("Servicio de B");
      expect(await prisma.bookingBlackout.count({ where: { id: blackoutId } })).toBe(1);
      expect(await prisma.bookingSettings.count({ where: { siteId: orgB.siteId } })).toBe(0);
    });

    it("F7.9a: A no lee, crea ni modifica sucursales ni profesionales de B; asignar staff ajeno se rechaza", async () => {
      const baseA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/booking`;
      const baseB = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/booking`;

      const branchB = (await orgB.ownerAgent.post(`${baseB}/branches`).set(CSRF_HEADERS).send({ name: "Sucursal Norte de B" }).expect(201)).body;
      const staffB = (await orgB.ownerAgent.post(`${baseB}/staff`).set(CSRF_HEADERS).send({ name: "Dra. Especialista de B" }).expect(201)).body;
      const serviceA = (await orgA.ownerAgent.post(`${baseA}/services`).set(CSRF_HEADERS).send({ name: "Servicio de A", durationMinutes: 30 }).expect(201)).body;

      // A no puede leer sucursales ni staff de B con URL de B (403)
      await orgA.ownerAgent.get(`${baseB}/branches`).expect(403);
      await orgA.ownerAgent.get(`${baseB}/staff`).expect(403);

      // A no puede modificar sucursal ni staff de B con su propia base (404)
      await orgA.ownerAgent.patch(`${baseA}/branches/${branchB.id}`).set(CSRF_HEADERS).send({ name: "Hackeado" }).expect(404);
      await orgA.ownerAgent.delete(`${baseA}/branches/${branchB.id}`).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent.patch(`${baseA}/staff/${staffB.id}`).set(CSRF_HEADERS).send({ name: "Hackeado" }).expect(404);
      await orgA.ownerAgent.delete(`${baseA}/staff/${staffB.id}`).set(CSRF_HEADERS).expect(404);

      // Asignar staff de B a un servicio de A es rechazado con 404
      await orgA.ownerAgent.put(`${baseA}/services/${serviceA.id}/staff`).set(CSRF_HEADERS).send({ staffIds: [staffB.id] }).expect(404);

      // Crear blackout en A con staffId de B es rechazado con 404
      await orgA.ownerAgent
        .post(`${baseA}/blackouts`)
        .set(CSRF_HEADERS)
        .send({ startsAt: "2030-01-01T10:00:00Z", endsAt: "2030-01-01T12:00:00Z", staffId: staffB.id })
        .expect(404);
    });

    it("F7.9c: A no rota ni lee feeds de calendario ni administra conexiones de Google Calendar de B", async () => {
      const baseA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/booking`;
      const baseB = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/booking`;

      const staffB = (await orgB.ownerAgent.post(`${baseB}/staff`).set(CSRF_HEADERS).send({ name: "Dr. Feed de B" }).expect(201)).body;

      // A no puede rotar feed de sitio de B con URL de B (403) ni con su propia URL (404)
      await orgA.ownerAgent.post(`${baseB}/settings/rotate-calendar-feed`).set(CSRF_HEADERS).expect(403);
      await orgA.ownerAgent.post(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/booking/settings/rotate-calendar-feed`).set(CSRF_HEADERS).expect(404);

      // A no puede rotar feed del profesional de B (403 o 404)
      await orgA.ownerAgent.post(`${baseB}/staff/${staffB.id}/rotate-calendar-feed`).set(CSRF_HEADERS).expect(403);
      await orgA.ownerAgent.post(`${baseA}/staff/${staffB.id}/rotate-calendar-feed`).set(CSRF_HEADERS).expect(404);

      // A no puede leer estado de Google Calendar de B (403 o 404)
      await orgA.ownerAgent.get(`${baseB}/google-calendar`).expect(403);
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/booking/google-calendar`).expect(404);

      // A no puede desconectar Google Calendar de B
      await orgA.ownerAgent.delete(`${baseB}/google-calendar`).set(CSRF_HEADERS).expect(403);
      await orgA.ownerAgent.delete(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/booking/google-calendar`).set(CSRF_HEADERS).expect(404);
    });
  });

  describe("Reserva pública (F5.2/F5.7): no cruza sitios ni organizaciones", () => {
    it("un servicio de B no se ofrece ni se reserva a través del sitio de A", async () => {
      const settings = {
        enabled: true,
        timeZone: "America/Santiago",
        weeklyHours: { mon: [{ start: "09:00", end: "18:00" }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
        minNoticeMinutes: 0,
        maxAdvanceDays: 365,
        bufferMinutes: 0,
        slotIntervalMinutes: 30,
      };
      const baseA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/booking`;
      const baseB = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/booking`;
      await orgA.ownerAgent.put(`${baseA}/settings`).set(CSRF_HEADERS).send(settings).expect(200);
      await orgB.ownerAgent.put(`${baseB}/settings`).set(CSRF_HEADERS).send(settings).expect(200);
      const serviceOfB = await orgB.ownerAgent.post(`${baseB}/services`).set(CSRF_HEADERS).send({ name: "Servicio privado de B", durationMinutes: 30 }).expect(201);
      const siteA = await prisma.site.findUniqueOrThrow({ where: { id: orgA.siteId } });
      const publicA = `/api/v1/public/sites/${siteA.slug}/booking`;

      const infoA = await request(httpServer).get(publicA).expect(200);
      expect(JSON.stringify(infoA.body)).not.toContain(serviceOfB.body.id);
      await request(httpServer).get(`${publicA}/availability?serviceId=${serviceOfB.body.id}&from=2030-01-07&days=1`).expect(404);
      await request(httpServer)
        .post(publicA)
        .set(CSRF_HEADERS)
        .send({ serviceId: serviceOfB.body.id, startsAt: "2030-01-07T13:00:00Z", name: "Intruso", email: `x${TEST_EMAIL_DOMAIN}`, consent: true })
        .expect(404);
      expect(await prisma.booking.count({ where: { serviceId: serviceOfB.body.id } })).toBe(0);
    });
  });

  describe("Agenda (F5.3/F5.7): ningún acceso cruzado entre organizaciones", () => {
    it("A no ve, no anota ni cambia reservas de B por ninguna combinación de ids", async () => {
      const baseB = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/booking`;
      const serviceOfB = await orgB.ownerAgent.post(`${baseB}/services`).set(CSRF_HEADERS).send({ name: "Agenda de B", durationMinutes: 30 }).expect(201);
      const bookingOfB = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/bookings`)
        .set(CSRF_HEADERS)
        .send({ siteId: orgB.siteId, serviceId: serviceOfB.body.id, startsAt: "2031-03-03T13:00:00Z", name: "Cliente de B", email: `cliente-b${TEST_EMAIL_DOMAIN}` })
        .expect(201);
      const bookingId = bookingOfB.body.id as string;
      const range = "from=2031-03-01T00:00:00Z&to=2031-03-10T00:00:00Z";

      // Con la organización de B en la URL: 403.
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/bookings?${range}`).expect(403);
      await orgA.ownerAgent.patch(`/api/v1/organizations/${orgB.id}/bookings/${bookingId}`).set(CSRF_HEADERS).send({ status: "CANCELLED" }).expect(403);

      // Organización propia de A con ids de B: 404, y el listado de A no la incluye.
      const agendaA = `/api/v1/organizations/${orgA.id}/bookings`;
      await orgA.ownerAgent.get(`${agendaA}/${bookingId}`).expect(404);
      await orgA.ownerAgent.patch(`${agendaA}/${bookingId}`).set(CSRF_HEADERS).send({ status: "CANCELLED" }).expect(404);
      await orgA.ownerAgent.get(`${agendaA}?${range}&siteId=${orgB.siteId}`).expect(404);
      await orgA.ownerAgent
        .post(agendaA)
        .set(CSRF_HEADERS)
        .send({ siteId: orgB.siteId, serviceId: serviceOfB.body.id, startsAt: "2031-03-04T13:00:00Z", name: "Intruso", email: `intruso${TEST_EMAIL_DOMAIN}` })
        .expect(404);
      const listOfA = await orgA.ownerAgent.get(`${agendaA}?${range}`).expect(200);
      expect(JSON.stringify(listOfA.body)).not.toContain(bookingId);
      expect(JSON.stringify(listOfA.body)).not.toContain("Cliente de B");

      expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("CONFIRMED");
    });
  });

  describe("Catálogo y pedidos (F5.5): ningún acceso cruzado entre organizaciones", () => {
    it("A no lee ni cambia el catálogo ni los pedidos de B, y un producto de B no se pide por el sitio de A", async () => {
      const catalogB = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/catalog`;
      const categoryOfB = await orgB.ownerAgent.post(`${catalogB}/categories`).set(CSRF_HEADERS).send({ name: "Categoría de B" }).expect(201);
      const productOfB = await orgB.ownerAgent
        .post(`${catalogB}/products`)
        .set(CSRF_HEADERS)
        .send({ name: "Producto de B", kind: "DIGITAL", priceAmount: 5000, priceCurrency: "CLP", stock: 5, categoryId: categoryOfB.body.id })
        .expect(201);
      const productId = productOfB.body.id as string;
      const categoryId = categoryOfB.body.id as string;
      const siteB = await prisma.site.findUniqueOrThrow({ where: { id: orgB.siteId } });
      await request(httpServer)
        .post(`/api/v1/public/sites/${siteB.slug}/catalog/orders`)
        .set(CSRF_HEADERS)
        .send({ productId, quantity: 1, name: "Cliente de B", email: `cliente-pedido-b${TEST_EMAIL_DOMAIN}`, consent: true })
        .expect(201);
      const orderOfB = await prisma.order.findFirstOrThrow({ where: { productId } });

      // Con la organización de B en la URL: 403.
      await orgA.ownerAgent.get(`${catalogB}/products`).expect(403);
      await orgA.ownerAgent.patch(`${catalogB}/products/${productId}`).set(CSRF_HEADERS).send({ name: "Tomado" }).expect(403);
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/orders`).expect(403);
      await orgA.ownerAgent.patch(`/api/v1/organizations/${orgB.id}/orders/${orderOfB.id}`).set(CSRF_HEADERS).send({ status: "PAID" }).expect(403);

      // Organización propia de A con el sitio de B: 404.
      const aWithSiteB = `/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/catalog`;
      await orgA.ownerAgent.get(`${aWithSiteB}/products`).expect(404);
      await orgA.ownerAgent.get(`${aWithSiteB}/categories`).expect(404);
      await orgA.ownerAgent.post(`${aWithSiteB}/products`).set(CSRF_HEADERS).send({ name: "Intruso", priceAmount: 1, priceCurrency: "CLP" }).expect(404);

      // Organización y sitio propios de A con los ids de B: 404.
      const catalogA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/catalog`;
      await orgA.ownerAgent.patch(`${catalogA}/products/${productId}`).set(CSRF_HEADERS).send({ name: "Tomado" }).expect(404);
      await orgA.ownerAgent.delete(`${catalogA}/products/${productId}`).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent.patch(`${catalogA}/categories/${categoryId}`).set(CSRF_HEADERS).send({ name: "Tomada" }).expect(404);
      await orgA.ownerAgent.delete(`${catalogA}/categories/${categoryId}`).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent.post(`${catalogA}/products`).set(CSRF_HEADERS).send({ name: "Con categoría ajena", priceAmount: 1, priceCurrency: "CLP", categoryId }).expect(404);
      const ordersA = `/api/v1/organizations/${orgA.id}/orders`;
      await orgA.ownerAgent.get(`${ordersA}/${orderOfB.id}`).expect(404);
      await orgA.ownerAgent.patch(`${ordersA}/${orderOfB.id}`).set(CSRF_HEADERS).send({ status: "CANCELLED" }).expect(404);
      await orgA.ownerAgent.get(`${ordersA}?siteId=${orgB.siteId}`).expect(404);
      const listOfA = await orgA.ownerAgent.get(ordersA).expect(200);
      expect(JSON.stringify(listOfA.body)).not.toContain(orderOfB.id);
      expect(JSON.stringify(listOfA.body)).not.toContain("Cliente de B");

      // El sitio público de A no ofrece ni acepta pedidos del producto de B.
      const siteA = await prisma.site.findUniqueOrThrow({ where: { id: orgA.siteId } });
      const publicA = `/api/v1/public/sites/${siteA.slug}/catalog`;
      const catalogOfA = await request(httpServer).get(publicA).expect(200);
      expect(JSON.stringify(catalogOfA.body)).not.toContain(productId);
      await request(httpServer)
        .post(`${publicA}/orders`)
        .set(CSRF_HEADERS)
        .send({ productId, quantity: 1, name: "Intruso", email: `intruso-pedido${TEST_EMAIL_DOMAIN}`, consent: true })
        .expect(404);

      const stillB = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
      expect(stillB.name).toBe("Producto de B");
      expect(stillB.stock).toBe(4);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderOfB.id } })).status).toBe("NEW");
      expect(await prisma.order.count({ where: { productId } })).toBe(1);
    });
  });

  describe("Variantes y líneas de pedido (F7.8a, ADR-023): nunca se cruzan", () => {
    it("A no crea, edita ni borra variantes de B, ni pide una variante de B por su sitio; las líneas de B no aparecen en A", async () => {
      const catalogB = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/catalog`;
      const productOfB = await orgB.ownerAgent.post(`${catalogB}/products`).set(CSRF_HEADERS).send({ name: "Polera de B", priceAmount: 9990, priceCurrency: "CLP" }).expect(201);
      const productId = productOfB.body.id as string;
      const withVariant = await orgB.ownerAgent.post(`${catalogB}/products/${productId}/variants`).set(CSRF_HEADERS).send({ name: "Talla de B", stock: 3 }).expect(201);
      const variantId = withVariant.body.variants[0].id as string;
      const siteB = await prisma.site.findUniqueOrThrow({ where: { id: orgB.siteId } });
      await request(httpServer)
        .post(`/api/v1/public/sites/${siteB.slug}/catalog/orders`)
        .set(CSRF_HEADERS)
        .send({ productId, variantId, quantity: 1, name: "Cliente de B", email: `cliente-variante-b${TEST_EMAIL_DOMAIN}`, address: "Calle B 1", consent: true })
        .expect(201);

      // Con la organización de B en la URL: 403.
      await orgA.ownerAgent.post(`${catalogB}/products/${productId}/variants`).set(CSRF_HEADERS).send({ name: "Intrusa" }).expect(403);
      await orgA.ownerAgent.patch(`${catalogB}/products/${productId}/variants/${variantId}`).set(CSRF_HEADERS).send({ stock: 999 }).expect(403);
      await orgA.ownerAgent.delete(`${catalogB}/products/${productId}/variants/${variantId}`).set(CSRF_HEADERS).expect(403);

      // Organización y sitio propios de A con los ids de B: 404.
      const catalogA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/catalog`;
      await orgA.ownerAgent.post(`${catalogA}/products/${productId}/variants`).set(CSRF_HEADERS).send({ name: "Intrusa" }).expect(404);
      await orgA.ownerAgent.patch(`${catalogA}/products/${productId}/variants/${variantId}`).set(CSRF_HEADERS).send({ stock: 999 }).expect(404);
      await orgA.ownerAgent.delete(`${catalogA}/products/${productId}/variants/${variantId}`).set(CSRF_HEADERS).expect(404);
      // Un producto propio de A con la variante de B: 404.
      const productOfA = await orgA.ownerAgent.post(`${catalogA}/products`).set(CSRF_HEADERS).send({ name: "Polera de A", priceAmount: 1, priceCurrency: "CLP" }).expect(201);
      await orgA.ownerAgent.patch(`${catalogA}/products/${productOfA.body.id}/variants/${variantId}`).set(CSRF_HEADERS).send({ stock: 999 }).expect(404);

      // El sitio público de A no acepta la variante de B, ni con un producto propio de A.
      const siteA = await prisma.site.findUniqueOrThrow({ where: { id: orgA.siteId } });
      const publicA = `/api/v1/public/sites/${siteA.slug}/catalog/orders`;
      const intruder = { quantity: 1, name: "Intruso", email: `intruso-variante${TEST_EMAIL_DOMAIN}`, address: "Calle A 1", consent: true };
      await request(httpServer).post(publicA).set(CSRF_HEADERS).send({ ...intruder, productId, variantId }).expect(404);
      await request(httpServer).post(publicA).set(CSRF_HEADERS).send({ ...intruder, productId: productOfA.body.id, variantId }).expect(404);

      // Las líneas de B no aparecen en los pedidos de A, y nada de B cambió.
      const listOfA = await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/orders`).expect(200);
      expect(JSON.stringify(listOfA.body)).not.toContain(variantId);
      expect(JSON.stringify(listOfA.body)).not.toContain("Talla de B");
      const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
      expect(variant).toMatchObject({ name: "Talla de B", stock: 2, organizationId: orgB.id });
      expect(await prisma.orderItem.count({ where: { variantId } })).toBe(1);
      expect(await prisma.orderItem.count({ where: { variantId, organizationId: orgA.id } })).toBe(0);
    });
  });

  describe("Carrito (F7.8c, ADR-023): un carrito nunca mezcla organizaciones", () => {
    it("un producto de B no entra en un carrito del sitio de A, ni junto a uno propio; nada de B cambia", async () => {
      const catalogB = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/catalog`;
      const productOfB = await orgB.ownerAgent.post(`${catalogB}/products`).set(CSRF_HEADERS).send({ name: "Taza de B", kind: "SERVICE", priceAmount: 5_000, priceCurrency: "CLP", stock: 4 }).expect(201);
      const catalogA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/catalog`;
      const productOfA = await orgA.ownerAgent.post(`${catalogA}/products`).set(CSRF_HEADERS).send({ name: "Taza de A", kind: "SERVICE", priceAmount: 5_000, priceCurrency: "CLP" }).expect(201);
      const siteA = await prisma.site.findUniqueOrThrow({ where: { id: orgA.siteId } });
      const cartA = `/api/v1/public/sites/${siteA.slug}/catalog/cart`;
      const buyer = { name: "Intruso", email: `intruso-carrito${TEST_EMAIL_DOMAIN}`, consent: true };

      await request(httpServer).post(`${cartA}/orders`).set(CSRF_HEADERS).send({ ...buyer, lines: [{ productId: productOfB.body.id, quantity: 1 }] }).expect(404);
      await request(httpServer)
        .post(`${cartA}/orders`)
        .set(CSRF_HEADERS)
        .send({ ...buyer, lines: [{ productId: productOfA.body.id, quantity: 1 }, { productId: productOfB.body.id, quantity: 1 }] })
        .expect(404);
      await request(httpServer).post(`${cartA}/coupons/check`).set(CSRF_HEADERS).send({ code: "X", lines: [{ productId: productOfB.body.id, quantity: 1 }] }).expect(404);

      expect((await prisma.product.findUniqueOrThrow({ where: { id: productOfB.body.id } })).stock).toBe(4);
      expect(await prisma.orderItem.count({ where: { productId: productOfB.body.id } })).toBe(0);
      expect(await prisma.order.count({ where: { customerEmail: `intruso-carrito${TEST_EMAIL_DOMAIN}` } })).toBe(0);
    });
  });

  describe("Cupones (F7.8b, ADR-023): nunca se cruzan", () => {
    it("A no lee, crea, edita ni borra cupones de B, y el código de B no vale en el sitio de A", async () => {
      const couponsB = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/coupons`;
      const couponOfB = await orgB.ownerAgent.post(couponsB).set(CSRF_HEADERS).send({ code: "SOLOB", kind: "percent", percentOff: 30 }).expect(201);
      const couponId = couponOfB.body.id as string;

      // Con la organización de B en la URL: 403.
      await orgA.ownerAgent.get(couponsB).expect(403);
      await orgA.ownerAgent.post(couponsB).set(CSRF_HEADERS).send({ code: "INTRUSO", kind: "percent", percentOff: 5 }).expect(403);
      await orgA.ownerAgent.patch(`${couponsB}/${couponId}`).set(CSRF_HEADERS).send({ percentOff: 100 }).expect(403);
      await orgA.ownerAgent.delete(`${couponsB}/${couponId}`).set(CSRF_HEADERS).expect(403);

      // Organización propia de A con el sitio de B: 404; y sitio propio de A con el cupón de B: 404.
      const aWithSiteB = `/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/coupons`;
      await orgA.ownerAgent.get(aWithSiteB).expect(404);
      await orgA.ownerAgent.post(aWithSiteB).set(CSRF_HEADERS).send({ code: "INTRUSO", kind: "percent", percentOff: 5 }).expect(404);
      const couponsA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/coupons`;
      await orgA.ownerAgent.patch(`${couponsA}/${couponId}`).set(CSRF_HEADERS).send({ percentOff: 100 }).expect(404);
      await orgA.ownerAgent.delete(`${couponsA}/${couponId}`).set(CSRF_HEADERS).expect(404);
      expect(JSON.stringify((await orgA.ownerAgent.get(couponsA).expect(200)).body)).not.toContain("SOLOB");

      // El código de B no vale en el sitio público de A (ni al probarlo ni al pedir).
      const catalogA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/catalog`;
      const productOfA = await orgA.ownerAgent.post(`${catalogA}/products`).set(CSRF_HEADERS).send({ name: "Producto de A", kind: "SERVICE", priceAmount: 10_000, priceCurrency: "CLP" }).expect(201);
      const siteA = await prisma.site.findUniqueOrThrow({ where: { id: orgA.siteId } });
      const publicA = `/api/v1/public/sites/${siteA.slug}/catalog`;
      await request(httpServer).post(`${publicA}/coupons/check`).set(CSRF_HEADERS).send({ code: "SOLOB", productId: productOfA.body.id, quantity: 1 }).expect(422);
      await request(httpServer)
        .post(`${publicA}/orders`)
        .set(CSRF_HEADERS)
        .send({ productId: productOfA.body.id, quantity: 1, couponCode: "SOLOB", name: "Intruso", email: `intruso-cupon${TEST_EMAIL_DOMAIN}`, consent: true })
        .expect(422);

      const stillB = await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } });
      expect(stillB).toMatchObject({ percentOff: 30, redemptionCount: 0, organizationId: orgB.id, active: true });
      expect(await prisma.order.count({ where: { couponCode: "SOLOB", organizationId: orgA.id } })).toBe(0);
    });
  });

  describe("Campañas (F5.6): ningún acceso cruzado entre organizaciones", () => {
    it("A no ve, edita, prueba, envía ni detiene campañas de B, y su audiencia no cuenta contactos de B", async () => {
      await prisma.contact.create({ data: { organizationId: orgB.id, email: `marketing-b${TEST_EMAIL_DOMAIN}`, marketingConsentAt: new Date() } });
      const baseB = `/api/v1/organizations/${orgB.id}/campaigns`;
      const campaignOfB = await orgB.ownerAgent.post(baseB).set(CSRF_HEADERS).send({ name: "Campaña de B", subject: "Hola", bodyHtml: "<p>B</p>" }).expect(201);
      const campaignId = campaignOfB.body.id as string;

      // Con la organización de B en la URL: 403.
      await orgA.ownerAgent.get(baseB).expect(403);
      await orgA.ownerAgent.post(`${baseB}/audience`).set(CSRF_HEADERS).send({}).expect(403);
      await orgA.ownerAgent.post(`${baseB}/${campaignId}/send`).set(CSRF_HEADERS).expect(403);

      // Organización propia de A con el id de B: 404.
      const baseA = `/api/v1/organizations/${orgA.id}/campaigns`;
      await orgA.ownerAgent.get(`${baseA}/${campaignId}`).expect(404);
      await orgA.ownerAgent.patch(`${baseA}/${campaignId}`).set(CSRF_HEADERS).send({ subject: "Tomada" }).expect(404);
      await orgA.ownerAgent.delete(`${baseA}/${campaignId}`).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent.post(`${baseA}/${campaignId}/test`).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent.post(`${baseA}/${campaignId}/send`).set(CSRF_HEADERS).expect(404);
      await orgA.ownerAgent.post(`${baseA}/${campaignId}/cancel`).set(CSRF_HEADERS).expect(404);
      const listOfA = await orgA.ownerAgent.get(baseA).expect(200);
      expect(JSON.stringify(listOfA.body)).not.toContain(campaignId);
      const options = await orgA.ownerAgent.get(`${baseA}/segment-options`).expect(200);
      expect(JSON.stringify(options.body)).not.toContain("marketing-b");
      const audienceOfA = await orgA.ownerAgent.post(`${baseA}/audience`).set(CSRF_HEADERS).send({}).expect(200);
      const ownEligible = await prisma.contact.count({ where: { organizationId: orgA.id, email: { not: null }, marketingConsentAt: { not: null }, marketingUnsubscribedAt: null } });
      expect(audienceOfA.body.eligible).toBe(ownEligible);

      const stillB = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
      expect(stillB).toMatchObject({ status: "DRAFT", subject: "Hola" });
    });
  });

  describe("Superficie pública de Fase 5 (F5.7): enlaces firmados, respuestas y límites", () => {
    const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const everyDay = [{ start: "09:00", end: "18:00" }];
    const openSettings = {
      enabled: true,
      timeZone: "America/Santiago",
      weeklyHours: { mon: everyDay, tue: everyDay, wed: everyDay, thu: everyDay, fri: everyDay, sat: everyDay, sun: everyDay },
      minNoticeMinutes: 0,
      maxAdvanceDays: 365,
      bufferMinutes: 0,
      slotIntervalMinutes: 30,
    };

    /** Una hora libre dentro del horario de ambos sitios: 15:00 UTC (11:00 o 12:00 en Santiago), `daysAhead` días adelante. */
    function slotInDays(daysAhead: number): string {
      const day = new Date(Date.now() + daysAhead * 86_400_000);
      day.setUTCHours(15, 0, 0, 0);
      return day.toISOString();
    }

    /** Una reserva pública real en el sitio de la organización: devuelve la respuesta y la fila creada. */
    async function publicBookingIn(org: { id: string; siteId: string; ownerAgent: ReturnType<typeof request.agent> }, startsAt: string, email: string) {
      const base = `/api/v1/organizations/${org.id}/sites/${org.siteId}/booking`;
      await org.ownerAgent.put(`${base}/settings`).set(CSRF_HEADERS).send(openSettings).expect(200);
      const service = await org.ownerAgent.post(`${base}/services`).set(CSRF_HEADERS).send({ name: `Servicio F5.7 ${email}`, durationMinutes: 30 }).expect(201);
      const site = await prisma.site.findUniqueOrThrow({ where: { id: org.siteId } });
      const response = await request(httpServer)
        .post(`/api/v1/public/sites/${site.slug}/booking`)
        .set(CSRF_HEADERS)
        .send({ serviceId: service.body.id, startsAt, name: "Cliente F5.7", email, consent: true })
        .expect(201);
      const booking = await prisma.booking.findFirstOrThrow({ where: { serviceId: service.body.id } });
      return { response, booking };
    }

    it("el enlace de gestión de una reserva de B solo alcanza esa reserva; uno alterado o de otro propósito da 404", async () => {
      const secret = env.BOOKING_LINK_SECRET;
      expect(secret, "BOOKING_LINK_SECRET debe estar configurado para probar los enlaces firmados").toBeDefined();
      const ofA = await publicBookingIn(orgA, slotInDays(20), `gestion-a${TEST_EMAIL_DOMAIN}`);
      const ofB = await publicBookingIn(orgB, slotInDays(21), `gestion-b${TEST_EMAIL_DOMAIN}`);

      // La confirmación pública trae exactamente lo del contrato y ningún id.
      for (const { response } of [ofA, ofB]) {
        expect(Object.keys(response.body).sort()).toEqual(Object.keys(publicBookingConfirmationResponse.shape).sort());
        expect(JSON.stringify(response.body)).not.toMatch(UUID_PATTERN);
      }

      const tokenB = signBookingLinkToken(ofB.booking.id, secret!);
      const view = publicManagedBookingResponse.strict().parse((await request(httpServer).get(`/api/v1/public/bookings/${tokenB}`).expect(200)).body);
      const viewText = JSON.stringify(view);
      expect(ofB.booking.contactId).not.toBeNull();
      for (const internal of [ofB.booking.id, orgB.id, orgB.siteId, ofB.booking.contactId!, orgA.id, orgA.siteId, ofA.booking.id]) {
        expect(viewText).not.toContain(internal);
      }

      // La firma de B pegada al id de la reserva de A: 404 al ver, cancelar y reprogramar.
      const forged = `${ofA.booking.id}.${tokenB.slice(tokenB.indexOf(".") + 1)}`;
      await request(httpServer).get(`/api/v1/public/bookings/${forged}`).expect(404);
      await request(httpServer).post(`/api/v1/public/bookings/${forged}/cancel`).set(CSRF_HEADERS).expect(404);
      await request(httpServer).post(`/api/v1/public/bookings/${forged}/reschedule`).set(CSRF_HEADERS).send({ startsAt: slotInDays(22) }).expect(404);

      // Una firma válida de baja (otro propósito, mismo secreto) no sirve para gestionar una reserva.
      const wrongPurpose = signUnsubscribeToken(ofA.booking.id, secret!);
      await request(httpServer).get(`/api/v1/public/bookings/${wrongPurpose}`).expect(404);
      await request(httpServer).post(`/api/v1/public/bookings/${wrongPurpose}/cancel`).set(CSRF_HEADERS).expect(404);

      // Con su propio enlace, B cancela la suya y la de A no se entera.
      await request(httpServer).post(`/api/v1/public/bookings/${tokenB}/cancel`).set(CSRF_HEADERS).expect(200);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: ofB.booking.id } })).status).toBe("CANCELLED");
      const stillA = await prisma.booking.findUniqueOrThrow({ where: { id: ofA.booking.id } });
      expect(stillA.status).toBe("CONFIRMED");
      expect(stillA.startsAt.toISOString()).toBe(ofA.booking.startsAt.toISOString());
    });

    it("la baja de una campaña de B no da de baja al mismo correo en A, y un enlace de reserva no sirve como baja", async () => {
      const secret = env.BOOKING_LINK_SECRET!;
      const sharedEmail = `mismo-correo${TEST_EMAIL_DOMAIN}`;
      const contactA = await prisma.contact.create({ data: { organizationId: orgA.id, email: sharedEmail, marketingConsentAt: new Date() } });
      const contactB = await prisma.contact.create({ data: { organizationId: orgB.id, email: sharedEmail, marketingConsentAt: new Date() } });
      const campaignOfB = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/campaigns`)
        .set(CSRF_HEADERS)
        .send({ name: "Campaña con baja", subject: "Novedades", bodyHtml: "<p>Hola</p>" })
        .expect(201);
      const recipientB = await prisma.campaignRecipient.create({
        data: { campaignId: campaignOfB.body.id, organizationId: orgB.id, contactId: contactB.id, email: sharedEmail },
      });

      // Un enlace de gestión de reserva firmado sobre el id del destinatario no da de baja.
      const wrongPurpose = signBookingLinkToken(recipientB.id, secret);
      await request(httpServer).get(`/api/v1/public/unsubscribe/${wrongPurpose}`).expect(404);
      await request(httpServer).post(`/api/v1/public/unsubscribe/${wrongPurpose}`).set(CSRF_HEADERS).expect(404);
      expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactB.id } })).marketingUnsubscribedAt).toBeNull();

      const token = signUnsubscribeToken(recipientB.id, secret);
      const done = publicUnsubscribeResponse.strict().parse((await request(httpServer).post(`/api/v1/public/unsubscribe/${token}`).set(CSRF_HEADERS).expect(200)).body);
      expect(done).toMatchObject({ organizationName: "Org B", unsubscribed: true });
      expect(JSON.stringify(done)).not.toMatch(UUID_PATTERN);
      expect(JSON.stringify(done)).not.toContain(sharedEmail);

      expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactB.id } })).marketingUnsubscribedAt).not.toBeNull();
      expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactA.id } })).marketingUnsubscribedAt).toBeNull();
      const audienceOfA = await orgA.ownerAgent.post(`/api/v1/organizations/${orgA.id}/campaigns/audience`).set(CSRF_HEADERS).send({}).expect(200);
      const eligibleInA = await prisma.contact.count({ where: { organizationId: orgA.id, email: { not: null }, marketingConsentAt: { not: null }, marketingUnsubscribedAt: null } });
      expect(audienceOfA.body.eligible).toBe(eligibleInA);
      expect(eligibleInA).toBeGreaterThan(0);
    });

    it("la confirmación pública de un pedido trae solo lo del contrato, sin ids", async () => {
      const catalogA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/catalog`;
      const product = await orgA.ownerAgent
        .post(`${catalogA}/products`)
        .set(CSRF_HEADERS)
        .send({ name: "Producto F5.7", kind: "DIGITAL", priceAmount: 1500, priceCurrency: "CLP" })
        .expect(201);
      const siteA = await prisma.site.findUniqueOrThrow({ where: { id: orgA.siteId } });
      const confirmation = await request(httpServer)
        .post(`/api/v1/public/sites/${siteA.slug}/catalog/orders`)
        .set(CSRF_HEADERS)
        .send({ productId: product.body.id, quantity: 2, name: "Cliente F5.7", email: `pedido-f57${TEST_EMAIL_DOMAIN}`, consent: true })
        .expect(201);
      expect(Object.keys(confirmation.body).sort()).toEqual(Object.keys(publicOrderConfirmationResponse.shape).sort());
      expect(JSON.stringify(confirmation.body)).not.toMatch(UUID_PATTERN);
      expect(confirmation.body).toMatchObject({ quantity: 2, totalAmount: 3000, priceCurrency: "CLP" });
    });

    it("cada escritura pública de Fase 5 tiene límite de tasa por IP", async () => {
      const siteA = await prisma.site.findUniqueOrThrow({ where: { id: orgA.siteId } });
      // El limitador corre antes de validar: cuerpos vacíos (400) y enlaces falsos (404) también gastan cupo.
      const writes: Array<{ path: string; limit: number }> = [
        { path: `/api/v1/public/sites/${siteA.slug}/booking`, limit: 10 },
        { path: `/api/v1/public/sites/${siteA.slug}/catalog/orders`, limit: 10 },
        { path: "/api/v1/public/bookings/no-es-un-token/cancel", limit: 10 },
        { path: "/api/v1/public/bookings/no-es-un-token/reschedule", limit: 10 },
        { path: "/api/v1/public/unsubscribe/no-es-un-token", limit: 30 },
      ];
      for (const { path, limit } of writes) {
        for (let attempt = 0; attempt < limit; attempt += 1) {
          const response = await request(httpServer).post(path).set(CSRF_HEADERS).send({});
          expect(response.status, `${path} intento ${attempt + 1}`).not.toBe(429);
        }
        await request(httpServer).post(path).set(CSRF_HEADERS).send({}).expect(429);
      }
    });
  });

  describe("Administración (F4.4/F4.9): un usuario de organización nunca la alcanza", () => {
    it("ni el OWNER ni un ADMIN de una organización abren ninguna ruta de administración, en ningún método", async () => {
      // Todas las rutas `/admin/*` salen del OpenAPI publicado (el mismo que verifica openapi.test):
      // una ruta de administración nueva queda cubierta sin tocar esta prueba. Solo se excluye el
      // login, que por diseño no exige sesión.
      const document = JSON.parse(readFileSync(new URL("../../../docs/api/openapi.json", import.meta.url), "utf8")) as {
        paths: Record<string, Record<string, unknown>>;
      };
      const routes = Object.entries(document.paths)
        .filter(([path]) => path.startsWith("/api/v1/admin/") && path !== "/api/v1/admin/auth/login")
        .flatMap(([path, methods]) => Object.keys(methods).map((method) => ({ method, path: path.replace(/\{organizationId\}/g, orgB.id).replace(/\{[^}]+\}/g, "00000000-0000-4000-8000-000000000000") })));
      // Salvaguarda: si el documento no se leyó bien, la prueba no puede "pasar" sin probar nada.
      expect(routes.length).toBeGreaterThan(25);

      for (const agent of [orgA.ownerAgent, orgA.adminAgent]) {
        for (const { method, path } of routes) {
          const call = agent[method as "get" | "post" | "put" | "patch" | "delete"](path);
          const response = method === "get" ? await call : await call.set(CSRF_HEADERS).send({ reason: "intento de una organización" });
          expect(response.status, `${method.toUpperCase()} ${path}`).toBe(401);
        }
      }
    });

    it("las credenciales de un usuario de organización no abren una sesión de administración", async () => {
      await request(httpServer)
        .post("/api/v1/admin/auth/login")
        .set(CSRF_HEADERS)
        .send({ email: orgA.ownerEmail, password: "password1234", code: "123456" })
        .expect(401);
      expect(await prisma.session.count({ where: { user: { email: orgA.ownerEmail }, scope: "ADMIN" } })).toBe(0);
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

  describe("Salud de página (F6.1/F6.10): ningún acceso cruzado ni recursos de otra organización", () => {
    it("A no lee la salud de una página de B, y un formulario de B no cuenta como configurado en A", async () => {
      const homeOfB = (await orgB.ownerAgent.get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`).expect(200)).body[0].id;
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages/${homeOfB}/health`).expect(403);
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/pages/${homeOfB}/health`).expect(404);

      // Un bloque de A que apunta (por la base, sin pasar por la API) al formulario real de B: la
      // salud lo evalúa contra los formularios del sitio de A, así que sigue "sin configurar".
      const formOfB = await orgB.ownerAgent
        .post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/forms`)
        .set(CSRF_HEADERS)
        .send({ name: "Formulario de B", fields: [{ type: "TEXT", label: "Nombre" }] })
        .expect(201);
      const pagesPathA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/pages`;
      const homeOfA = (await orgA.ownerAgent.get(pagesPathA).expect(200)).body[0].id;
      const block = await prisma.block.create({
        data: {
          pageId: homeOfA,
          type: "contact_form",
          position: 999,
          configSchemaVersion: 2,
          versions: { create: { versionNumber: 1, config: { formId: formOfB.body.id } } },
        },
      });
      try {
        const health = await orgA.ownerAgent.get(`${pagesPathA}/${homeOfA}/health`).expect(200);
        expect(health.body.findings).toContainEqual(expect.objectContaining({ code: "form_not_configured", blockId: block.id }));
        expect(JSON.stringify(health.body)).not.toContain(formOfB.body.id);
      } finally {
        await prisma.block.delete({ where: { id: block.id } });
      }
    });
  });

  describe("Asistente de IA (F6.2/F6.10): cuota y estado por organización", () => {
    it("A no lee el estado de IA de B, y el uso de B nunca cuenta en la cuota de A", async () => {
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/ai/status`).expect(403);

      const ownerOfB = await prisma.user.findUniqueOrThrow({ where: { email: orgB.ownerEmail } });
      const before = (await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/ai/status`).expect(200)).body.quota.used;
      await prisma.aiUsage.create({
        data: { organizationId: orgB.id, userId: ownerOfB.id, requestId: randomUUID(), task: "short_copy", providerKind: "OPENAI_COMPATIBLE", model: "m", outcome: "ok" },
      });
      const afterA = (await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/ai/status`).expect(200)).body.quota.used;
      const afterB = (await orgB.ownerAgent.get(`/api/v1/organizations/${orgB.id}/ai/status`).expect(200)).body.quota.used;
      expect(afterA).toBe(before);
      expect(afterB).toBeGreaterThanOrEqual(1);
    });

    it("A no pide propuestas de IA sobre páginas ni bloques de B por ninguna combinación de ids (F6.3)", async () => {
      const pagesPathB = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`;
      const homeOfB = (await orgB.ownerAgent.get(pagesPathB).expect(200)).body[0].id;
      const blockOfB = await orgB.ownerAgent
        .post(`${pagesPathB}/${homeOfB}/blocks`)
        .set(CSRF_HEADERS)
        .send({ type: "booking", config: { label: "Reservar con B" } })
        .expect(201);
      const pagesPathA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/pages`;
      const homeOfA = (await orgA.ownerAgent.get(pagesPathA).expect(200)).body[0].id;

      // Todas se resuelven antes de llegar al modelo: el contenido de B nunca viaja en un pedido de A.
      for (const [task, body] of [
        ["block-copy", { blockId: blockOfB.body.id }],
        ["translate", { blockId: blockOfB.body.id, locale: "en" }],
      ] as const) {
        await orgA.ownerAgent.post(`${pagesPathB}/${homeOfB}/ai/${task}`).set(CSRF_HEADERS).send(body).expect(403);
        await orgA.ownerAgent.post(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/pages/${homeOfB}/ai/${task}`).set(CSRF_HEADERS).send(body).expect(404);
        await orgA.ownerAgent.post(`${pagesPathA}/${homeOfA}/ai/${task}`).set(CSRF_HEADERS).send(body).expect(404);
      }
      await orgA.ownerAgent.post(`${pagesPathB}/${homeOfB}/ai/seo`).set(CSRF_HEADERS).send({}).expect(403);
      await orgA.ownerAgent.post(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/pages/${homeOfB}/ai/seo`).set(CSRF_HEADERS).send({}).expect(404);
    });

    it("A no ve, empieza, termina ni aplica pruebas A/B de B por ninguna combinación de ids (F6.5)", async () => {
      const pagesPathB = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`;
      const homeOfB = (await orgB.ownerAgent.get(pagesPathB).expect(200)).body[0].id;
      const blockOfB = await orgB.ownerAgent
        .post(`${pagesPathB}/${homeOfB}/blocks`)
        .set(CSRF_HEADERS)
        .send({ type: "link", config: { label: "Enlace de B", url: "https://b.example.com" } })
        .expect(201);
      await orgB.ownerAgent.post(`${pagesPathB}/${homeOfB}/publish`).set(CSRF_HEADERS).expect(201);
      const testsOfB = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/ab-tests`;
      const testOfB = await orgB.ownerAgent.post(testsOfB).set(CSRF_HEADERS).send({ blockId: blockOfB.body.id, name: "Prueba de B", variantB: { label: "B de B" } }).expect(201);

      try {
        const testsA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/ab-tests`;
        const crossed = `/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/ab-tests`;
        await orgA.ownerAgent.get(testsOfB).expect(403);
        await orgA.ownerAgent.get(crossed).expect(404);
        await orgA.ownerAgent.get(`${testsA}/${testOfB.body.id}`).expect(404);
        await orgA.ownerAgent.post(`${testsA}/${testOfB.body.id}/stop`).set(CSRF_HEADERS).expect(404);
        await orgA.ownerAgent.post(`${testsA}/${testOfB.body.id}/apply`).set(CSRF_HEADERS).send({ variant: "b" }).expect(404);
        // El bloque de B no se puede probar desde el sitio de A.
        await orgA.ownerAgent.post(testsA).set(CSRF_HEADERS).send({ blockId: blockOfB.body.id, name: "Robada", variantB: { label: "X" } }).expect(404);
        expect((await orgA.ownerAgent.get(testsA).expect(200)).body).toEqual([]);
        const stillRunning = await prisma.abTest.findUniqueOrThrow({ where: { id: testOfB.body.id } });
        expect(stillRunning).toMatchObject({ status: "RUNNING", appliedVariant: null });
      } finally {
        await prisma.abTest.deleteMany({ where: { id: testOfB.body.id } });
        await prisma.block.deleteMany({ where: { id: blockOfB.body.id } });
      }
    });

    it("A no lee ni cambia el Smart CTA de B, ni apunta una regla suya a un bloque de B (F6.6)", async () => {
      const pagesPathB = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/pages`;
      const homeOfB = (await orgB.ownerAgent.get(pagesPathB).expect(200)).body[0].id;
      const blockOfB = await orgB.ownerAgent
        .post(`${pagesPathB}/${homeOfB}/blocks`)
        .set(CSRF_HEADERS)
        .send({ type: "whatsapp", config: { phone: "+56911112222" } })
        .expect(201);
      const ctaOfB = `${pagesPathB}/${homeOfB}/smart-cta`;
      const pagesPathA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/pages`;
      const homeOfA = (await orgA.ownerAgent.get(pagesPathA).expect(200)).body[0].id;
      const rule = { rules: [{ condition: { kind: "outside_hours" }, blockId: blockOfB.body.id }] };
      try {
        await orgA.ownerAgent.get(ctaOfB).expect(403);
        await orgA.ownerAgent.put(ctaOfB).set(CSRF_HEADERS).send(rule).expect(403);
        await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/pages/${homeOfB}/smart-cta`).expect(404);
        await orgA.ownerAgent.put(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/pages/${homeOfB}/smart-cta`).set(CSRF_HEADERS).send(rule).expect(404);
        // Desde su propia página, A no puede apuntar a un bloque de B.
        await orgA.ownerAgent.put(`${pagesPathA}/${homeOfA}/smart-cta`).set(CSRF_HEADERS).send(rule).expect(422);
        expect((await prisma.page.findUniqueOrThrow({ where: { id: homeOfB } })).smartCta).toBeNull();
      } finally {
        await prisma.block.deleteMany({ where: { id: blockOfB.body.id } });
      }
    });

    it("A no ve, edita, borra ni lee el registro de las automatizaciones de B (F6.7)", async () => {
      const ofB = `/api/v1/organizations/${orgB.id}/automations`;
      const automation = (await orgB.ownerAgent.post(ofB).set(CSRF_HEADERS).send({ name: "Aviso de B", trigger: "contact_created", action: { type: "notify_team" } }).expect(201)).body;
      const ofA = `/api/v1/organizations/${orgA.id}/automations`;
      try {
        await orgA.ownerAgent.get(ofB).expect(403);
        await orgA.ownerAgent.post(ofB).set(CSRF_HEADERS).send({ name: "Intrusa", trigger: "contact_created", action: { type: "notify_team" } }).expect(403);
        await orgA.ownerAgent.patch(`${ofA}/${automation.id}`).set(CSRF_HEADERS).send({ enabled: false }).expect(404);
        await orgA.ownerAgent.delete(`${ofA}/${automation.id}`).set(CSRF_HEADERS).expect(404);
        await orgA.ownerAgent.get(`${ofA}/${automation.id}/runs`).expect(404);
        expect((await orgA.ownerAgent.get(ofA).expect(200)).body.map((row: { id: string }) => row.id)).not.toContain(automation.id);
        expect((await prisma.automation.findUniqueOrThrow({ where: { id: automation.id } })).enabled).toBe(true);
      } finally {
        await prisma.automation.deleteMany({ where: { id: automation.id } });
      }
    });

    it("A no pide la lectura comercial del sitio de B, ni metiendo el sitio de B bajo su organización (F6.4)", async () => {
      // Ambas se resuelven antes de leer métricas o llamar al modelo: las cifras de B nunca viajan.
      await orgA.ownerAgent.post(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/ai/insights`).set(CSRF_HEADERS).send({ days: 7 }).expect(403);
      await orgA.ownerAgent.post(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/ai/insights`).set(CSRF_HEADERS).send({ days: 7 }).expect(404);
    });
  });

  describe("Medición de terceros del sitio (F7.1, ADR-016): nunca se cruza", () => {
    it("A no lee ni cambia los identificadores de GA4 y Meta de un sitio de B", async () => {
      await prisma.site.update({ where: { id: orgB.siteId }, data: { ga4MeasurementId: "G-ISOLATEB1", metaPixelId: null } });
      try {
        await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/measurement`).expect(403);
        await orgA.ownerAgent.put(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/measurement`).set(CSRF_HEADERS).send({ ga4MeasurementId: "G-ATTACKA1", metaPixelId: null }).expect(403);
        await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/measurement`).expect(404);
        await orgA.ownerAgent.put(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/measurement`).set(CSRF_HEADERS).send({ ga4MeasurementId: "G-ATTACKA1", metaPixelId: null }).expect(404);
        expect((await prisma.site.findUniqueOrThrow({ where: { id: orgB.siteId } })).ga4MeasurementId).toBe("G-ISOLATEB1");
      } finally {
        await prisma.site.update({ where: { id: orgB.siteId }, data: { ga4MeasurementId: null } });
      }
    });
  });

  describe("Secuencias de correo (F7.5, ADR-020): nunca se cruzan", () => {
    it("A no ve, edita, prueba, borra ni lee las inscripciones de una secuencia de B", async () => {
      const ofB = `/api/v1/organizations/${orgB.id}/email-sequences`;
      const ofA = `/api/v1/organizations/${orgA.id}/email-sequences`;
      const step = { delayHours: 0, subject: "Hola", bodyHtml: "<p>Hola</p>" };
      const sequence = (await orgB.ownerAgent.post(ofB).set(CSRF_HEADERS).send({ name: "De B", trigger: "contact_created", steps: [step] }).expect(201)).body;
      try {
        await orgA.ownerAgent.get(ofB).expect(403);
        await orgA.ownerAgent.post(ofB).set(CSRF_HEADERS).send({ name: "Intrusa", trigger: "contact_created", steps: [step] }).expect(403);
        await orgA.ownerAgent.patch(`${ofA}/${sequence.id}`).set(CSRF_HEADERS).send({ enabled: false }).expect(404);
        await orgA.ownerAgent.delete(`${ofA}/${sequence.id}`).set(CSRF_HEADERS).expect(404);
        await orgA.ownerAgent.get(`${ofA}/${sequence.id}/enrollments`).expect(404);
        await orgA.ownerAgent.post(`${ofA}/${sequence.id}/steps/0/test`).set(CSRF_HEADERS).expect(404);
        expect((await orgA.ownerAgent.get(ofA).expect(200)).body.map((row: { id: string }) => row.id)).not.toContain(sequence.id);
        expect((await prisma.emailSequence.findUniqueOrThrow({ where: { id: sequence.id } })).enabled).toBe(true);
      } finally {
        await prisma.emailSequence.deleteMany({ where: { id: sequence.id } });
      }
    });
  });

  describe("Embudos de conversión (F7.6, ADR-021): nunca se cruzan", () => {
    it("A no ve, edita, borra ni calcula un embudo de B, ni crea uno en un sitio de B", async () => {
      const ofB = `/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/funnels`;
      const ofA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/funnels`;
      const steps = [
        { label: "Visita", events: ["page_view"] },
        { label: "Contacto", events: ["lead_created"] },
      ];
      const funnel = (await orgB.ownerAgent.post(ofB).set(CSRF_HEADERS).send({ name: "De B", steps }).expect(201)).body;
      try {
        await orgA.ownerAgent.get(ofB).expect(403);
        await orgA.ownerAgent.post(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/funnels`).set(CSRF_HEADERS).send({ name: "Intruso", steps }).expect(404);
        await orgA.ownerAgent.get(`${ofA}/${funnel.id}`).expect(404);
        await orgA.ownerAgent.get(`${ofA}/${funnel.id}/report`).query({ from: "2026-09-01", to: "2026-09-02" }).expect(404);
        await orgA.ownerAgent.patch(`${ofA}/${funnel.id}`).set(CSRF_HEADERS).send({ name: "Mío" }).expect(404);
        await orgA.ownerAgent.delete(`${ofA}/${funnel.id}`).set(CSRF_HEADERS).expect(404);
        expect((await orgA.ownerAgent.get(ofA).expect(200)).body.map((row: { id: string }) => row.id)).not.toContain(funnel.id);
        expect((await prisma.funnel.findUniqueOrThrow({ where: { id: funnel.id } })).name).toBe("De B");
      } finally {
        await prisma.funnel.deleteMany({ where: { id: funnel.id } });
      }
    });
  });

  describe("Modo campaña (F7.7, ADR-022): nunca se cruza", () => {
    it("A no ve, edita, cancela, borra ni reporta una campaña de B, ni crea una en un sitio de B", async () => {
      const page = await prisma.page.create({ data: { siteId: orgB.siteId, slug: `campana-${Date.now().toString(36)}`, position: 90 } });
      const campaign = await prisma.pageCampaign.create({
        data: {
          organizationId: orgB.id,
          siteId: orgB.siteId,
          pageId: page.id,
          name: "De B",
          objective: "vender",
          startsAt: new Date(Date.now() - 3_600_000),
          endsAt: new Date(Date.now() + 3_600_000),
          utmCampaign: "de-b",
        },
      });
      const ofA = `/api/v1/organizations/${orgA.id}/sites/${orgA.siteId}/page-campaigns`;
      try {
        await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/sites/${orgB.siteId}/page-campaigns`).expect(403);
        await orgA.ownerAgent
          .post(`/api/v1/organizations/${orgA.id}/sites/${orgB.siteId}/page-campaigns`)
          .set(CSRF_HEADERS)
          .send({ name: "Intrusa", objective: "vender", pageId: page.id, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString(), utmCampaign: "x1" })
          .expect(404);
        await orgA.ownerAgent.get(`${ofA}/${campaign.id}`).expect(404);
        await orgA.ownerAgent.get(`${ofA}/${campaign.id}/report`).expect(404);
        await orgA.ownerAgent.patch(`${ofA}/${campaign.id}`).set(CSRF_HEADERS).send({ name: "Mía" }).expect(404);
        await orgA.ownerAgent.post(`${ofA}/${campaign.id}/cancel`).set(CSRF_HEADERS).expect(404);
        await orgA.ownerAgent.delete(`${ofA}/${campaign.id}`).set(CSRF_HEADERS).expect(404);
        expect((await prisma.pageCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).cancelledAt).toBeNull();
      } finally {
        await prisma.page.deleteMany({ where: { id: page.id } });
      }
    });
  });

  describe("Webhooks salientes (F7.2, ADR-017): destinos, entregas y eventos nunca se cruzan", () => {
    it("A no ve, edita, prueba, rota ni reenvía lo de B, y un evento de B nunca llega a un destino de A", async () => {
      const ofB = `/api/v1/organizations/${orgB.id}/webhooks`;
      const ofA = `/api/v1/organizations/${orgA.id}/webhooks`;
      const endpointB = (await orgB.ownerAgent.post(ofB).set(CSRF_HEADERS).send({ url: "https://sink.impulza-isolation-nx.com/b", events: ["contact.created"] }).expect(201)).body.endpoint;
      const endpointA = (await orgA.ownerAgent.post(ofA).set(CSRF_HEADERS).send({ url: "https://sink.impulza-isolation-nx.com/a", events: ["contact.created"] }).expect(201)).body.endpoint;
      try {
        const deliveryB = (await orgB.ownerAgent.post(`${ofB}/${endpointB.id}/test`).set(CSRF_HEADERS).expect(201)).body;
        await prisma.webhookDelivery.update({ where: { id: deliveryB.id }, data: { status: "FAILED" } });

        await orgA.ownerAgent.get(ofB).expect(403);
        await orgA.ownerAgent.post(ofB).set(CSRF_HEADERS).send({ url: "https://sink.impulza-isolation-nx.com/x", events: ["contact.created"] }).expect(403);
        for (const route of [`${ofA}/${endpointB.id}`, `${ofB}/${endpointB.id}`]) {
          const expected = route.startsWith(ofA) ? 404 : 403;
          await orgA.ownerAgent.patch(route).set(CSRF_HEADERS).send({ url: "https://evil.impulza-isolation-nx.com/" }).expect(expected);
          await orgA.ownerAgent.post(`${route}/rotate-secret`).set(CSRF_HEADERS).expect(expected);
          await orgA.ownerAgent.post(`${route}/test`).set(CSRF_HEADERS).expect(expected);
          await orgA.ownerAgent.get(`${route}/deliveries`).expect(expected);
          await orgA.ownerAgent.get(`${route}/deliveries/${deliveryB.id}`).expect(expected);
          await orgA.ownerAgent.post(`${route}/deliveries/${deliveryB.id}/redeliver`).set(CSRF_HEADERS).expect(expected);
          await orgA.ownerAgent.delete(route).set(CSRF_HEADERS).expect(expected);
        }
        // La entrega de B bajo un destino de A tampoco.
        await orgA.ownerAgent.get(`${ofA}/${endpointA.id}/deliveries/${deliveryB.id}`).expect(404);
        expect((await orgA.ownerAgent.get(ofA).expect(200)).body.map((row: { id: string }) => row.id)).toEqual([endpointA.id]);
        expect(await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointB.id } })).toMatchObject({ url: "https://sink.impulza-isolation-nx.com/b", active: true });

        // Un contacto nuevo en B solo genera entregas para destinos de B.
        await orgB.ownerAgent.post(`/api/v1/organizations/${orgB.id}/contacts`).set(CSRF_HEADERS).send({ name: "Cliente de B" }).expect(201);
        expect(await prisma.webhookDelivery.count({ where: { endpointId: endpointA.id } })).toBe(0);
        expect(await prisma.webhookDelivery.count({ where: { endpointId: endpointB.id, eventType: "contact.created" } })).toBe(1);
      } finally {
        await prisma.webhookEndpoint.deleteMany({ where: { id: { in: [endpointA.id, endpointB.id] } } });
      }
    });
  });

  describe("Cuenta de cobro del negocio (F5.8, ADR-013): nunca se cruza", () => {
    it("A no ve, conecta ni desconecta la cuenta de Mercado Pago de B", async () => {
      const account = await prisma.paymentAccount.create({
        data: { organizationId: orgB.id, provider: "MERCADO_PAGO", providerUserId: "999", accessTokenEncrypted: "x.y.z", refreshTokenEncrypted: "x.y.z", expiresAt: new Date(Date.now() + 86_400_000), liveMode: false },
      });
      try {
        await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/payment-accounts`).expect(403);
        await orgA.ownerAgent.post(`/api/v1/organizations/${orgB.id}/payment-accounts/mercadopago/connect`).set(CSRF_HEADERS).expect(403);
        await orgA.ownerAgent.delete(`/api/v1/organizations/${orgB.id}/payment-accounts/mercadopago`).set(CSRF_HEADERS).expect(403);
        expect((await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/payment-accounts`).expect(200)).body.mercadoPago).toBeNull();
        expect(await prisma.paymentAccount.count({ where: { id: account.id } })).toBe(1);
      } finally {
        await prisma.paymentAccount.deleteMany({ where: { id: account.id } });
      }
    });

    it("A no ve ni cambia el cobro en línea de un pedido de B (F5.9)", async () => {
      const order = await prisma.order.create({
        data: {
          organizationId: orgB.id,
          siteId: orgB.siteId,
          productName: "Torta",
          productKind: "SERVICE",
          unitPriceAmount: 12_990,
          priceCurrency: "CLP",
          quantity: 1,
          totalAmount: 12_990,
          customerName: "Cliente de B",
          customerEmail: "cliente-b@isolation.test",
          checkoutPreferenceId: "pref-de-b",
          checkoutUrl: "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref-de-b",
          providerPaymentId: `iso-${Date.now()}`,
          paymentStatus: "approved",
          status: "PAID",
          paidAt: new Date(),
        },
      });
      try {
        await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/orders`).expect(403);
        await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/orders/${order.id}`).expect(404);
        await orgA.ownerAgent.patch(`/api/v1/organizations/${orgA.id}/orders/${order.id}`).set(CSRF_HEADERS).send({ status: "NEW" }).expect(404);
        // Tampoco devuelve su pago (F5.11a): ni bajo su organización ni bajo la de B.
        await orgA.ownerAgent.post(`/api/v1/organizations/${orgA.id}/orders/${order.id}/refund`).set(CSRF_HEADERS).send({}).expect(404);
        await orgA.ownerAgent.post(`/api/v1/organizations/${orgB.id}/orders/${order.id}/refund`).set(CSRF_HEADERS).send({}).expect(403);
        // Ni sube, confirma o quita el archivo en venta de un producto de B (F5.11b).
        const productB = await prisma.product.create({
          data: { organizationId: orgB.id, siteId: orgB.siteId, name: "Guía de B", kind: "DIGITAL", priceAmount: 1_000, priceCurrency: "CLP" },
        });
        const fileBase = (orgId: string) => `/api/v1/organizations/${orgId}/sites/${orgB.siteId}/catalog/products/${productB.id}/file`;
        await orgA.ownerAgent.post(fileBase(orgA.id)).set(CSRF_HEADERS).send({ fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }).expect(404);
        await orgA.ownerAgent.post(fileBase(orgB.id)).set(CSRF_HEADERS).send({ fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }).expect(403);
        await orgA.ownerAgent.delete(fileBase(orgA.id)).set(CSRF_HEADERS).expect(404);
        expect(await prisma.productFile.count({ where: { productId: productB.id } })).toBe(0);
        await prisma.product.delete({ where: { id: productB.id } });
        const listA = await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/orders`).expect(200);
        expect(JSON.stringify(listA.body)).not.toContain(order.providerPaymentId!);
        expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
      } finally {
        await prisma.order.deleteMany({ where: { id: order.id } });
      }
    });

    it("A no ve, confirma ni cancela una reserva de B que espera su seña (F5.10)", async () => {
      const startsAt = new Date("2032-03-01T13:00:00Z");
      const booking = await prisma.booking.create({
        data: {
          organizationId: orgB.id,
          siteId: orgB.siteId,
          serviceName: "Sesión de B",
          durationMinutes: 30,
          priceAmount: 20_000,
          priceCurrency: "CLP",
          startsAt,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000),
          timeZone: "America/Santiago",
          customerName: "Cliente de B",
          customerEmail: "cliente-b@isolation.test",
          status: "PENDING_PAYMENT",
          depositAmount: 5_000,
          paymentDeadline: new Date(Date.now() + 30 * 60_000),
          checkoutPreferenceId: "pref-de-b",
        },
      });
      try {
        await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/bookings/${booking.id}`).expect(404);
        await orgA.ownerAgent.patch(`/api/v1/organizations/${orgA.id}/bookings/${booking.id}`).set(CSRF_HEADERS).send({ status: "CONFIRMED" }).expect(404);
        await orgA.ownerAgent.patch(`/api/v1/organizations/${orgB.id}/bookings/${booking.id}`).set(CSRF_HEADERS).send({ status: "CANCELLED" }).expect(403);
        await orgA.ownerAgent.post(`/api/v1/organizations/${orgA.id}/bookings/${booking.id}/refund-deposit`).set(CSRF_HEADERS).send({}).expect(404);
        const agendaA = await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/bookings?from=2032-03-01T00:00:00Z&to=2032-03-02T00:00:00Z`).expect(200);
        expect(JSON.stringify(agendaA.body)).not.toContain(booking.id);
        expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("PENDING_PAYMENT");
      } finally {
        await prisma.booking.deleteMany({ where: { id: booking.id } });
      }
    });
  });

  describe("Cobro de suscripciones (F4.6a/F4.9): la facturación de una organización no se cruza", () => {
    it("A no lee la suscripción ni los pagos de B, no contrata a nombre de B, y los pagos de B nunca aparecen en A", async () => {
      const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "profesional" } });
      const start = new Date();
      const subscription = await prisma.subscription.create({
        data: { organizationId: orgB.id, planId: plan.id, status: "ACTIVE", gateway: "WEBPAY_ONECLICK", currentPeriodStart: start, currentPeriodEnd: new Date(start.getTime() + 30 * 24 * 3_600_000), cardLast4: "4242" },
      });
      const payment = await prisma.payment.create({
        data: { organizationId: orgB.id, subscriptionId: subscription.id, gateway: "WEBPAY_ONECLICK", buyOrder: `ISO${Date.now().toString(36).toUpperCase()}`, amount: 7_990, netAmount: 6_714, vatAmount: 1_276, currency: "CLP", periodStart: start, periodEnd: subscription.currentPeriodEnd, status: "APPROVED", paidAt: start },
      });
      try {
        await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/billing`).expect(403);
        await orgA.ownerAgent
          .post(`/api/v1/organizations/${orgB.id}/billing/checkout`)
          .set(CSRF_HEADERS)
          .send({ planCode: "profesional", cycle: "MONTHLY", gateway: "WEBPAY_ONECLICK", acceptTerms: true, acceptWithdrawalNotice: true })
          .expect(403);
        expect(await prisma.billingCheckout.count({ where: { organizationId: orgB.id } })).toBe(0);

        const ofA = (await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/billing`).expect(200)).body;
        expect(ofA.subscription).toBeNull();
        expect(JSON.stringify(ofA)).not.toContain(payment.id);
        expect(JSON.stringify(ofA)).not.toContain("4242");
        // El plan de A no se mueve por la suscripción de B.
        expect((await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/plan`).expect(200)).body.source).not.toBe("subscription");
      } finally {
        await prisma.payment.deleteMany({ where: { id: payment.id } });
        await prisma.subscription.deleteMany({ where: { id: subscription.id } });
      }
    });
  });

  describe("Superadministración y Feature Flags (F7.11, ADR-026): aislamiento estricto", () => {
    it("los usuarios y administradores de organizaciones no pueden acceder a endpoints de operación técnica", async () => {
      // Las sesiones de usuario/organización normales son rechazadas inmediatamente por AdminSessionGuard
      await orgA.ownerAgent.get("/api/v1/admin/operations/health").expect(401);
      await orgA.adminAgent.get("/api/v1/admin/operations/queues").expect(401);
      await orgB.ownerAgent.get("/api/v1/admin/feature-flags").expect(401);
      await orgB.ownerAgent.get("/api/v1/admin/templates").expect(401);
    });

    it("las reglas de feature flags por organización aíslan a A de B", async () => {
      const flags = app.get(FeatureFlagsService);
      const flagKey = `iso_flag_${Date.now().toString(36)}`;

      await prisma.featureFlag.create({
        data: {
          key: flagKey,
          name: "Flag de aislamiento",
          description: "Prueba de aislamiento",
          enabled: true,
          rules: {
            allowedOrganizations: [orgA.id],
          },
        },
      });

      try {
        const enabledForA = await flags.isEnabled(flagKey, orgA.id);
        const enabledForB = await flags.isEnabled(flagKey, orgB.id);

        expect(enabledForA).toBe(true);
        expect(enabledForB).toBe(false);
      } finally {
        await prisma.featureFlag.deleteMany({ where: { key: flagKey } });
      }
    });
  });

  describe("Newsletter (F7.4, ADR-019): estadísticas y suscriptores nunca se cruzan", () => {
    it("A no lee las estadísticas de newsletter de B, y los suscriptores de B no se suman a A", async () => {
      // A no puede consultar las estadísticas de B (403 Forbidden)
      await orgA.ownerAgent.get(`/api/v1/organizations/${orgB.id}/newsletter/stats`).expect(403);
      const statsAAntes = (await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/newsletter/stats`).expect(200)).body;

      // Crear una suscripción confirmada en B
      const email = `sub-b-${Date.now().toString(36)}${TEST_EMAIL_DOMAIN}`;
      const token = randomBytes(32).toString("hex");
      await prisma.newsletterConfirmation.create({
        data: {
          organizationId: orgB.id,
          siteId: orgB.siteId,
          email,
          tokenHash: createHash("sha256").update(token).digest("hex"),
          consentTextVersion: "2026-09-30",
          expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
          confirmedAt: new Date(),
        },
      });
      await prisma.contact.create({
        data: {
          organizationId: orgB.id,
          name: "Suscriptor B",
          email,
          // Así registra el sistema una suscripción confirmada: `stats` cuenta el origen `newsletter:<sitio>`.
          marketingConsentAt: new Date(),
          marketingConsentSource: `newsletter:${orgB.siteId}`,
          tags: ["newsletter"],
        },
      });
      // Y una confirmación pendiente (aún vigente) de B.
      const pendingEmail = `pend-b-${Date.now().toString(36)}${TEST_EMAIL_DOMAIN}`;
      await prisma.newsletterConfirmation.create({
        data: {
          organizationId: orgB.id,
          siteId: orgB.siteId,
          email: pendingEmail,
          tokenHash: createHash("sha256").update(randomBytes(32).toString("hex")).digest("hex"),
          consentTextVersion: "2026-09-30",
          expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
        },
      });

      try {
        // Las estadísticas de B reflejan su suscriptor confirmado
        const statsB = (await orgB.ownerAgent.get(`/api/v1/organizations/${orgB.id}/newsletter/stats`).expect(200)).body;
        expect(statsB.confirmedSubscribers).toBeGreaterThanOrEqual(1);
        expect(statsB.marketingAudience).toBeGreaterThanOrEqual(1);
        expect(statsB.pendingConfirmations).toBeGreaterThanOrEqual(1);

        // Las estadísticas de A no se contaminan con el suscriptor de B
        const statsA = (await orgA.ownerAgent.get(`/api/v1/organizations/${orgA.id}/newsletter/stats`).expect(200)).body;
        expect(statsA).toEqual(statsAAntes);
      } finally {
        await prisma.contact.deleteMany({ where: { email } });
        await prisma.newsletterConfirmation.deleteMany({ where: { email: { in: [email, pendingEmail] } } });
      }
    });
  });
});
