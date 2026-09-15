import { describe, expect, it } from "vitest";
import { isReservedSlug, publicSlugSchema, RESERVED_SLUGS, slugSchema } from "./slug.js";

describe("slugSchema", () => {
  it("acepta slugs válidos", () => {
    for (const valid of ["mi-sitio", "abc", "estudio-juridico-2026", "a1-b2-c3"]) {
      expect(slugSchema.safeParse(valid).success).toBe(true);
    }
  });

  it("rechaza formatos inválidos", () => {
    const invalid = [
      "ab", // muy corto
      "MiSitio", // mayúsculas
      "-empieza-con-guion",
      "termina-con-guion-",
      "doble--guion",
      "con espacio",
      "con_guion_bajo",
      "acentué",
      "emoji-🚀",
      "a".repeat(64), // muy largo
    ];

    for (const value of invalid) {
      expect(slugSchema.safeParse(value).success, `debería rechazar: ${value}`).toBe(false);
    }
  });
});

describe("slugs reservados", () => {
  it("isReservedSlug no distingue mayúsculas", () => {
    expect(isReservedSlug("admin")).toBe(true);
    expect(isReservedSlug("ADMIN")).toBe(true);
    expect(isReservedSlug("Admin")).toBe(true);
  });

  it("cubre infraestructura, superficies de la plataforma y archivos especiales", () => {
    for (const reserved of ["www", "api", "admin", "panel", "checkout", "sitemap", "robots", "health"]) {
      expect(isReservedSlug(reserved), `${reserved} debería estar reservado`).toBe(true);
    }
  });

  it("no reserva nombres legítimos de usuario", () => {
    for (const free of ["mi-negocio", "cafe-luna", "dra-perez", "taller-madera"]) {
      expect(isReservedSlug(free), `${free} no debería estar reservado`).toBe(false);
    }
  });

  it("todo slug reservado cumple el propio formato (si no, nunca podría colisionar y sobra)", () => {
    for (const reserved of RESERVED_SLUGS) {
      // Los de menos de 3 caracteres son inalcanzables por el mínimo del schema: se listan igual
      // para que quede explícito, pero no deben poder "colarse" por otra vía.
      if (reserved.length >= 3) {
        expect(slugSchema.safeParse(reserved).success, `reservado con formato inválido: ${reserved}`).toBe(true);
      }
    }
  });
});

describe("publicSlugSchema", () => {
  it("rechaza un slug con formato válido pero reservado", () => {
    const result = publicSlugSchema.safeParse("admin");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("reservado");
  });

  it("acepta un slug válido y no reservado", () => {
    expect(publicSlugSchema.safeParse("mi-sitio").success).toBe(true);
  });
});
