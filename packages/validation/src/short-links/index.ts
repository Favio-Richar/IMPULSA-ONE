import { z } from "zod";
import { safeUrlSchema } from "../blocks/primitives.js";
import { publicSlugSchema } from "../slug.js";
import { qrStyleKeySchema } from "../qr/index.js";

// Enlaces cortos y QR (F3.5). `publicSlugSchema` (F2.2) se reutiliza tal cual: mismo formato,
// misma lista de reservados — el slug de un enlace corto vive en su propio espacio de rutas
// públicas (`/s/:slug`, ver ERD.md §6), pero comparte la misma disciplina de validación.

const utmSchema = z.object({
  source: z.string().trim().max(120).optional(),
  medium: z.string().trim().max(120).optional(),
  campaign: z.string().trim().max(120).optional(),
  term: z.string().trim().max(120).optional(),
  content: z.string().trim().max(120).optional(),
});

export const createShortLinkSchema = z.object({
  slug: publicSlugSchema,
  destinationUrl: safeUrlSchema,
  utm: utmSchema.optional(),
});

export type CreateShortLinkInput = z.infer<typeof createShortLinkSchema>;

export const updateShortLinkSchema = z
  .object({
    destinationUrl: safeUrlSchema.optional(),
    utm: utmSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "El cuerpo no puede estar vacío." });

export type UpdateShortLinkInput = z.infer<typeof updateShortLinkSchema>;

export const createQrCodeSchema = z
  .object({
    shortLinkId: z.uuid().optional(),
    directUrl: safeUrlSchema.optional(),
    styleKey: qrStyleKeySchema,
  })
  .refine((value) => value.shortLinkId !== undefined || value.directUrl !== undefined, {
    message: "Indica un enlace corto o una URL directa.",
    path: ["shortLinkId"],
  });

export type CreateQrCodeInput = z.infer<typeof createQrCodeSchema>;

export const updateQrCodeSchema = z
  .object({
    styleKey: qrStyleKeySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "El cuerpo no puede estar vacío." });

export type UpdateQrCodeInput = z.infer<typeof updateQrCodeSchema>;
