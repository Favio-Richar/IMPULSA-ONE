import { z } from "zod";
import { plainTextSchema } from "../blocks/primitives.js";

// Pruebas A/B (F6.5, ADR-011). Isomorfo: la API valida y calcula resultados con esto, y `apps/web`
// asigna la variante con la misma función que usa la API al contar — así lo que el visitante ve y
// lo que se mide nunca pueden discrepar.

// --- Qué se puede probar -------------------------------------------------------------------------

/**
 * Campos que la variante B puede cambiar, por tipo de bloque. Solo texto y estilo de la acción, o el
 * subtítulo del encabezado de perfil (criterio de F6.5): nunca la URL, el teléfono ni a qué
 * servicio o producto lleva — la prueba compara cómo se presenta la acción, no adónde va.
 */
const labelField = (max: number) => plainTextSchema(max);

export const AB_TEST_FIELD_SCHEMAS = {
  link: { label: labelField(80), description: labelField(160), style: z.enum(["primary", "secondary", "outline"]) },
  whatsapp: { label: labelField(60) },
  booking: { label: labelField(80) },
  catalog: { label: labelField(80) },
  profile: { headline: labelField(160) },
} as const;

export type AbTestBlockType = keyof typeof AB_TEST_FIELD_SCHEMAS;
export const AB_TEST_BLOCK_TYPES = Object.keys(AB_TEST_FIELD_SCHEMAS) as AbTestBlockType[];

export const AB_TEST_FIELD_LABELS: Record<string, string> = {
  label: "Texto del botón",
  description: "Descripción",
  style: "Estilo",
  headline: "Subtítulo",
};

export function isAbTestBlockType(type: string): type is AbTestBlockType {
  return Object.hasOwn(AB_TEST_FIELD_SCHEMAS, type);
}

/** Esquema de la variante B de un tipo: cambios parciales, al menos uno, sin claves ajenas. */
export function abVariantSchema(type: AbTestBlockType) {
  return z
    .object(AB_TEST_FIELD_SCHEMAS[type])
    .partial()
    .strict()
    .refine((value) => Object.keys(value).length > 0, { message: "La variante B debe cambiar al menos un campo." });
}

/** Configuración que ve quien cae en B: la de A con los cambios de B encima (todos de primer nivel). */
export function applyAbVariant(config: unknown, variantB: Record<string, unknown>): Record<string, unknown> {
  const base = typeof config === "object" && config !== null && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  return { ...base, ...variantB };
}

export const createAbTestSchema = z.object({
  blockId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  /** Se valida con `abVariantSchema(tipo del bloque)` en el servidor, que conoce el tipo. */
  variantB: z.record(z.string(), z.unknown()),
});
export type CreateAbTestInput = z.infer<typeof createAbTestSchema>;

export const applyAbWinnerSchema = z.object({ variant: z.enum(["a", "b"]) });

// --- Asignación ------------------------------------------------------------------------------------

/**
 * Grupos de visitantes. La cookie propia del sitio guarda solo un número de 0 a 99 elegido al azar:
 * lo comparten cientos de personas, así que no identifica a nadie (ADR-004), y es estable entre
 * días, a diferencia del visitante anonimizado que rota a diario.
 */
export const AB_BUCKET_COUNT = 100;
export const AB_BUCKET_COOKIE = "imp_ab";

export function parseAbBucket(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,2}$/.test(value)) {
    return null;
  }
  const bucket = Number(value);
  return bucket < AB_BUCKET_COUNT ? bucket : null;
}

/** FNV-1a de 32 bits: estable y sin dependencias, suficiente para decorrelacionar pruebas. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Variante de un grupo en una prueba. Exactamente la mitad de los grupos cae en cada variante (el
 * desplazamiento por prueba solo decide qué mitad), y dos pruebas distintas no reparten igual.
 */
export function abVariantFor(testKey: string, bucket: number): "a" | "b" {
  return (bucket + (fnv1a(testKey) % 2)) % 2 === 0 ? "a" : "b";
}

// --- Resultados ------------------------------------------------------------------------------------

/**
 * Muestra mínima para recomendar un ganador: exposiciones por variante y clics en total. Con menos,
 * una diferencia grande puede ser azar. Criterio documentado en ADR-011.
 */
export const AB_MIN_EXPOSURES_PER_VARIANT = 200;
export const AB_MIN_TOTAL_CLICKS = 30;
/** Nivel de significación de la prueba (dos colas). */
export const AB_SIGNIFICANCE = 0.05;

export interface AbVariantCounts {
  exposures: number;
  clicks: number;
  conversions: number;
}

export type AbVerdict = "insufficient_sample" | "no_clear_difference" | "winner";

export interface AbEvaluation {
  verdict: AbVerdict;
  winner: "a" | "b" | null;
  /** Clics por exposición de cada variante (0–1), o `null` sin exposiciones. */
  rateA: number | null;
  rateB: number | null;
  /** Cambio relativo de B sobre A (0.25 = +25 %), o `null` si A no tiene base. */
  liftB: number | null;
  /** Valor p de la prueba de dos proporciones, o `null` si no hay muestra para calcularlo. */
  pValue: number | null;
}

/** Φ(x) con la aproximación de Abramowitz–Stegun 7.1.26 (error < 1,5·10⁻⁷). */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * Prueba z de dos proporciones (clics sobre exposiciones), dos colas. Un visitante puede hacer más
 * de un clic: los clics se acotan a las exposiciones para que la proporción tenga sentido.
 * Solo hay ganador con muestra suficiente **y** p < 0,05; con muestra y sin significación, "sin
 * diferencia clara"; sin muestra, "sin resultado todavía".
 */
export function evaluateAbTest(a: AbVariantCounts, b: AbVariantCounts): AbEvaluation {
  const clicksA = Math.min(a.clicks, a.exposures);
  const clicksB = Math.min(b.clicks, b.exposures);
  const rateA = a.exposures > 0 ? clicksA / a.exposures : null;
  const rateB = b.exposures > 0 ? clicksB / b.exposures : null;
  const liftB = rateA !== null && rateB !== null && rateA > 0 ? (rateB - rateA) / rateA : null;

  const enough = a.exposures >= AB_MIN_EXPOSURES_PER_VARIANT && b.exposures >= AB_MIN_EXPOSURES_PER_VARIANT && clicksA + clicksB >= AB_MIN_TOTAL_CLICKS;
  if (!enough || rateA === null || rateB === null) {
    return { verdict: "insufficient_sample", winner: null, rateA, rateB, liftB, pValue: null };
  }

  const pooled = (clicksA + clicksB) / (a.exposures + b.exposures);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / a.exposures + 1 / b.exposures));
  const pValue = standardError === 0 ? 1 : 2 * (1 - normalCdf(Math.abs(rateB - rateA) / standardError));
  if (pValue >= AB_SIGNIFICANCE) {
    return { verdict: "no_clear_difference", winner: null, rateA, rateB, liftB, pValue };
  }
  return { verdict: "winner", winner: rateB > rateA ? "b" : "a", rateA, rateB, liftB, pValue };
}

/** Métricas de agregado de una prueba (`AnalyticsAggregate.metric`): `ab:<evento>:<id>:<a|b>`. */
export function abMetricKey(eventType: string, testId: string, variant: "a" | "b"): string {
  return `ab:${eventType}:${testId}:${variant}`;
}

/** Eventos que cuentan como exposición, clic y conversión de una prueba. */
export const AB_EXPOSURE_EVENTS = ["page_view"] as const;
export const AB_CLICK_EVENTS = ["block_click", "whatsapp_click"] as const;
export const AB_CONVERSION_EVENTS = ["form_submit", "booking_created", "order_created"] as const;
