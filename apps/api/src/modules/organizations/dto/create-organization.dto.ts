import { slugSchema } from "@impulza/validation";
import { z } from "zod";

// El slug de organización es interno (no resuelve una URL pública), así que usa el formato
// compartido pero no la lista de reservados — esa aplica al slug de sitio (publicSlugSchema, F2.2).
export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(120),
  slug: slugSchema,
});

export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;
