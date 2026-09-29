import type { AbTestResultsResponse } from "@impulza/contracts";
import { ApiError } from "./api-client";

/**
 * Mensaje de un error al empezar, terminar o aplicar una prueba A/B (F6.5), por estado y código,
 * nunca interpretando el texto. El 402 (límite del plan) lo muestra `PlanLimitNotice`.
 */
export function abTestErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) {
    return error ? "No pudimos conectar. Revisa tu conexión e intenta de nuevo." : null;
  }
  const code = (error.body as { code?: unknown } | undefined)?.code;
  if (error.status === 402) {
    return null;
  }
  if (error.status === 409 || code === "AB_TEST_ALREADY_RUNNING") {
    return "Este botón ya tiene una prueba en curso. Termínala para empezar otra.";
  }
  if (code === "AB_BLOCK_NOT_PUBLISHED") {
    return "Publica la página con este bloque antes de probarlo: la variante A es lo que ya ven tus visitantes.";
  }
  if (code === "AB_BLOCK_NOT_SUPPORTED") {
    return "Solo se pueden probar botones de acción o el encabezado de perfil.";
  }
  if (code === "AB_VARIANT_INVALID") {
    const message = (error.body as { message?: unknown } | undefined)?.message;
    return typeof message === "string" ? message : "Revisa la variante B.";
  }
  if (error.status === 403) {
    return "Tu rol no permite cambiar las pruebas de este sitio.";
  }
  return "Algo salió mal. Intenta de nuevo.";
}

const PERCENT = new Intl.NumberFormat("es-CL", { style: "percent", maximumFractionDigits: 1 });

export function formatRate(rate: number | null): string {
  return rate === null ? "—" : PERCENT.format(rate);
}

/** Lectura en una frase del veredicto, para el panel. */
export function verdictSummary(results: AbTestResultsResponse): { tone: "neutral" | "info" | "success"; title: string; detail: string } {
  if (results.verdict === "winner" && results.winner) {
    const lift = results.liftB === null ? null : results.winner === "b" ? results.liftB : -results.liftB / (1 + results.liftB);
    return {
      tone: "success",
      title: `Gana la variante ${results.winner.toUpperCase()}`,
      detail: `${lift === null ? "Más" : `${PERCENT.format(Math.abs(lift))} más`} clics por visita, con 95 % de confianza. Aplícala cuando quieras.`,
    };
  }
  if (results.verdict === "no_clear_difference") {
    return {
      tone: "info",
      title: "Sin diferencia clara",
      detail: "Con la muestra reunida, las dos variantes rinden parecido. Puedes seguir midiendo o quedarte con la que prefieras.",
    };
  }
  const missingExposures = Math.max(0, results.minimum.exposuresPerVariant - Math.min(results.a.exposures, results.b.exposures));
  const missingClicks = Math.max(0, results.minimum.totalClicks - (Math.min(results.a.clicks, results.a.exposures) + Math.min(results.b.clicks, results.b.exposures)));
  const parts = [
    missingExposures > 0 ? `${missingExposures} visitas más por variante` : null,
    missingClicks > 0 ? `${missingClicks} clics más en total` : null,
  ].filter(Boolean);
  return {
    tone: "neutral",
    title: "Sin resultado todavía",
    detail: parts.length > 0 ? `Faltan al menos ${parts.join(" y ")} para decidir sin adivinar.` : "Reuniendo datos para decidir.",
  };
}
