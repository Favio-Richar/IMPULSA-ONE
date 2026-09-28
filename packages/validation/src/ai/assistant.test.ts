import { describe, expect, it } from "vitest";
import { BLOCK_CATALOG, type BlockType } from "../blocks/catalog.js";
import {
  AI_COPY_PATHS,
  AI_TRANSLATE_PATHS,
  aiBlockCopyRequestSchema,
  aiTranslateRequestSchema,
  copyFieldsFor,
  readTextFields,
  seoProposalsSchema,
  textProposalsSchema,
  translateFieldsFor,
  writeTextFields,
} from "./assistant.js";

const ID = "11111111-1111-4111-8111-111111111111";

describe("asistente de textos (F6.3)", () => {
  it("el perfil ofrece reescribir el subtítulo aunque todavía no exista, nunca el nombre", () => {
    const fields = copyFieldsFor("profile", { name: "Ana Pérez" });
    expect(fields.map((field) => field.key)).toEqual(["headline"]);
    expect(readTextFields({ name: "Ana Pérez" }, fields)).toEqual({ headline: "" });
  });

  it("el texto del botón de un hero solo se ofrece si el hero tiene botón", () => {
    expect(copyFieldsFor("hero", { title: "Hola" }).map((field) => field.key)).toEqual(["title", "subtitle"]);
    const withCta = { title: "Hola", cta: { label: "Ver", url: "https://ejemplo.cl" } };
    expect(copyFieldsFor("hero", withCta).map((field) => field.key)).toEqual(["title", "subtitle", "cta.label"]);
  });

  it("un bloque sin textos de venta no admite propuestas", () => {
    expect(copyFieldsFor("divider", { style: "line" })).toEqual([]);
    expect(copyFieldsFor("faq", { items: [{ question: "¿?", answer: "Sí" }] })).toEqual([]);
    expect(copyFieldsFor("no_existe", {})).toEqual([]);
  });

  it("la traducción expande las listas con índices y omite lo vacío", () => {
    const config = { title: "Preguntas", items: [{ question: "¿Horario?", answer: "<p>De 9 a 18</p>" }, { question: "¿Envíos?", answer: "" }] };
    const fields = translateFieldsFor("faq", config);
    expect(fields.map((field) => [field.key, field.label, field.rich])).toEqual([
      ["title", "Título", false],
      ["items.0.question", "Pregunta 1", false],
      ["items.1.question", "Pregunta 2", false],
      ["items.0.answer", "Respuesta 1", true],
    ]);
  });

  it("escribir textos no crea botones, imágenes ni ítems nuevos y no toca el original", () => {
    const config = { title: "Hola", items: [{ question: "a", answer: "b" }] };
    const written = writeTextFields(config, { title: "Hello", "cta.label": "Go", "items.0.question": "A", "items.5.question": "X", "items.0": "roto" });
    expect(written).toEqual({ title: "Hello", items: [{ question: "A", answer: "b" }] });
    expect(config.title).toBe("Hola");
  });

  it("la salida del modelo exige todos los campos, respeta el largo y rechaza claves extra", () => {
    const fields = copyFieldsFor("link", { label: "Ver", url: "https://ejemplo.cl" });
    const schema = textProposalsSchema(fields, 3);
    expect(schema.safeParse({ proposals: [{ values: { label: "Reserva hoy", description: "Cupos limitados" } }] }).success).toBe(true);
    expect(schema.safeParse({ proposals: [{ values: { label: "a".repeat(81), description: "x" } }] }).success).toBe(false);
    expect(schema.safeParse({ proposals: [{ values: { label: "Ok", description: "x", url: "javascript:alert(1)" } }] }).success).toBe(false);
    expect(schema.safeParse({ proposals: [] }).success).toBe(false);
    expect(schema.safeParse({ proposals: Array(4).fill({ values: { label: "a", description: "b" } }) }).success).toBe(false);
  });

  it("las propuestas de SEO respetan los largos del SEO de la página", () => {
    expect(seoProposalsSchema.safeParse({ proposals: [{ title: "a".repeat(71), description: "b" }] }).success).toBe(false);
    expect(seoProposalsSchema.safeParse({ proposals: [{ title: "Panadería", description: "Pan de masa madre." }] }).success).toBe(true);
  });

  it("los pedidos validan el bloque, el idioma cerrado y el largo de la indicación", () => {
    expect(aiBlockCopyRequestSchema.safeParse({ blockId: ID, instructions: "más formal" }).success).toBe(true);
    expect(aiBlockCopyRequestSchema.safeParse({ blockId: ID, instructions: "a".repeat(301) }).success).toBe(false);
    expect(aiTranslateRequestSchema.safeParse({ blockId: ID, locale: "en" }).success).toBe(true);
    expect(aiTranslateRequestSchema.safeParse({ blockId: ID, locale: "klingon" }).success).toBe(false);
  });

  it("las rutas marcadas como texto enriquecido son exactamente las del catálogo (van al sanitizador)", () => {
    for (const [type, paths] of [...Object.entries(AI_COPY_PATHS), ...Object.entries(AI_TRANSLATE_PATHS)]) {
      const definition = BLOCK_CATALOG[type as BlockType];
      for (const declared of paths ?? []) {
        expect(definition.richTextPaths.includes(declared.path), `${type}.${declared.path}`).toBe(declared.rich === true);
      }
    }
  });

  it("una propuesta aplicada sigue cumpliendo el esquema del bloque", () => {
    const config = { label: "Reservar hora" };
    const values = { label: "Agenda tu evaluación gratis" };
    expect(BLOCK_CATALOG.booking.schema.safeParse(writeTextFields(config, values)).success).toBe(true);
  });
});
