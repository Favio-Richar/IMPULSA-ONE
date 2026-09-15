import { describe, expect, it } from "vitest";
import {
  corsOriginsSchema,
  databaseUrlSchema,
  encryptionKeySchema,
  loadEnv,
  nodeEnvSchema,
  portSchema,
  redisUrlSchema,
} from "./index.js";

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

describe("corsOriginsSchema", () => {
  it("parsea una lista separada por comas en un arreglo de orígenes", () => {
    expect(corsOriginsSchema.parse("http://localhost:3000, http://localhost:3100")).toEqual([
      "http://localhost:3000",
      "http://localhost:3100",
    ]);
  });

  it("rechaza un valor vacío (nunca CORS abierto por accidente)", () => {
    expect(() => corsOriginsSchema.parse("")).toThrow();
  });

  it("rechaza un origen que no sea una URL válida", () => {
    expect(() => corsOriginsSchema.parse("no-es-una-url")).toThrow();
  });
});

describe("encryptionKeySchema", () => {
  it("acepta una clave de 32 bytes en base64", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(encryptionKeySchema.parse(key)).toBe(key);
  });

  it("rechaza una clave que no tenga 32 bytes", () => {
    const shortKey = Buffer.alloc(16, 7).toString("base64");
    expect(() => encryptionKeySchema.parse(shortKey)).toThrow(/32 bytes/);
  });
});
