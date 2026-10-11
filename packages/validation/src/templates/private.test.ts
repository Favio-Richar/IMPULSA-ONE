import { describe, expect, it } from "vitest";
import { templateCodeSchema } from "./index.js";
import { createPrivateTemplateSchema, isPrivateTemplateCode, privateTemplateCode, stripOrganizationReferences } from "./private.js";

const UUID = "5b0d7a3e-8f5a-4f0e-9d3a-2d6a9a1c7e11";

describe("createPrivateTemplateSchema", () => {
  it("acepta lo mínimo y marca la apariencia por defecto", () => {
    const parsed = createPrivateTemplateSchema.parse({ name: " Landing de taller ", description: "Una página de taller con reservas", siteId: UUID, pageId: UUID });
    expect(parsed).toMatchObject({ name: "Landing de taller", includeAppearance: true });
  });

  it("rechaza nombres y descripciones fuera de rango y ids que no son UUID", () => {
    expect(createPrivateTemplateSchema.safeParse({ name: "A", description: "Descripción suficiente", siteId: UUID, pageId: UUID }).success).toBe(false);
    expect(createPrivateTemplateSchema.safeParse({ name: "Bien", description: "corta", siteId: UUID, pageId: UUID }).success).toBe(false);
    expect(createPrivateTemplateSchema.safeParse({ name: "Bien", description: "Descripción suficiente", siteId: "x", pageId: UUID }).success).toBe(false);
    expect(createPrivateTemplateSchema.safeParse({ name: "x".repeat(81), description: "Descripción suficiente", siteId: UUID, pageId: UUID }).success).toBe(false);
  });
});

describe("stripOrganizationReferences", () => {
  it("anula el formulario y quita servicios, productos y categoría, sin tocar el resto", () => {
    const input = { title: "Reserva", formId: UUID, serviceIds: [UUID], productIds: [UUID], categoryId: UUID, layout: "grid" };
    const output = stripOrganizationReferences(input) as Record<string, unknown>;
    expect(output).toEqual({ title: "Reserva", formId: null, layout: "grid" });
    // No muta la entrada.
    expect(input.serviceIds).toEqual([UUID]);
  });

  it("deja igual lo que no es un objeto de configuración", () => {
    expect(stripOrganizationReferences(null)).toBeNull();
    expect(stripOrganizationReferences("texto")).toBe("texto");
    expect(stripOrganizationReferences([1, 2])).toEqual([1, 2]);
    expect(stripOrganizationReferences({ html: "<p>Hola</p>" })).toEqual({ html: "<p>Hola</p>" });
  });
});

describe("privateTemplateCode", () => {
  it("siempre cumple el esquema de códigos y es reconocible", () => {
    const code = privateTemplateCode(UUID, "Café & Té — Edición 2026 ñandú", "AB12cd!!");
    expect(templateCodeSchema.safeParse(code).success).toBe(true);
    expect(code).toBe("p-5b0d7a3e-cafe-te-edicion-2026-nandu-ab12cd");
    expect(isPrivateTemplateCode(code)).toBe(true);
  });

  it("un nombre sin letras ni números cae a «plantilla» y el código nunca pasa de 60", () => {
    expect(privateTemplateCode(UUID, "!!!", "zz")).toBe("p-5b0d7a3e-plantilla-zz");
    expect(privateTemplateCode(UUID, "a".repeat(200), "abcdef").length).toBeLessThanOrEqual(60);
  });

  it("los códigos del catálogo no se confunden con los privados", () => {
    expect(isPrivateTemplateCode("profesional-servicios")).toBe(false);
    expect(isPrivateTemplateCode("p-roducto-bonito")).toBe(false);
  });
});
