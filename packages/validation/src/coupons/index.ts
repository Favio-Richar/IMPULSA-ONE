import { z } from "zod";

// Cupones de descuento (F7.8b, ADR-023). Isomorfo: el panel valida mientras se escribe, la API vuelve
// a validar y además calcula el descuento — el navegador nunca decide cuánto se descuenta.

export const MAX_COUPONS_PER_SITE = 100;
export const COUPON_KINDS = ["percent", "fixed"] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

/** Único mensaje público para un código que no aplica (no revela si existe, venció o se agotó). */
export const COUPON_INVALID_MESSAGE = "Ese código no es válido.";

/** Código: mayúsculas, números, guion y guion bajo; se guarda y compara en mayúsculas. */
export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3, "Mínimo 3 caracteres.")
  .max(30, "Máximo 30 caracteres.")
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Usa letras, números, guion o guion bajo, sin espacios.");

const currencySchema = z.string().length(3).toUpperCase();
const instantSchema = z.iso.datetime({ offset: true });
const moneySchema = z.number().int().min(0).max(1_000_000_000);

/** Campos de un cupón ya combinados (al crear, o lo guardado más los cambios al editar). */
export interface CouponRules {
  kind: CouponKind;
  percentOff: number | null;
  amountOff: number | null;
  currency: string | null;
  minSubtotal: number | null;
  startsAt: string | Date | null;
  endsAt: string | Date | null;
  maxRedemptions: number | null;
}

/**
 * Coherencia del cupón (las mismas reglas que los `CHECK` de la base): un porcentaje lleva 1–100 y
 * ningún monto; un monto fijo lleva monto y moneda; un mínimo de compra lleva moneda; la ventana no
 * puede estar invertida. Devuelve el problema (con su campo) o `null`.
 */
export function couponRulesProblem(rules: CouponRules): { path: string; message: string } | null {
  if (rules.kind === "percent") {
    if (rules.percentOff === null || rules.percentOff < 1 || rules.percentOff > 100) return { path: "percentOff", message: "El porcentaje va de 1 a 100." };
  } else {
    if (rules.amountOff === null || rules.amountOff <= 0) return { path: "amountOff", message: "Escribe el monto del descuento." };
    if (rules.currency === null) return { path: "currency", message: "Elige la moneda del descuento." };
  }
  if (rules.minSubtotal !== null && rules.currency === null) return { path: "currency", message: "Elige la moneda del mínimo de compra." };
  if (rules.startsAt !== null && rules.endsAt !== null && new Date(rules.endsAt).getTime() <= new Date(rules.startsAt).getTime()) {
    return { path: "endsAt", message: "El fin tiene que ser después del inicio." };
  }
  return null;
}

const couponFields = {
  code: couponCodeSchema,
  description: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(COUPON_KINDS),
  percentOff: z.number().int().min(1).max(100).optional(),
  amountOff: moneySchema.min(1).optional(),
  currency: currencySchema.optional(),
  minSubtotal: moneySchema.optional(),
  startsAt: instantSchema.optional(),
  endsAt: instantSchema.optional(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).optional(),
  active: z.boolean().default(true),
};

export const createCouponSchema = z.object(couponFields).superRefine((value, ctx) => {
  const problem = couponRulesProblem({
    kind: value.kind,
    percentOff: value.percentOff ?? null,
    amountOff: value.amountOff ?? null,
    currency: value.currency ?? null,
    minSubtotal: value.minSubtotal ?? null,
    startsAt: value.startsAt ?? null,
    endsAt: value.endsAt ?? null,
    maxRedemptions: value.maxRedemptions ?? null,
  });
  if (problem) ctx.addIssue({ code: "custom", path: [problem.path], message: problem.message });
});
export type CreateCouponInput = z.infer<typeof createCouponSchema>;

/** Edición: cualquier subconjunto; `null` quita un opcional. La API combina y revalida las reglas. */
export const updateCouponSchema = z
  .object({
    code: couponCodeSchema,
    description: z.string().trim().min(1).max(120).nullable(),
    kind: z.enum(COUPON_KINDS),
    percentOff: z.number().int().min(1).max(100).nullable(),
    amountOff: moneySchema.min(1).nullable(),
    currency: currencySchema.nullable(),
    minSubtotal: moneySchema.nullable(),
    startsAt: instantSchema.nullable(),
    endsAt: instantSchema.nullable(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable(),
    active: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Envía al menos un campo a modificar." });
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;

/**
 * Descuento de un cupón sobre un subtotal (unidad mínima de la moneda), o `null` si no aplica por
 * moneda o por mínimo de compra. Porcentaje redondeado hacia abajo; un monto fijo nunca deja el total
 * bajo cero. La vigencia, el estado y los usos se revisan aparte (en la base, al pedir).
 */
export function computeCouponDiscount(
  coupon: Pick<CouponRules, "kind" | "percentOff" | "amountOff" | "currency" | "minSubtotal">,
  subtotal: number,
  orderCurrency: string,
): number | null {
  if (coupon.currency !== null && coupon.currency !== orderCurrency) return null;
  if (coupon.minSubtotal !== null && subtotal < coupon.minSubtotal) return null;
  if (subtotal <= 0) return null;
  if (coupon.kind === "percent") {
    return Math.floor((subtotal * (coupon.percentOff ?? 0)) / 100);
  }
  return Math.min(coupon.amountOff ?? 0, subtotal);
}

export const COUPON_STATUSES = ["active", "scheduled", "expired", "exhausted", "paused"] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

/** Estado de un cupón en un instante (para el panel; la API vuelve a revisar al pedir). */
export function couponStatus(
  coupon: { active: boolean; startsAt: string | Date | null; endsAt: string | Date | null; maxRedemptions: number | null; redemptionCount: number },
  now: Date = new Date(),
): CouponStatus {
  if (!coupon.active) return "paused";
  if (coupon.maxRedemptions !== null && coupon.redemptionCount >= coupon.maxRedemptions) return "exhausted";
  const at = now.getTime();
  if (coupon.endsAt !== null && at >= new Date(coupon.endsAt).getTime()) return "expired";
  if (coupon.startsAt !== null && at < new Date(coupon.startsAt).getTime()) return "scheduled";
  return "active";
}

/** El visitante prueba un código antes de pedir: con lo que pediría, para calcular el descuento. */
export const publicCouponCheckSchema = z.object({
  code: z.string().trim().min(1).max(60),
  productId: z.uuid(),
  variantId: z.uuid().optional(),
  quantity: z.number().int().min(1).max(99),
});
export type PublicCouponCheckInput = z.infer<typeof publicCouponCheckSchema>;
