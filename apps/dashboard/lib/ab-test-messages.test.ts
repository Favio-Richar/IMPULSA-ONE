import { describe, expect, it, vi } from "vitest";

// `api-client` valida las variables públicas al importarse; acá basta con valores de ejemplo.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL ??= "http://localhost:4000/api/v1";
  process.env.NEXT_PUBLIC_WEB_BASE_URL ??= "http://localhost:3300";
});

import { abTestErrorMessage, formatRate, verdictSummary } from "./ab-test-messages";
import { ApiError } from "./api-client";

const minimum = { exposuresPerVariant: 200, totalClicks: 30 };
const counts = (exposures: number, clicks: number) => ({ exposures, clicks, conversions: 0 });

describe("mensajes de pruebas A/B (F6.5)", () => {
  it("cada error tiene su mensaje por código, y el límite del plan queda para su aviso", () => {
    expect(abTestErrorMessage(new ApiError(409, { code: "AB_TEST_ALREADY_RUNNING" }))).toMatch(/ya tiene una prueba/);
    expect(abTestErrorMessage(new ApiError(422, { code: "AB_BLOCK_NOT_PUBLISHED" }))).toMatch(/Publica la página/);
    expect(abTestErrorMessage(new ApiError(422, { code: "AB_VARIANT_INVALID", message: "Igual a A" }))).toBe("Igual a A");
    expect(abTestErrorMessage(new ApiError(402, { code: "PLAN_LIMIT_REACHED" }))).toBeNull();
    expect(abTestErrorMessage(new ApiError(403, {}))).toMatch(/rol/);
  });

  it("sin muestra dice cuánto falta; con ganador, cuánto mejora; sin diferencia, lo dice", () => {
    const waiting = verdictSummary({ a: counts(50, 5), b: counts(80, 6), verdict: "insufficient_sample", winner: null, rateA: 0.1, rateB: 0.075, liftB: -0.25, pValue: null, minimum });
    expect(waiting).toMatchObject({ tone: "neutral", title: "Sin resultado todavía" });
    expect(waiting.detail).toContain("150 visitas más por variante");
    expect(waiting.detail).toContain("19 clics más");

    const winner = verdictSummary({ a: counts(1000, 100), b: counts(1000, 150), verdict: "winner", winner: "b", rateA: 0.1, rateB: 0.15, liftB: 0.5, pValue: 0.0007, minimum });
    expect(winner.title).toBe("Gana la variante B");
    expect(winner.detail).toContain("50");

    const aWins = verdictSummary({ a: counts(1000, 150), b: counts(1000, 100), verdict: "winner", winner: "a", rateA: 0.15, rateB: 0.1, liftB: -1 / 3, pValue: 0.0007, minimum });
    expect(aWins.detail).toContain("50");

    expect(verdictSummary({ a: counts(1000, 100), b: counts(1000, 110), verdict: "no_clear_difference", winner: null, rateA: 0.1, rateB: 0.11, liftB: 0.1, pValue: 0.46, minimum }).title).toBe("Sin diferencia clara");
    expect(formatRate(null)).toBe("—");
  });
});
