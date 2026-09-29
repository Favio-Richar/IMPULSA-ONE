import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Pruebas A/B (F6.5, ADR-011). Los conteos vienen de agregados sin datos personales; el veredicto
// lo calcula el servidor con `evaluateAbTest` (`@impulza/validation`).

const variantCounts = z.object({
  exposures: z.number().int(),
  clicks: z.number().int(),
  conversions: z.number().int(),
});

export const abTestResultsResponse = z.object({
  a: variantCounts,
  b: variantCounts,
  /** `insufficient_sample`: sin resultado todavía; `no_clear_difference`: con muestra, sin ganador. */
  verdict: z.enum(["insufficient_sample", "no_clear_difference", "winner"]),
  winner: z.enum(["a", "b"]).nullable(),
  rateA: z.number().nullable(),
  rateB: z.number().nullable(),
  liftB: z.number().nullable(),
  pValue: z.number().nullable(),
  /** Muestra mínima usada para decidir (para explicarla en el panel). */
  minimum: z.object({ exposuresPerVariant: z.number().int(), totalClicks: z.number().int() }),
});

export const abTestResponse = z.object({
  id: uuid,
  siteId: uuid,
  pageId: uuid,
  blockId: uuid,
  blockType: z.string(),
  name: z.string(),
  status: z.enum(["RUNNING", "ENDED"]),
  /** Configuración publicada del bloque al empezar la prueba: lo que ven quienes caen en A. */
  variantA: z.record(z.string(), z.unknown()),
  /** Solo los campos que cambia B. */
  variantB: z.record(z.string(), z.unknown()),
  appliedVariant: z.enum(["a", "b"]).nullable(),
  startedAt: isoDateTime,
  endedAt: isoDateTime.nullable(),
  results: abTestResultsResponse,
});

export type AbTestResultsResponse = z.infer<typeof abTestResultsResponse>;
export type AbTestResponse = z.infer<typeof abTestResponse>;
