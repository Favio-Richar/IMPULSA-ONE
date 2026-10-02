import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@impulza/database";
import { SYSTEM_FEATURE_FLAGS } from "@impulza/validation";
import type { Redis } from "ioredis";
import { FeatureFlagsService } from "./feature-flags.service.js";

vi.mock("../../observability/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Row = { enabled: boolean; rules: Record<string, unknown> | null };

function setup(rows: Record<string, Row> = {}, options: { redisDown?: boolean; dbDown?: boolean } = {}) {
  const cache = new Map<string, string>();
  const redis = {
    get: vi.fn(async (key: string) => {
      if (options.redisDown) throw new Error("redis caído");
      return cache.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: string) => {
      if (options.redisDown) throw new Error("redis caído");
      cache.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      cache.delete(key);
      return 1;
    }),
  };
  const prisma = {
    featureFlag: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        if (options.dbDown) throw new Error("base caída");
        return rows[where.key] ?? null;
      }),
    },
  };
  const service = new FeatureFlagsService(prisma as unknown as PrismaClient, redis as unknown as Redis);
  return { service, rows, prisma, redis, cache };
}

describe("FeatureFlagsService (F7.11, ADR-026)", () => {
  it("una bandera sin fila vale su valor por defecto, nunca 'apagada'", async () => {
    const { service } = setup();
    for (const flag of SYSTEM_FEATURE_FLAGS) {
      expect(await service.isEnabled(flag.key)).toBe(flag.defaultEnabled);
    }
  });

  it("respeta la fila de la base cuando existe", async () => {
    const { service } = setup({ registros_abiertos: { enabled: false, rules: null } });
    expect(await service.isEnabled("registros_abiertos")).toBe(false);
    expect(await service.isEnabled("pagos_en_linea")).toBe(true);
  });

  it("si Redis o la base fallan, la función sigue disponible: un fallo de infraestructura no apaga la plataforma", async () => {
    expect(await setup({}, { redisDown: true }).service.isEnabled("pagos_en_linea")).toBe(true);
    expect(await setup({}, { dbDown: true }).service.isEnabled("pagos_en_linea")).toBe(true);
  });

  it("reglas por organización: la lista permitida manda; si no hay, la lista bloqueada excluye", async () => {
    const allow = setup({ ia_generativa: { enabled: true, rules: { allowedOrganizations: ["org-a"] } } });
    expect(await allow.service.isEnabled("ia_generativa", "org-a")).toBe(true);
    expect(await allow.service.isEnabled("ia_generativa", "org-b")).toBe(false);

    const block = setup({ ia_generativa: { enabled: true, rules: { blockedOrganizations: ["org-b"] } } });
    expect(await block.service.isEnabled("ia_generativa", "org-a")).toBe(true);
    expect(await block.service.isEnabled("ia_generativa", "org-b")).toBe(false);
  });

  it("apagada globalmente gana sobre cualquier regla de organización", async () => {
    const { service } = setup({ ia_generativa: { enabled: false, rules: { allowedOrganizations: ["org-a"] } } });
    expect(await service.isEnabled("ia_generativa", "org-a")).toBe(false);
  });

  it("usa la caché (60 s) y `invalidate` hace que el cambio rija de inmediato", async () => {
    const { service, prisma, rows } = setup({ pagos_en_linea: { enabled: true, rules: null } });
    expect(await service.isEnabled("pagos_en_linea")).toBe(true);
    expect(await service.isEnabled("pagos_en_linea")).toBe(true);
    expect(prisma.featureFlag.findUnique).toHaveBeenCalledTimes(1);

    rows.pagos_en_linea = { enabled: false, rules: null };
    expect(await service.isEnabled("pagos_en_linea")).toBe(true); // aún en caché
    await service.invalidate("pagos_en_linea");
    expect(await service.isEnabled("pagos_en_linea")).toBe(false);
  });
});
