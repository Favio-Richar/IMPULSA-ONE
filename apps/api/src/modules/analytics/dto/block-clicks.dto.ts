import { z } from "zod";

/** Ventana del panel de clics de un bloque: 30 días por defecto, como máximo 90 (lo acota además el plan). */
export const BLOCK_CLICKS_DEFAULT_DAYS = 30;
export const BLOCK_CLICKS_MAX_DAYS = 90;

export const blockClicksQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(BLOCK_CLICKS_MAX_DAYS).default(BLOCK_CLICKS_DEFAULT_DAYS),
});

export type BlockClicksQuery = z.infer<typeof blockClicksQuerySchema>;
