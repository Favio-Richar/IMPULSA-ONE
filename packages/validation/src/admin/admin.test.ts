import { describe, expect, it } from "vitest";
import {
  BULLMQ_QUEUES,
  bullMqQueueNameSchema,
  featureFlagKeySchema,
  QUEUE_ACTIONS,
  queueActionSchema,
  SYSTEM_FEATURE_FLAGS,
  updateFeatureFlagSchema,
  updateTemplateAdminSchema,
} from "./index.js";

describe("Admin validation schemas (F7.11, ADR-026)", () => {
  // Esta lista debe coincidir con las colas que de verdad existen en el código; la comparación con el
  // código fuente está en `apps/api/src/modules/admin/queue-names.test.ts` (aquí solo la forma).
  it("BULLMQ_QUEUES no repite nombres y son nombres de cola válidos", () => {
    expect(new Set(BULLMQ_QUEUES).size).toBe(BULLMQ_QUEUES.length);
    for (const name of BULLMQ_QUEUES) {
      expect(name).toMatch(/^[a-z]+(-[a-z]+)+$/);
    }
  });

  it("bullMqQueueNameSchema valida nombres válidos y rechaza desconocidos", () => {
    expect(bullMqQueueNameSchema.safeParse("analytics-events").success).toBe(true);
    expect(bullMqQueueNameSchema.safeParse("unknown-queue").success).toBe(false);
  });

  it("queueActionSchema valida las acciones permitidas", () => {
    for (const action of QUEUE_ACTIONS) {
      expect(queueActionSchema.safeParse(action).success).toBe(true);
    }
    expect(queueActionSchema.safeParse("delete").success).toBe(false);
    expect(queueActionSchema.safeParse("").success).toBe(false);
  });

  it("SYSTEM_FEATURE_FLAGS define las 6 banderas iniciales del sistema", () => {
    expect(SYSTEM_FEATURE_FLAGS).toHaveLength(6);
    const keys = SYSTEM_FEATURE_FLAGS.map((f) => f.key);
    expect(keys).toEqual([
      "registros_abiertos",
      "pagos_en_linea",
      "ia_generativa",
      "campanas_correo",
      "sincronizacion_calendarios",
      "webhooks_salientes",
    ]);
  });

  it("featureFlagKeySchema valida formato de clave", () => {
    expect(featureFlagKeySchema.safeParse("registros_abiertos").success).toBe(true);
    expect(featureFlagKeySchema.safeParse("pagos_en_linea_2").success).toBe(true);
    expect(featureFlagKeySchema.safeParse("ClaveConMayusculas").success).toBe(false);
    expect(featureFlagKeySchema.safeParse("ab").success).toBe(false); // min 3
    expect(featureFlagKeySchema.safeParse("clave-con-guion").success).toBe(false);
  });

  it("updateFeatureFlagSchema valida modificaciones de estado y reglas", () => {
    expect(updateFeatureFlagSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(
      updateFeatureFlagSchema.safeParse({
        enabled: false,
        rules: { allowlist: ["org-1", "org-2"] },
      }).success,
    ).toBe(true);
    expect(updateFeatureFlagSchema.safeParse({}).success).toBe(false);
    expect(updateFeatureFlagSchema.safeParse({ enabled: "si" }).success).toBe(false);
  });

  it("updateTemplateAdminSchema exige al menos un campo", () => {
    expect(updateTemplateAdminSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(updateTemplateAdminSchema.safeParse({ isFeatured: true }).success).toBe(true);
    expect(updateTemplateAdminSchema.safeParse({ sortOrder: 5 }).success).toBe(true);
    expect(updateTemplateAdminSchema.safeParse({}).success).toBe(false);
    expect(updateTemplateAdminSchema.safeParse({ sortOrder: -1 }).success).toBe(false);
    expect(updateTemplateAdminSchema.safeParse({ sortOrder: 99999 }).success).toBe(false);
  });
});
