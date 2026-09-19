import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { healthResponse } from "@impulza/contracts";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";

// F1.10 — /health real: consulta Postgres y Redis de verdad (docker-compose.yml), no un 200
// estático. Se registra sin el prefijo /api/v1 (endpoint de infraestructura, ver main.ts).
describe("Health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1", { exclude: ["health"] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("responde 200 con status ok y ambas dependencias arriba, sin exponer el prefijo /api/v1", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(200);

    // El contrato publicado en OpenAPI se ejecuta contra la respuesta real: un contrato que
    // nadie corre es documentación, no contrato.
    healthResponse.parse(response.body);

    expect(response.body.status).toBe("ok");
    expect(response.body.service).toBe("impulza-api");
    expect(response.body.checks).toEqual({ database: "ok", redis: "ok" });
    expect(typeof response.body.timestamp).toBe("string");
  });

  it("no requiere sesión ni cabecera CSRF (probe de infraestructura)", async () => {
    await request(app.getHttpServer()).get("/health").expect(200);
  });

  it("no vive bajo /api/v1", async () => {
    await request(app.getHttpServer()).get("/api/v1/health").expect(404);
  });
});
