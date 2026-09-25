import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { siteThemeResponse, themeResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import { DEFAULT_THEME_CODE, THEME_CATALOG } from "@impulza/validation";
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

// F2.5 — temas y apariencia contra NestJS + Postgres reales.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@themes-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function uniqueEmail(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function uniqueSlug(prefix = "t5"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Paleta válida: "claro-profesional" con otro primario, para no depender de un tema del catálogo. */
const VALID_TOKENS = {
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
} as const;

describe("Themes (e2e) — F2.5", () => {
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

    // Mismo upsert idempotente que el seed. La suite no depende de que alguien haya corrido
    // `db:seed` antes: el catálogo es un dato global del producto, no del tenant de prueba, y un
    // test que falla por orden de preparación del entorno no dice nada sobre el código.
    for (const theme of THEME_CATALOG) {
      await prisma.theme.upsert({
        where: { code: theme.code },
        update: { name: theme.name, tokens: theme.tokens },
        create: { code: theme.code, name: theme.name, tokens: theme.tokens, organizationId: null },
      });
    }
  });

  afterAll(async () => {
    // Solo se limpian las organizaciones de prueba (y en cascada sus temas propios). El catálogo
    // global se deja donde estaba: no es nuestro para borrarlo.
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
    agent: ReturnType<typeof request.agent>;
    organizationId: string;
    siteId: string;
    themesPath: string;
    sitePath: string;
  }> {
    const { agent } = await registerLoggedInUser();

    const org = await agent
      .post("/api/v1/organizations")
      .set(CSRF_HEADERS)
      .send({ name: "Org Temas", slug: uniqueSlug("org") })
      .expect(201);
    // Plan con cupo (F4.2): estas pruebas verifican otra cosa, no los límites de Gratis.
    await assignRoomyPlan(prisma, org.body.id);
    const site = await agent
      .post(`/api/v1/organizations/${org.body.id}/sites`)
      .set(CSRF_HEADERS)
      .send({ name: "Sitio", slug: uniqueSlug("site") })
      .expect(201);

    return {
      agent,
      organizationId: org.body.id,
      siteId: site.body.id,
      themesPath: `/api/v1/organizations/${org.body.id}/themes`,
      sitePath: `/api/v1/organizations/${org.body.id}/sites/${site.body.id}`,
    };
  }

  describe("catálogo base", () => {
    it("lista los temas del catálogo, marcados como no editables", async () => {
      const { agent, themesPath } = await createOrgWithOwner();

      const response = await agent.get(themesPath).expect(200);
      // El contrato publicado en OpenAPI se ejecuta contra la respuesta real: un contrato que
      // nadie corre es documentación, no contrato.
      for (const theme of response.body) {
        themeResponse.parse(theme);
      }
      const catalog = response.body.filter((t: { source: string }) => t.source === "catalog");

      expect(catalog.length).toBe(THEME_CATALOG.length);
      for (const theme of catalog) {
        expect(theme.editable).toBe(false);
        expect(theme.code).toBeTruthy();
      }
      expect(catalog.map((t: { code: string }) => t.code)).toContain(DEFAULT_THEME_CODE);
    });

    it("un tema del catálogo no se puede editar ni borrar: se duplica", async () => {
      const { agent, themesPath } = await createOrgWithOwner();

      const list = await agent.get(themesPath).expect(200);
      const catalogTheme = list.body.find((t: { code: string }) => t.code === DEFAULT_THEME_CODE);

      await agent
        .patch(`${themesPath}/${catalogTheme.id}`)
        .set(CSRF_HEADERS)
        .send({ name: "Secuestrado" })
        .expect(403);
      await agent.delete(`${themesPath}/${catalogTheme.id}`).set(CSRF_HEADERS).expect(403);

      const copy = await agent
        .post(`${themesPath}/${catalogTheme.id}/duplicate`)
        .set(CSRF_HEADERS)
        .send({})
        .expect(201);

      expect(copy.body.source).toBe("organization");
      expect(copy.body.editable).toBe(true);
      expect(copy.body.code).toBeNull();
      expect(copy.body.tokens).toEqual(catalogTheme.tokens);

      // Y la copia sí se edita.
      await agent
        .patch(`${themesPath}/${copy.body.id}`)
        .set(CSRF_HEADERS)
        .send({ name: "Mi versión" })
        .expect(200);
    });
  });

  describe("validación de tokens en el servidor", () => {
    it("crea un tema propio con tokens válidos", async () => {
      const { agent, themesPath } = await createOrgWithOwner();

      const created = await agent
        .post(themesPath)
        .set(CSRF_HEADERS)
        .send({ name: "Marca propia", tokens: VALID_TOKENS })
        .expect(201);

      themeResponse.parse(created.body);
      expect(created.body).toMatchObject({ name: "Marca propia", source: "organization", editable: true });
      expect(created.body.tokens.palette.primary).toBe("#1d4ed8");
    });

    it("rechaza una paleta que no cumple WCAG 2.2 AA, indicando el campo", async () => {
      const { agent, themesPath } = await createOrgWithOwner();

      const response = await agent
        .post(themesPath)
        .set(CSRF_HEADERS)
        .send({
          name: "Ilegible",
          // Gris claro sobre blanco: ~1.5:1, muy por debajo del 4.5:1 exigido para texto.
          tokens: { ...VALID_TOKENS, palette: { ...VALID_TOKENS.palette, mutedForeground: "#cbd5e1" } },
        })
        .expect(422);

      expect(response.body.issues.map((i: { path: string }) => i.path)).toContain("palette.mutedForeground");
    });

    it("rechaza un botón primario que no se distingue del fondo", async () => {
      const { agent, themesPath } = await createOrgWithOwner();

      const response = await agent
        .post(themesPath)
        .set(CSRF_HEADERS)
        .send({
          name: "Botón invisible",
          tokens: {
            ...VALID_TOKENS,
            palette: { ...VALID_TOKENS.palette, primary: "#fbfbfb", primaryForeground: "#111111" },
          },
        })
        .expect(422);

      expect(response.body.issues.map((i: { path: string }) => i.path)).toContain("palette.primary");
    });

    it("no acepta CSS libre en un color: solo hexadecimal de 6 dígitos", async () => {
      const { agent, themesPath } = await createOrgWithOwner();

      for (const malicious of [
        "#fff; background-image: url(https://evil.example.com/x.png)",
        "red",
        "var(--x)",
        "expression(alert(1))",
        "#fff",
      ]) {
        await agent
          .post(themesPath)
          .set(CSRF_HEADERS)
          .send({
            name: "Inyección",
            tokens: { ...VALID_TOKENS, palette: { ...VALID_TOKENS.palette, background: malicious } },
          })
          .expect(422);
      }
    });

    it("no acepta valores fuera de las escalas cerradas", async () => {
      const { agent, themesPath } = await createOrgWithOwner();

      const outOfScale: Array<Record<string, unknown>> = [
        { radius: "pill" },
        { shadow: "heavy" },
        { density: "spacious" },
        { fontFamily: "Comic Sans MS" },
        { buttonStyle: "glass" },
      ];

      for (const override of outOfScale) {
        await agent
          .post(themesPath)
          .set(CSRF_HEADERS)
          .send({ name: "Fuera de escala", tokens: { ...VALID_TOKENS, ...override } })
          .expect(422);
      }
    });

    it("la validación también corre al actualizar, no solo al crear", async () => {
      const { agent, themesPath } = await createOrgWithOwner();

      const created = await agent
        .post(themesPath)
        .set(CSRF_HEADERS)
        .send({ name: "Mi tema", tokens: VALID_TOKENS })
        .expect(201);

      await agent
        .patch(`${themesPath}/${created.body.id}`)
        .set(CSRF_HEADERS)
        .send({ tokens: { ...VALID_TOKENS, palette: { ...VALID_TOKENS.palette, foreground: "#eeeeee" } } })
        .expect(422);

      // Lo guardado no cambió.
      const after = await agent.get(`${themesPath}/${created.body.id}`).expect(200);
      expect(after.body.tokens.palette.foreground).toBe("#0f172a");
    });

    it("un PATCH sin ningún campo es un error del cliente, no un 200 silencioso", async () => {
      const { agent, themesPath } = await createOrgWithOwner();
      const created = await agent
        .post(themesPath)
        .set(CSRF_HEADERS)
        .send({ name: "Mi tema", tokens: VALID_TOKENS })
        .expect(201);

      await agent.patch(`${themesPath}/${created.body.id}`).set(CSRF_HEADERS).send({}).expect(400);
    });
  });

  describe("aplicación a un sitio", () => {
    it("un sitio sin tema elegido usa el tema por defecto del catálogo", async () => {
      const { agent, sitePath } = await createOrgWithOwner();

      const theme = await agent.get(`${sitePath}/theme`).expect(200);

      siteThemeResponse.parse(theme.body);
      expect(theme.body.code).toBe(DEFAULT_THEME_CODE);
      expect(theme.body.isDefault).toBe(true);
    });

    it("aplicar un tema propio cambia el tema efectivo del sitio", async () => {
      const { agent, themesPath, sitePath } = await createOrgWithOwner();

      const created = await agent
        .post(themesPath)
        .set(CSRF_HEADERS)
        .send({ name: "Marca propia", tokens: VALID_TOKENS })
        .expect(201);

      await agent.put(`${sitePath}/theme`).set(CSRF_HEADERS).send({ themeId: created.body.id }).expect(200);

      const theme = await agent.get(`${sitePath}/theme`).expect(200);
      expect(theme.body.id).toBe(created.body.id);
      expect(theme.body.isDefault).toBe(false);
    });

    it("enviar themeId null devuelve el sitio al tema por defecto", async () => {
      const { agent, themesPath, sitePath } = await createOrgWithOwner();
      const created = await agent
        .post(themesPath)
        .set(CSRF_HEADERS)
        .send({ name: "Marca propia", tokens: VALID_TOKENS })
        .expect(201);

      await agent.put(`${sitePath}/theme`).set(CSRF_HEADERS).send({ themeId: created.body.id }).expect(200);
      await agent.put(`${sitePath}/theme`).set(CSRF_HEADERS).send({ themeId: null }).expect(200);

      const theme = await agent.get(`${sitePath}/theme`).expect(200);
      expect(theme.body.code).toBe(DEFAULT_THEME_CODE);
      expect(theme.body.isDefault).toBe(true);
    });

    it("no se puede aplicar un tema inexistente", async () => {
      const { agent, sitePath } = await createOrgWithOwner();

      await agent
        .put(`${sitePath}/theme`)
        .set(CSRF_HEADERS)
        .send({ themeId: "00000000-0000-4000-8000-000000000000" })
        .expect(404);
      // Y un themeId que ni siquiera es un uuid lo frena la validación de entrada.
      await agent.put(`${sitePath}/theme`).set(CSRF_HEADERS).send({ themeId: "no-soy-uuid" }).expect(400);
    });
  });

  describe("eliminación", () => {
    it("no borra un tema que algún sitio tiene aplicado", async () => {
      const { agent, themesPath, sitePath } = await createOrgWithOwner();
      const created = await agent
        .post(themesPath)
        .set(CSRF_HEADERS)
        .send({ name: "En uso", tokens: VALID_TOKENS })
        .expect(201);

      await agent.put(`${sitePath}/theme`).set(CSRF_HEADERS).send({ themeId: created.body.id }).expect(200);
      await agent.delete(`${themesPath}/${created.body.id}`).set(CSRF_HEADERS).expect(409);

      // Sigue existiendo y el sitio sigue mostrándolo: nada cambió en silencio.
      await agent.get(`${themesPath}/${created.body.id}`).expect(200);
      const theme = await agent.get(`${sitePath}/theme`).expect(200);
      expect(theme.body.id).toBe(created.body.id);
    });

    it("borra un tema propio que no está en uso", async () => {
      const { agent, themesPath, sitePath } = await createOrgWithOwner();
      const created = await agent
        .post(themesPath)
        .set(CSRF_HEADERS)
        .send({ name: "Descartable", tokens: VALID_TOKENS })
        .expect(201);

      await agent.put(`${sitePath}/theme`).set(CSRF_HEADERS).send({ themeId: created.body.id }).expect(200);
      await agent.put(`${sitePath}/theme`).set(CSRF_HEADERS).send({ themeId: null }).expect(200);

      await agent.delete(`${themesPath}/${created.body.id}`).set(CSRF_HEADERS).expect(204);
      await agent.get(`${themesPath}/${created.body.id}`).expect(404);
    });
  });

  describe("permisos", () => {
    it("un EDITOR puede aplicar un tema, pero no crear ni editar temas", async () => {
      const { agent: owner, organizationId, themesPath, sitePath } = await createOrgWithOwner();
      const editor = await registerLoggedInUser();

      const invite = await owner
        .post(`/api/v1/organizations/${organizationId}/members`)
        .set(CSRF_HEADERS)
        .send({ email: editor.email, role: "EDITOR" })
        .expect(201);
      await editor.agent
        .post(`/api/v1/memberships/${invite.body.membershipId}/accept`)
        .set(CSRF_HEADERS)
        .expect(204);

      const ownerTheme = await owner
        .post(themesPath)
        .set(CSRF_HEADERS)
        .send({ name: "Del owner", tokens: VALID_TOKENS })
        .expect(201);

      // Autoría de temas: necesita theme.manage, que EDITOR no tiene.
      await editor.agent
        .post(themesPath)
        .set(CSRF_HEADERS)
        .send({ name: "Del editor", tokens: VALID_TOKENS })
        .expect(403);
      await editor.agent
        .patch(`${themesPath}/${ownerTheme.body.id}`)
        .set(CSRF_HEADERS)
        .send({ name: "Renombrado" })
        .expect(403);
      await editor.agent.delete(`${themesPath}/${ownerTheme.body.id}`).set(CSRF_HEADERS).expect(403);

      // Leer y aplicar: es configuración del sitio (site.update), que sí tiene.
      await editor.agent.get(themesPath).expect(200);
      await editor.agent
        .put(`${sitePath}/theme`)
        .set(CSRF_HEADERS)
        .send({ themeId: ownerTheme.body.id })
        .expect(200);
    });

    it("un ANALYST no puede aplicar ni crear temas, pero sí verlos", async () => {
      const { agent: owner, organizationId, themesPath, sitePath } = await createOrgWithOwner();
      const analyst = await registerLoggedInUser();

      const invite = await owner
        .post(`/api/v1/organizations/${organizationId}/members`)
        .set(CSRF_HEADERS)
        .send({ email: analyst.email, role: "ANALYST" })
        .expect(201);
      await analyst.agent
        .post(`/api/v1/memberships/${invite.body.membershipId}/accept`)
        .set(CSRF_HEADERS)
        .expect(204);

      await analyst.agent.get(themesPath).expect(200);
      await analyst.agent
        .post(themesPath)
        .set(CSRF_HEADERS)
        .send({ name: "Del analista", tokens: VALID_TOKENS })
        .expect(403);
      await analyst.agent.put(`${sitePath}/theme`).set(CSRF_HEADERS).send({ themeId: null }).expect(403);
    });
  });

  describe("aislamiento entre organizaciones", () => {
    it("el tema propio de una organización no existe para otra", async () => {
      const a = await createOrgWithOwner();
      const b = await createOrgWithOwner();

      const themeOfB = await b.agent
        .post(b.themesPath)
        .set(CSRF_HEADERS)
        .send({ name: "Privado de B", tokens: VALID_TOKENS })
        .expect(201);

      // No aparece en el listado de A.
      const listOfA = await a.agent.get(a.themesPath).expect(200);
      expect(listOfA.body.map((t: { id: string }) => t.id)).not.toContain(themeOfB.body.id);

      // Ni se alcanza por id usando la organización propia de A (ataque de id cruzado).
      await a.agent.get(`${a.themesPath}/${themeOfB.body.id}`).expect(404);
      await a.agent
        .patch(`${a.themesPath}/${themeOfB.body.id}`)
        .set(CSRF_HEADERS)
        .send({ name: "Secuestrado" })
        .expect(404);
      await a.agent.delete(`${a.themesPath}/${themeOfB.body.id}`).set(CSRF_HEADERS).expect(404);

      // Ni se puede aplicar al sitio propio de A.
      await a.agent
        .put(`${a.sitePath}/theme`)
        .set(CSRF_HEADERS)
        .send({ themeId: themeOfB.body.id })
        .expect(404);

      // El tema de B quedó intacto.
      const afterB = await b.agent.get(`${b.themesPath}/${themeOfB.body.id}`).expect(200);
      expect(afterB.body.name).toBe("Privado de B");
    });

    it("ambas organizaciones ven el mismo catálogo global, y solo eso en común", async () => {
      const a = await createOrgWithOwner();
      const b = await createOrgWithOwner();

      await a.agent.post(a.themesPath).set(CSRF_HEADERS).send({ name: "De A", tokens: VALID_TOKENS }).expect(201);
      await b.agent.post(b.themesPath).set(CSRF_HEADERS).send({ name: "De B", tokens: VALID_TOKENS }).expect(201);

      const listA = await a.agent.get(a.themesPath).expect(200);
      const listB = await b.agent.get(b.themesPath).expect(200);

      const ownNamesA = listA.body.filter((t: { source: string }) => t.source === "organization");
      const ownNamesB = listB.body.filter((t: { source: string }) => t.source === "organization");

      expect(ownNamesA.map((t: { name: string }) => t.name)).toEqual(["De A"]);
      expect(ownNamesB.map((t: { name: string }) => t.name)).toEqual(["De B"]);

      const catalogA = listA.body.filter((t: { source: string }) => t.source === "catalog");
      const catalogB = listB.body.filter((t: { source: string }) => t.source === "catalog");
      expect(catalogA.map((t: { id: string }) => t.id).sort()).toEqual(
        catalogB.map((t: { id: string }) => t.id).sort(),
      );
    });
  });
});
