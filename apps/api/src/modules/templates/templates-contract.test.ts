import { describe, expect, it } from "vitest";
import { templateIndustry, templateObjective, templateResponse } from "@impulza/contracts";
import { TEMPLATE_CATALOG, TEMPLATE_INDUSTRIES, TEMPLATE_OBJECTIVES } from "@impulza/validation";

// `@impulza/contracts` no depende de `@impulza/validation` y repite las listas cerradas de rubros y
// objetivos. Si una se actualiza sin la otra, la API responde algo que el contrato no acepta: el
// `next build` de la web pública y la galería del panel fallan con un ZodError (F8.4 agregó el rubro
// `educacion` solo en validación y rompió ambos). Este test es el único lugar que ve las dos a la vez.

describe("el contrato de plantillas coincide con la fuente de verdad (validación)", () => {
  it("rubros: mismas opciones", () => {
    expect([...templateIndustry.options].sort()).toEqual([...TEMPLATE_INDUSTRIES].sort());
  });

  it("objetivos: mismas opciones", () => {
    expect([...templateObjective.options].sort()).toEqual([...TEMPLATE_OBJECTIVES].sort());
  });

  it("toda plantilla del catálogo usa rubros y objetivos que el contrato acepta", () => {
    for (const template of TEMPLATE_CATALOG) {
      expect(() => templateIndustry.array().parse(template.industryTags), template.code).not.toThrow();
      expect(() => templateObjective.array().parse(template.objectiveTags), template.code).not.toThrow();
    }
    // Y la forma de la respuesta existe (por si el contrato deja de exportarla).
    expect(templateResponse).toBeDefined();
  });
});
