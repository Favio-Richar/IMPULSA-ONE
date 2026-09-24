import { planLimitsSchema } from "@impulza/validation";
import { z } from "zod";

// Todo cambio hecho por un superadministrador lleva un motivo escrito (ADR-005 §6): queda en la
// auditoría y es lo primero que alguien pregunta al revisarla.
const reason = z.string().trim().min(5, "Explica el motivo (al menos 5 caracteres).").max(500);

export const changeOrganizationPlanSchema = z.object({
  /** `null` quita la asignación manual: vuelve a regir la suscripción o el plan por defecto. */
  planId: z.uuid().nullable(),
  reason,
});
export type ChangeOrganizationPlanDto = z.infer<typeof changeOrganizationPlanSchema>;

export const blockOrganizationSchema = z.object({ reason });
export type BlockOrganizationDto = z.infer<typeof blockOrganizationSchema>;

export const unblockOrganizationSchema = z.object({ reason });
export type UnblockOrganizationDto = z.infer<typeof unblockOrganizationSchema>;

// Precio en la unidad mínima de la moneda — nunca decimal (ST §8). La moneda es un dato (decisión
// #2): ISO 4217 de tres letras.
export const updatePlanSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    priceMonthly: z.number().int().min(0).max(100_000_000).optional(),
    priceYearly: z.number().int().min(0).max(1_000_000_000).optional(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "Usa el código ISO de 3 letras, por ejemplo CLP.")
      .transform((value) => value.toUpperCase())
      .optional(),
    limits: planLimitsSchema.optional(),
    reason,
  })
  .refine((body) => Object.keys(body).some((key) => key !== "reason"), {
    message: "Envía al menos un campo a modificar.",
  });
export type UpdatePlanDto = z.infer<typeof updatePlanSchema>;
