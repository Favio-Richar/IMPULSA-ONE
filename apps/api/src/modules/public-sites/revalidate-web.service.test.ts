import type { PrismaClient } from "@impulza/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Unitario, sin base de datos real: lo que hay que probar es la llamada HTTP en sí (URL, cabecera
// del secreto, cuerpo) y que nunca lanza — la lógica de negocio de publicar/restaurar ya está
// cubierta en pages.e2e.test.ts. `env` se lee una sola vez al importar el módulo (mismo criterio
// que apps/api/src/env.ts en producción), así que cada caso muta `process.env` y reimporta con
// `vi.resetModules()` para ejercer las dos configuraciones posibles. Prisma se reemplaza por un
// doble mínimo: esta clase solo hace una consulta (`site.findUnique`), no vale la pena un Postgres
// real para probar que arma bien la URL y el cuerpo del webhook.

const REQUIRED_ENV = {
  NODE_ENV: "test",
  PORT: "4000",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  CORS_ORIGINS: "http://localhost:3000",
  AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  APP_BASE_URL: "http://localhost:3100",
};

function fakePrisma(slug: string | null): PrismaClient {
  return {
    site: { findUnique: vi.fn().mockResolvedValue(slug ? { slug } : null) },
  } as unknown as PrismaClient;
}

async function importFreshService() {
  vi.resetModules();
  const mod = await import("./revalidate-web.service.js");
  return mod.RevalidateWebService;
}

describe("RevalidateWebService (F2.7)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED_ENV };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("no llama a nada si WEB_APP_URL o WEB_REVALIDATE_SECRET no están configurados", async () => {
    delete process.env.WEB_APP_URL;
    delete process.env.WEB_REVALIDATE_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const RevalidateWebService = await importFreshService();
    await new RevalidateWebService(fakePrisma("mi-sitio")).revalidateSite("site-123");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no llama a nada si el sitio ya no existe (borrado entre la publicación y el aviso)", async () => {
    process.env.WEB_APP_URL = "https://sitios.impulza.one";
    process.env.WEB_REVALIDATE_SECRET = "s".repeat(32);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const RevalidateWebService = await importFreshService();
    await new RevalidateWebService(fakePrisma(null)).revalidateSite("site-123");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("llama al webhook con la URL, el secreto y el slug (no el id) del sitio", async () => {
    process.env.WEB_APP_URL = "https://sitios.impulza.one";
    process.env.WEB_REVALIDATE_SECRET = "s".repeat(32);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const RevalidateWebService = await importFreshService();
    await new RevalidateWebService(fakePrisma("mi-sitio")).revalidateSite("site-123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://sitios.impulza.one/api/revalidate");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-revalidate-secret"]).toBe("s".repeat(32));
    expect(JSON.parse(init.body as string)).toEqual({ siteSlug: "mi-sitio" });
  });

  it("no lanza si el webhook responde con error (el sitio sigue publicado igual)", async () => {
    process.env.WEB_APP_URL = "https://sitios.impulza.one";
    process.env.WEB_REVALIDATE_SECRET = "s".repeat(32);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    const RevalidateWebService = await importFreshService();
    await expect(
      new RevalidateWebService(fakePrisma("mi-sitio")).revalidateSite("site-123"),
    ).resolves.toBeUndefined();
  });

  it("no lanza si el webhook no responde (apps/web caído o inalcanzable)", async () => {
    process.env.WEB_APP_URL = "https://sitios.impulza.one";
    process.env.WEB_REVALIDATE_SECRET = "s".repeat(32);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED")));

    const RevalidateWebService = await importFreshService();
    await expect(
      new RevalidateWebService(fakePrisma("mi-sitio")).revalidateSite("site-123"),
    ).resolves.toBeUndefined();
  });
});
