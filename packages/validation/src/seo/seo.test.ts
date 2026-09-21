import { describe, expect, it } from "vitest";
import { seoMetaSchema, SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from "./index.js";

describe("SEO de página (F2.8)", () => {
  it("un objeto vacío es válido: todo es opcional, el render deriva los valores por defecto", () => {
    expect(seoMetaSchema.parse({})).toEqual({});
  });

  it("acepta título, descripción, canonical, robots y Open Graph completos", () => {
    const parsed = seoMetaSchema.parse({
      title: "Panadería El Buen Pan",
      description: "Pan artesanal todos los días, retiro en tienda o WhatsApp.",
      canonicalPageSlug: "inicio",
      robots: "index_follow",
      openGraph: { title: "El Buen Pan", description: "Pan artesanal.", image: "https://cdn.example.com/og.jpg" },
    });
    expect(parsed.canonicalPageSlug).toBe("inicio");
    expect(parsed.robots).toBe("index_follow");
  });

  it("canonicalPageSlug: null significa explícitamente 'esta misma página'", () => {
    expect(seoMetaSchema.parse({ canonicalPageSlug: null }).canonicalPageSlug).toBeNull();
  });

  it("rechaza un título o descripción más largos que el límite", () => {
    expect(() => seoMetaSchema.parse({ title: "a".repeat(SEO_TITLE_MAX + 1) })).toThrow();
    expect(() => seoMetaSchema.parse({ description: "a".repeat(SEO_DESCRIPTION_MAX + 1) })).toThrow();
  });

  it("rechaza un valor de robots fuera de las cuatro combinaciones cerradas", () => {
    expect(() => seoMetaSchema.parse({ robots: "index" })).toThrow();
  });

  it("Open Graph rechaza una imagen que no sea http/https (mismo criterio que las imágenes de bloque)", () => {
    expect(() => seoMetaSchema.parse({ openGraph: { image: "javascript:alert(1)" } })).toThrow();
  });

  it("canonicalPageSlug rechaza un valor con formato de slug inválido", () => {
    expect(() => seoMetaSchema.parse({ canonicalPageSlug: "No Es Un Slug" })).toThrow();
  });
});
