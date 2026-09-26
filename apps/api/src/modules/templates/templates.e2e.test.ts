import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { templateResponse } from "@impulza/contracts";
import type { Prisma, PrismaClient } from "@impulza/database";
import type { TemplateDefinition } from "@impulza/validation";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";

// PL1 — catálogo de plantillas contra NestJS + Postgres reales. Las filas de prueba llevan un
// prefijo propio y se borran al final: la suite no depende del seed ni lo altera.

const PREFIX = `e2e-tpl-${Date.now().toString(36)}`;

function row(code: string, overrides: Partial<TemplateDefinition> = {}): Prisma.TemplateCreateInput {
  const template: TemplateDefinition = {
    code,
    name: "Plantilla de prueba",
    description: "Contenido ficticio para la prueba del catálogo.",
    industryTags: ["profesional"],
    objectiveTags: ["captar"],
    themeCode: "claro-profesional",
    family: "clasico",
    background: null,
    previewImageUrl: null,
    sortOrder: 9000,
    blocksSeed: [
      { type: "profile", configSchemaVersion: 1, config: { name: "Nombre de ejemplo", verified: false } },
      { type: "whatsapp", configSchemaVersion: 1, isPrimary: true, config: { phone: "+56900000000", label: "Escríbeme" } },
    ],
    ...overrides,
  };

  return {
    ...template,
    background: template.background ?? undefined,
    blocksSeed: template.blocksSeed as Prisma.InputJsonValue,
  };
}

describe("Templates (e2e) — PL1", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    httpServer = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);

    await prisma.template.createMany({
      data: [
        row(`${PREFIX}-servicios`),
        row(`${PREFIX}-creador`, {
          industryTags: ["creador"],
          objectiveTags: ["compartir", "vender"],
          themeCode: "oscuro-noche",
          family: "oscuro",
          background: { kind: "gradient", gradient: "grafito" },
          sortOrder: 9001,
        }),
      ],
    });
    // Una fila que ya no cumple el esquema (un bloque con un enlace `javascript:`), como si el
    // catálogo de bloques hubiese cambiado después de sembrarla.
    await prisma.template.create({
      data: {
        ...row(`${PREFIX}-rota`, { sortOrder: 9002 }),
        blocksSeed: [{ type: "link", configSchemaVersion: 1, config: { label: "Ver", url: "javascript:alert(1)" } }],
      },
    });
  });

  afterAll(async () => {
    await prisma.template.deleteMany({ where: { code: { startsWith: PREFIX } } });
    await app.close();
  });

  beforeEach(async () => {
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  function ours(body: unknown): z.infer<typeof templateResponse>[] {
    return z
      .array(templateResponse)
      .parse(body)
      .filter((template) => template.code.startsWith(PREFIX));
  }

  it("lista sin sesión, en orden de galería, con el tema y los bloques, cumpliendo el contrato", async () => {
    const response = await request(httpServer).get("/api/v1/templates").expect(200);
    const templates = ours(response.body);

    expect(templates.map((template) => template.code)).toEqual([`${PREFIX}-servicios`, `${PREFIX}-creador`]);

    const creator = templates[1]!;
    expect(creator.family).toBe("oscuro");
    expect(creator.theme.code).toBe("oscuro-noche");
    expect(creator.theme.tokens).toMatchObject({ palette: expect.any(Object) });
    expect(creator.background).toEqual({ kind: "gradient", gradient: "grafito" });
    expect(creator.blocks.map((block) => block.type)).toEqual(["profile", "whatsapp"]);
    expect(creator.blocks[1]!.isPrimary).toBe(true);
    expect(creator.blocks[0]).not.toHaveProperty("isPrimary");
  });

  it("omite una plantilla que ya no cumple el esquema en vez de romper la galería", async () => {
    const response = await request(httpServer).get("/api/v1/templates").expect(200);
    expect(ours(response.body).map((template) => template.code)).not.toContain(`${PREFIX}-rota`);
  });

  it("filtra por industria, objetivo y línea de estilo, combinables", async () => {
    const byIndustry = await request(httpServer).get("/api/v1/templates?industry=creador").expect(200);
    expect(ours(byIndustry.body).map((template) => template.code)).toEqual([`${PREFIX}-creador`]);

    const byObjective = await request(httpServer).get("/api/v1/templates?objective=captar").expect(200);
    expect(ours(byObjective.body).map((template) => template.code)).toEqual([`${PREFIX}-servicios`]);

    const combined = await request(httpServer).get("/api/v1/templates?family=oscuro&objective=captar").expect(200);
    expect(ours(combined.body)).toEqual([]);

    const allTemplates = z.array(templateResponse).parse(byIndustry.body);
    expect(allTemplates.every((template) => template.industryTags.includes("creador"))).toBe(true);
  });

  it("rechaza un filtro fuera del catálogo con 400", async () => {
    await request(httpServer).get("/api/v1/templates?industry=mineria").expect(400);
    await request(httpServer).get("/api/v1/templates?family=neon").expect(400);
  });

  it("lee una plantilla por código y responde 404 si no existe o está rota", async () => {
    const response = await request(httpServer).get(`/api/v1/templates/${PREFIX}-servicios`).expect(200);
    expect(templateResponse.parse(response.body).code).toBe(`${PREFIX}-servicios`);

    await request(httpServer).get(`/api/v1/templates/${PREFIX}-no-existe`).expect(404);
    await request(httpServer).get(`/api/v1/templates/${PREFIX}-rota`).expect(404);
  });

  it("aplica límite de tasa por IP a la lista", async () => {
    for (let index = 0; index < 60; index += 1) {
      await request(httpServer).get("/api/v1/templates?family=ejecutivo").expect(200);
    }
    await request(httpServer).get("/api/v1/templates?family=ejecutivo").expect(429);
  });
});
