import { describe, expect, it } from "vitest";
import { BLOCK_CATALOG } from "../blocks/catalog.js";
import {
  AB_BUCKET_COUNT,
  AB_TEST_BLOCK_TYPES,
  abMetricKey,
  abVariantFor,
  abVariantSchema,
  applyAbVariant,
  evaluateAbTest,
  isAbTestBlockType,
  parseAbBucket,
} from "./index.js";

describe("pruebas A/B (F6.5)", () => {
  it("la variante B solo cambia texto o estilo de la acción, al menos un campo y sin claves ajenas", () => {
    const link = abVariantSchema("link");
    expect(link.safeParse({ label: "Reserva hoy" }).success).toBe(true);
    expect(link.safeParse({ style: "outline" }).success).toBe(true);
    expect(link.safeParse({}).success).toBe(false);
    expect(link.safeParse({ url: "https://otro.example.com" }).success).toBe(false);
    expect(link.safeParse({ label: "a".repeat(81) }).success).toBe(false);
    expect(abVariantSchema("profile").safeParse({ name: "Otro nombre" }).success).toBe(false);
    expect(isAbTestBlockType("contact_form")).toBe(false);
  });

  it("cada campo que se puede variar existe en el esquema del bloque y la mezcla sigue siendo válida", () => {
    const samples = {
      link: { label: "Ver", url: "https://example.com" },
      whatsapp: { phone: "+56912345678", label: "Escríbenos" },
      booking: { label: "Reservar" },
      catalog: { label: "Tienda" },
      profile: { name: "Ana" },
    } as const;
    for (const type of AB_TEST_BLOCK_TYPES) {
      const variant = type === "link" ? { label: "Otro", description: "Nuevo", style: "outline" } : type === "profile" ? { headline: "Nuevo" } : { label: "Otro" };
      expect(BLOCK_CATALOG[type].schema.safeParse(applyAbVariant(samples[type], variant)).success, type).toBe(true);
    }
  });

  it("el grupo de la cookie se valida y la asignación es estable, exactamente mitad y mitad, y distinta por prueba", () => {
    expect(parseAbBucket("42")).toBe(42);
    for (const bad of [null, "", "100", "-1", "4.2", "abc", "007"]) {
      expect(parseAbBucket(bad)).toBeNull();
    }
    const assignments = Array.from({ length: AB_BUCKET_COUNT }, (_, bucket) => abVariantFor("prueba-1", bucket));
    expect(assignments.filter((variant) => variant === "b")).toHaveLength(AB_BUCKET_COUNT / 2);
    expect(abVariantFor("prueba-1", 7)).toBe(abVariantFor("prueba-1", 7));
    const keys = Array.from({ length: 20 }, (_, index) => `clave-${index}`);
    const firstBucket = new Set(keys.map((key) => abVariantFor(key, 0)));
    expect(firstBucket.size).toBe(2);
  });

  it("sin muestra suficiente no hay resultado, aunque la diferencia parezca enorme", () => {
    const result = evaluateAbTest({ exposures: 50, clicks: 5, conversions: 0 }, { exposures: 50, clicks: 25, conversions: 0 });
    expect(result).toMatchObject({ verdict: "insufficient_sample", winner: null, pValue: null, rateA: 0.1, rateB: 0.5 });
  });

  it("con muestra, una diferencia significativa da ganador y una pequeña no", () => {
    const clear = evaluateAbTest({ exposures: 1000, clicks: 100, conversions: 3 }, { exposures: 1000, clicks: 150, conversions: 5 });
    expect(clear.verdict).toBe("winner");
    expect(clear.winner).toBe("b");
    expect(clear.pValue!).toBeGreaterThan(0.0003);
    expect(clear.pValue!).toBeLessThan(0.0012);
    expect(clear.liftB).toBeCloseTo(0.5, 5);

    const close = evaluateAbTest({ exposures: 1000, clicks: 100, conversions: 0 }, { exposures: 1000, clicks: 110, conversions: 0 });
    expect(close.verdict).toBe("no_clear_difference");
    expect(close.pValue!).toBeGreaterThan(0.44);
    expect(close.pValue!).toBeLessThan(0.49);

    const aWins = evaluateAbTest({ exposures: 1000, clicks: 150, conversions: 0 }, { exposures: 1000, clicks: 100, conversions: 0 });
    expect(aWins.winner).toBe("a");
  });

  it("los clics repetidos se acotan a las exposiciones y las métricas tienen forma estable", () => {
    const result = evaluateAbTest({ exposures: 300, clicks: 900, conversions: 0 }, { exposures: 300, clicks: 30, conversions: 0 });
    expect(result.rateA).toBe(1);
    expect(abMetricKey("page_view", "t1", "b")).toBe("ab:page_view:t1:b");
  });
});
