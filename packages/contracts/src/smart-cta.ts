import { z } from "zod";

// Smart CTA (F6.6). La forma de cada condición vive en `smartCtaConditionSchema`
// (`@impulza/validation`); acá va suelta para no duplicar el catálogo en el contrato.

/** Reglas de una página tal como las edita el panel. */
export const smartCtaResponse = z.object({
  rules: z.array(z.object({ condition: z.record(z.string(), z.unknown()), blockId: z.uuid() })),
  /** Hay horario de atención (el de reservas): sin él, "fuera de horario" no se cumple nunca. */
  hoursConfigured: z.boolean(),
});

/** Estado de reservas para la regla "sin horas disponibles": sin detalle, solo si queda alguna. */
export const publicBookingAvailableResponse = z.object({ available: z.boolean() });

export type SmartCtaResponse = z.infer<typeof smartCtaResponse>;
export type PublicBookingAvailableResponse = z.infer<typeof publicBookingAvailableResponse>;
