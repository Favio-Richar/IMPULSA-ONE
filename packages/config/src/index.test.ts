import { describe, expect, it } from "vitest";
import { databaseUrlSchema, loadEnv, nodeEnvSchema, portSchema, redisUrlSchema } from "./index.js";

const shape = {
  NODE_ENV: nodeEnvSchema,
  PORT: portSchema,
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
};

describe("loadEnv", () => {
  it("parsea variables válidas y coacciona PORT a número", () => {
    const env = loadEnv(shape, {
      NODE_ENV: "test",
      PORT: "4000",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/impulza",
      REDIS_URL: "redis://localhost:6379",
    });

    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("test");
  });

  it("aplica NODE_ENV=development por defecto si no viene definido", () => {
    const env = loadEnv(shape, {
      PORT: "4000",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/impulza",
      REDIS_URL: "redis://localhost:6379",
    });

    expect(env.NODE_ENV).toBe("development");
  });

  it("lanza un error legible cuando falta una variable requerida", () => {
    expect(() =>
      loadEnv(shape, {
        NODE_ENV: "test",
      } as NodeJS.ProcessEnv),
    ).toThrowError(/DATABASE_URL/);
  });

  it("rechaza un DATABASE_URL que no sea de PostgreSQL", () => {
    expect(() =>
      loadEnv(shape, {
        NODE_ENV: "test",
        PORT: "4000",
        DATABASE_URL: "mysql://localhost/db",
        REDIS_URL: "redis://localhost:6379",
      }),
    ).toThrowError(/PostgreSQL/);
  });

  it("rechaza un REDIS_URL con protocolo inválido", () => {
    expect(() =>
      loadEnv(shape, {
        NODE_ENV: "test",
        PORT: "4000",
        DATABASE_URL: "postgresql://localhost/db",
        REDIS_URL: "http://localhost:6379",
      }),
    ).toThrowError(/Redis/);
  });
});
