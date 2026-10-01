import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Cupones de descuento (F7.8b, ADR-023). Listas cerradas repetidas acá porque este paquete no
// depende de `@impulza/validation`; las pruebas e2e parsean respuestas reales contra estos esquemas.

export const couponResponse = z.object({
  id: uuid,
  siteId: uuid,
  code: z.string(),
  description: z.string().nullable(),
  kind: z.enum(["percent", "fixed"]),
  percentOff: z.number().int().nullable(),
  amountOff: z.number().int().nullable(),
  currency: z.string().nullable(),
  minSubtotal: z.number().int().nullable(),
  startsAt: isoDateTime.nullable(),
  endsAt: isoDateTime.nullable(),
  maxRedemptions: z.number().int().nullable(),
  /** Pedidos que lo usaron (cancelar un pedido no devuelve el uso). */
  redemptionCount: z.number().int(),
  active: z.boolean(),
  /** Calculado con la hora del servidor. */
  status: z.enum(["active", "scheduled", "expired", "exhausted", "paused"]),
  /** Descuento entregado en pedidos no cancelados, por moneda. */
  discountGiven: z.array(z.object({ currency: z.string(), amount: z.number().int() })),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type CouponResponse = z.infer<typeof couponResponse>;

/** Lo que ve el visitante al probar un código: el descuento calculado por el servidor. */
export const publicCouponCheckResponse = z.object({
  code: z.string(),
  subtotalAmount: z.number().int(),
  discountAmount: z.number().int(),
  totalAmount: z.number().int(),
  priceCurrency: z.string(),
});
export type PublicCouponCheckResponse = z.infer<typeof publicCouponCheckResponse>;
