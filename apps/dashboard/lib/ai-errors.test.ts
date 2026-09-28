import { describe, expect, it, vi } from "vitest";

// `api-client` valida las variables públicas al importarse; acá basta con valores de ejemplo.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL ??= "http://localhost:4000/api/v1";
  process.env.NEXT_PUBLIC_WEB_BASE_URL ??= "http://localhost:3300";
});

import { aiErrorMessage, plainPreview } from "./ai-errors";
import { ApiError } from "./api-client";

describe("errores del asistente de IA (F6.3)", () => {
  it("cada estado del servidor tiene su mensaje, reconocido por código y no por el texto", () => {
    expect(aiErrorMessage(new ApiError(429, {}))).toMatch(/espera un minuto/i);
    expect(aiErrorMessage(new ApiError(503, { code: "AI_UNAVAILABLE" }))).toMatch(/no está disponible/i);
    expect(aiErrorMessage(new ApiError(502, { code: "AI_NO_USEFUL_PROPOSAL" }))).toMatch(/otra indicación/i);
    expect(aiErrorMessage(new ApiError(422, { code: "AI_CONTENT_TOO_LONG", message: "x" }))).toMatch(/demasiado texto/i);
    expect(aiErrorMessage(new ApiError(403, {}))).toMatch(/rol/i);
  });

  it("el 402 de cuota lo muestra el aviso de plan, y un error de red tiene su propio mensaje", () => {
    expect(aiErrorMessage(new ApiError(402, { code: "PLAN_LIMIT_REACHED" }))).toBeNull();
    expect(aiErrorMessage(new TypeError("Failed to fetch"))).toMatch(/conexión/i);
    expect(aiErrorMessage(null)).toBeNull();
  });

  it("la vista previa de un texto enriquecido es texto plano legible", () => {
    expect(plainPreview("<p>Hola&nbsp;<strong>mundo</strong></p><p>Segunda &amp; línea</p>")).toBe("Hola mundo Segunda & línea");
    expect(plainPreview('<p>Hola<script>alert(1)</script></p>')).not.toContain("<");
  });
});
