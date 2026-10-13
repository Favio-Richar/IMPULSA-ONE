import { publicSlugSchema } from "@impulza/validation";
import { z } from "zod";

/** Duplicar un sitio: nombre y slug públicos de la copia (el slug es único en toda la plataforma, igual que al crear). */
export const duplicateSiteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: publicSlugSchema,
});

export type DuplicateSiteDto = z.infer<typeof duplicateSiteSchema>;
