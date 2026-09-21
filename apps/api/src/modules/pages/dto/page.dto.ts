import { pageSlugSchema, seoMetaSchema } from "@impulza/validation";
import { z } from "zod";

// La visibilidad es independiente del estado de publicación (F2.3): una página puede estar
// publicada pero oculta del menú (se alcanza por enlace directo), o visible pero aún en borrador.
export const pageVisibilitySchema = z.enum(["PUBLIC", "HIDDEN"]);

export const createPageSchema = z.object({
  slug: pageSlugSchema,
  visibility: pageVisibilitySchema.optional(),
});

export const updatePageSchema = z
  .object({
    slug: pageSlugSchema.optional(),
    visibility: pageVisibilitySchema.optional(),
    // `null` limpia el SEO propio de la página (vuelve a los valores derivados del contenido,
    // F2.8); `undefined` (el campo ausente del cuerpo) es "no tocar lo que ya había".
    seoMeta: seoMetaSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Envía al menos un campo a modificar.",
  });

// Reordenar manda el orden completo y no "mové esta a la posición 3": así el resultado no depende
// del orden en que lleguen varias peticiones ni deja huecos, y se puede validar de una sola vez
// que estén exactamente todas las páginas vivas del sitio.
export const reorderPagesSchema = z.object({
  pageIds: z.array(z.uuid()).min(1),
});

export type CreatePageDto = z.infer<typeof createPageSchema>;
export type UpdatePageDto = z.infer<typeof updatePageSchema>;
export type ReorderPagesDto = z.infer<typeof reorderPagesSchema>;
