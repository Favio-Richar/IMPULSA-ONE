import { z } from "zod";

// Slug URL-safe: minúsculas, dígitos y guiones, sin guiones al borde (ERD: "Site.slug único
// global" usa la misma convención — se mantiene consistente para cuando F2 lo reutilice).
export const slugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Solo minúsculas, dígitos y guiones (sin empezar/terminar en guión).");

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(120),
  slug: slugSchema,
});

export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;
