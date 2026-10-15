import { describe, expect, it } from "vitest";
import {
  ONBOARDING_ACCOUNT_OPTION_KEYS,
  ONBOARDING_ACCOUNT_OPTIONS,
  ONBOARDING_ACCOUNT_TYPE_LABELS,
  ONBOARDING_ACCOUNT_TYPES,
  TEMPLATE_INDUSTRIES,
} from "./index.js";

// Paso 1 del onboarding: cada opción de "Tipo de cuenta" guarda un tipo de cuenta real y, si es un perfil concreto, un rubro real.

describe("ONBOARDING_ACCOUNT_OPTIONS", () => {
  it("las tres primeras son los tipos de cuenta originales, sin rubro y con su mismo texto", () => {
    expect(ONBOARDING_ACCOUNT_OPTION_KEYS.slice(0, 3)).toEqual([...ONBOARDING_ACCOUNT_TYPES]);
    for (const type of ONBOARDING_ACCOUNT_TYPES) {
      expect(ONBOARDING_ACCOUNT_OPTIONS[type]).toEqual({ ...ONBOARDING_ACCOUNT_TYPE_LABELS[type], accountType: type, industry: null });
    }
  });

  it("los perfiles nuevos guardan un tipo de cuenta existente y un rubro existente, sin repetir rubro", () => {
    const profiles = ONBOARDING_ACCOUNT_OPTION_KEYS.slice(3);
    expect(profiles).toHaveLength(9);
    const industries = profiles.map((key) => ONBOARDING_ACCOUNT_OPTIONS[key].industry);
    for (const [index, key] of profiles.entries()) {
      const option = ONBOARDING_ACCOUNT_OPTIONS[key];
      expect(ONBOARDING_ACCOUNT_TYPES, key).toContain(option.accountType);
      expect(TEMPLATE_INDUSTRIES, key).toContain(industries[index]);
    }
    expect(new Set(industries).size).toBe(industries.length);
  });

  it("asigna el tipo de cuenta esperado a cada perfil", () => {
    expect(ONBOARDING_ACCOUNT_OPTIONS["barberia-estetica"].accountType).toBe("negocio");
    for (const key of ["streaming", "tiktok-video-corto", "youtube", "contenido-suscripcion", "docencia", "fotografia-video", "musica-podcast", "fitness-coaching"] as const) {
      expect(ONBOARDING_ACCOUNT_OPTIONS[key].accountType, key).toBe("personal");
    }
  });
});
