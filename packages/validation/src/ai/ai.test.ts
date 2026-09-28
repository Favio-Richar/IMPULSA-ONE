import { describe, expect, it } from "vitest";
import { aiBaseUrlSchema, aiRoutesSchema, createAiConnectionSchema, formatMicroUsd, updateAiConnectionSchema } from "./index.js";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

describe("conexiones de IA (F6.2b)", () => {
  it("la URL acepta un servidor propio por http en red privada, sin barra final", () => {
    expect(aiBaseUrlSchema.parse("http://10.0.0.5:11434/v1/")).toBe("http://10.0.0.5:11434/v1");
    expect(aiBaseUrlSchema.parse("https://api.openai.com/v1")).toBe("https://api.openai.com/v1");
  });

  it("la URL rechaza credenciales, parámetros, fragmentos y esquemas que no son http(s)", () => {
    for (const url of ["http://user:pass@ia.local/v1", "http://ia.local/v1?key=x", "http://ia.local/v1#x", "file:///etc/passwd", "javascript:alert(1)", "no es url"]) {
      expect(aiBaseUrlSchema.safeParse(url).success).toBe(false);
    }
  });

  it("crear aplica valores por defecto y exige URL solo para las compatibles con OpenAI", () => {
    const local = createAiConnectionSchema.parse({ name: "Servidor propio", kind: "OPENAI_COMPATIBLE", baseUrl: "http://ia.local:11434/v1", model: "qwen2.5:14b" });
    expect(local).toMatchObject({ jsonMode: "json_schema", timeoutMs: 30_000, inputMicroUsdPerMTok: 0, enabled: true, apiKey: null });
    expect(createAiConnectionSchema.safeParse({ name: "Sin URL", kind: "OPENAI_COMPATIBLE", model: "x" }).success).toBe(false);
    expect(createAiConnectionSchema.safeParse({ name: "Claude", kind: "ANTHROPIC", model: "claude-opus-5", apiKey: "sk-ant-x" }).success).toBe(true);
  });

  it("el timeout y los precios tienen rango; editar exige al menos un campo y permite quitar el token", () => {
    expect(createAiConnectionSchema.safeParse({ name: "X", kind: "ANTHROPIC", model: "m", timeoutMs: 500 }).success).toBe(false);
    expect(createAiConnectionSchema.safeParse({ name: "XY", kind: "ANTHROPIC", model: "m", inputMicroUsdPerMTok: -1 }).success).toBe(false);
    expect(updateAiConnectionSchema.safeParse({}).success).toBe(false);
    expect(updateAiConnectionSchema.parse({ apiKey: null })).toEqual({ apiKey: null });
  });

  it("las rutas cubren las cuatro tareas, sin repetir una conexión en la misma tarea", () => {
    const routes = { short_copy: [ID_A, ID_B], seo: [ID_A], translate: [], insights: [ID_B] };
    expect(aiRoutesSchema.parse({ routes }).routes.short_copy).toEqual([ID_A, ID_B]);
    expect(aiRoutesSchema.safeParse({ routes: { ...routes, seo: [ID_A, ID_A] } }).success).toBe(false);
    expect(aiRoutesSchema.safeParse({ routes: { short_copy: [ID_A] } }).success).toBe(false);
  });

  it("el precio se muestra en dólares", () => {
    expect(formatMicroUsd(3_000_000)).toBe("US$ 3,00");
    expect(formatMicroUsd(0)).toBe("US$ 0,00");
  });
});
