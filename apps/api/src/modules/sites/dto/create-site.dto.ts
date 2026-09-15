import { publicSlugSchema } from "@impulza/validation";
import { z } from "zod";

export const createSiteSchema = z.object({
  name: z.string().min(2).max(120),
  slug: publicSlugSchema,
});

export type CreateSiteDto = z.infer<typeof createSiteSchema>;
