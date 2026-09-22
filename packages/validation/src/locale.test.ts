import { describe, expect, it } from "vitest";
import { z } from "zod";
import "./index.js";

// `z.config(es())` vive como efecto de módulo en `index.ts`: es global al proceso y no lo exporta
// nada, así que nada más que una prueba puede detectar que alguien lo borre o que un consumidor
// termine resolviendo otra copia de Zod. Sin esto, los errores sin mensaje propio (los que no
// escribe a mano `.superRefine`) vuelven a salir en inglés y se mezclan con el resto de la interfaz.
describe("localización de Zod", () => {
  it("emite en español los errores que Zod genera por defecto", () => {
    const cases = [
      z.string().min(3).safeParse("a"),
      z.string().max(2).safeParse("abcd"),
      z.enum(["a", "b"]).safeParse("c"),
      z.object({ nombre: z.string() }).safeParse({}),
      z.number().safeParse("no es número"),
      z.string().email().safeParse("no-es-correo"),
    ];

    for (const result of cases) {
      expect(result.success).toBe(false);
      const message = result.error!.issues[0]!.message;
      expect(message).not.toMatch(/^(Too |Invalid input: expected|Required|Unrecognized)/);
      expect(message).toMatch(/[áéíóúñ¿]|Demasiado|Entrada inválida|Número|Texto|inválid/i);
    }
  });

  it("no pisa los mensajes escritos a mano en los esquemas del proyecto", async () => {
    const { slugSchema } = await import("./slug.js");
    const result = slugSchema.safeParse("Mi Sitio");

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain("minúsculas");
  });
});
