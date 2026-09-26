import { describe, expect, it } from "vitest";
import { templateBackgroundSchema, templateBlocksSeedSchema, templateSchema, type TemplateDefinition } from "./index.js";

// PL1 — una plantilla con un bloque inválido no puede guardarse: la validan los mismos esquemas de
// bloques que el constructor.

function validTemplate(overrides: Partial<TemplateDefinition> = {}): TemplateDefinition {
  return {
    code: "prueba-servicios",
    name: "Prueba de servicios",
    description: "Plantilla de prueba para un profesional independiente.",
    industryTags: ["profesional"],
    objectiveTags: ["captar"],
    themeCode: "claro-profesional",
    family: "clasico",
    background: null,
    previewImageUrl: null,
    sortOrder: 0,
    blocksSeed: [
      { type: "profile", configSchemaVersion: 1, config: { name: "Nombre de ejemplo", verified: false } },
      {
        type: "whatsapp",
        configSchemaVersion: 1,
        isPrimary: true,
        config: { phone: "+56900000000", label: "Escríbeme" },
      },
    ],
    ...overrides,
  };
}

function issuePaths(input: unknown): string[] {
  const result = templateSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("templateSchema", () => {
  it("acepta una plantilla completa y válida", () => {
    expect(templateSchema.safeParse(validTemplate()).success).toBe(true);
  });

  it("rechaza un tema que no está en el catálogo", () => {
    expect(issuePaths(validTemplate({ themeCode: "no-existe" }))).toContain("themeCode");
  });

  it("rechaza una línea que no coincide con la del tema", () => {
    expect(issuePaths(validTemplate({ themeCode: "oscuro-noche", family: "clasico" }))).toContain("family");
  });

  it("rechaza etiquetas fuera del catálogo, vacías o repetidas", () => {
    expect(issuePaths({ ...validTemplate(), industryTags: ["minería"] })).toContain("industryTags.0");
    expect(issuePaths(validTemplate({ objectiveTags: [] }))).toContain("objectiveTags");
    expect(issuePaths(validTemplate({ objectiveTags: ["captar", "captar"] }))).toContain("objectiveTags");
  });

  it("rechaza un código con mayúsculas o espacios", () => {
    expect(issuePaths(validTemplate({ code: "Mi Plantilla" }))).toContain("code");
  });

  it("solo acepta una vista previa https", () => {
    expect(issuePaths(validTemplate({ previewImageUrl: "http://example.com/a.png" }))).toContain("previewImageUrl");
    expect(issuePaths(validTemplate({ previewImageUrl: "javascript:alert(1)" }))).toContain("previewImageUrl");
    expect(templateSchema.safeParse(validTemplate({ previewImageUrl: "https://example.com/a.png" })).success).toBe(true);
  });
});

describe("templateBackgroundSchema", () => {
  it("acepta el fondo del tema, un degradado del catálogo o un color legible", () => {
    expect(templateBackgroundSchema.safeParse(null).success).toBe(true);
    expect(templateBackgroundSchema.safeParse({ kind: "gradient", gradient: "medianoche" }).success).toBe(true);
    expect(templateBackgroundSchema.safeParse({ kind: "color", color: "#ffffff" }).success).toBe(true);
  });

  it("rechaza foto y video: una plantilla no trae medios de nadie", () => {
    expect(
      templateBackgroundSchema.safeParse({
        kind: "image",
        image: { url: "https://example.com/foto.jpg" },
        overlay: { tone: "dark", strength: "strong" },
      }).success,
    ).toBe(false);
  });

  it("rechaza un degradado que no existe", () => {
    expect(templateBackgroundSchema.safeParse({ kind: "gradient", gradient: "arcoiris" }).success).toBe(false);
  });
});

describe("templateBlocksSeedSchema", () => {
  const profile = { type: "profile", configSchemaVersion: 1, config: { name: "Ejemplo" } };

  function paths(blocks: unknown): string[] {
    const result = templateBlocksSeedSchema.safeParse(blocks);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
  }

  it("rechaza una lista vacía", () => {
    expect(templateBlocksSeedSchema.safeParse([]).success).toBe(false);
  });

  it("rechaza un tipo de bloque desconocido", () => {
    expect(paths([profile, { type: "iframe", configSchemaVersion: 1, config: {} }])).toContain("1.type");
  });

  it("rechaza una versión de esquema distinta de la vigente", () => {
    expect(paths([{ ...profile, configSchemaVersion: 2 }])).toContain("0.configSchemaVersion");
  });

  it("rechaza una configuración inválida con la ruta exacta del campo", () => {
    expect(
      paths([profile, { type: "link", configSchemaVersion: 1, config: { label: "Ver", url: "javascript:alert(1)" } }]),
    ).toContain("1.config.url");
  });

  it("rechaza una imagen sin texto alternativo", () => {
    expect(
      paths([
        {
          type: "profile",
          configSchemaVersion: 1,
          config: { name: "Ejemplo", avatar: { url: "https://example.com/a.png", alt: "" } },
        },
      ]),
    ).toContain("0.config.avatar.alt");
  });

  it("rechaza un formulario que apunta a un formulario real", () => {
    expect(
      paths([
        profile,
        { type: "contact_form", configSchemaVersion: 2, config: { formId: "4f0b4d0e-7a8c-4b0e-9d7a-1f2e3d4c5b6a" } },
      ]),
    ).toContain("1.config.formId");
  });

  it("acepta a lo sumo una acción principal y solo en un bloque de acción", () => {
    const whatsapp = { type: "whatsapp", configSchemaVersion: 1, isPrimary: true, config: { phone: "+56900000000" } };
    const link = { type: "link", configSchemaVersion: 1, isPrimary: true, config: { label: "Ver", url: "https://example.com" } };

    expect(templateBlocksSeedSchema.safeParse([profile, whatsapp]).success).toBe(true);
    expect(templateBlocksSeedSchema.safeParse([profile, whatsapp, link]).success).toBe(false);
    expect(paths([{ ...profile, isPrimary: true }])).toContain("0.isPrimary");
  });
});
