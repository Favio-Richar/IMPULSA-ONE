import { blockTypeSchema } from "@impulza/validation";
import { z } from "zod";

// El `config` llega como `unknown` a propósito: su forma depende del `type`, así que se valida en
// un segundo paso contra el esquema del catálogo (ver BlocksService). Validarlo acá con un
// `z.any()` permisivo sería mentir sobre lo que se comprobó.
export const createBlockSchema = z.object({
  type: blockTypeSchema,
  config: z.unknown(),
  visible: z.boolean().optional(),
  scheduledStart: z.iso.datetime({ offset: true }).optional(),
  scheduledEnd: z.iso.datetime({ offset: true }).optional(),
});

export const updateBlockSchema = z
  .object({
    config: z.unknown().optional(),
    visible: z.boolean().optional(),
    scheduledStart: z.iso.datetime({ offset: true }).nullable().optional(),
    scheduledEnd: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Envía al menos un campo a modificar.",
  });

export const reorderBlocksSchema = z.object({
  blockIds: z.array(z.uuid()).min(1),
});

/** PP5: el bloque que pasa a ser la acción principal de la página, o `null` para quitarla. */
export const setPrimaryBlockSchema = z.object({
  blockId: z.uuid().nullable(),
});

export type CreateBlockDto = z.infer<typeof createBlockSchema>;
export type UpdateBlockDto = z.infer<typeof updateBlockSchema>;
export type ReorderBlocksDto = z.infer<typeof reorderBlocksSchema>;
export type SetPrimaryBlockDto = z.infer<typeof setPrimaryBlockSchema>;
