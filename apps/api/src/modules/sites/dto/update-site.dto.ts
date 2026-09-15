import { publicSlugSchema } from "@impulza/validation";
import { z } from "zod";

// Actualización parcial, pero nunca vacía: un PATCH sin ningún campo es casi siempre un bug del
// cliente y devolver 200 sin hacer nada lo esconde.
export const updateSiteSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    slug: publicSlugSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Envía al menos un campo a modificar.",
  });

export type UpdateSiteDto = z.infer<typeof updateSiteSchema>;
