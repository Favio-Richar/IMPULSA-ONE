import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Biblioteca de medios (PP1, ADR-006). Nunca se expone la clave interna del bucket ni la URL del
// original (se borra al procesar): solo las variantes públicas.

export const mediaKind = z.enum(["IMAGE", "VIDEO"]);
export const mediaStatus = z.enum(["PENDING_UPLOAD", "PROCESSING", "READY", "FAILED"]);

export const mediaAssetResponse = z.object({
  id: uuid,
  kind: mediaKind,
  status: mediaStatus,
  fileName: z.string(),
  mimeType: z.string(),
  /** Lo guardado (variantes) si está listo; lo declarado mientras está pendiente o en proceso. */
  sizeBytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** Variante más grande. `null` hasta que el asset esté `READY`. */
  url: z.string().nullable(),
  /** Para `srcset`: de menor a mayor ancho. */
  variants: z.array(z.object({ width: z.number().int(), url: z.string() })),
  /** Solo en un video listo (PP6): el MP4 convertido. `url`/`variants` son entonces su póster. */
  videoUrl: z.string().nullable(),
  failureReason: z.string().nullable(),
  /** Tonos extremos `{ darkest, lightest }` (PP3): con ellos el panel ofrece solo las capas de
   *  legibilidad que alcanzan AA sobre esta imagen. `null` en imágenes procesadas antes de PP3. */
  tones: z.object({ darkest: z.string(), lightest: z.string() }).nullable(),
  createdAt: isoDateTime,
});

export const mediaUploadResponse = z.object({
  asset: mediaAssetResponse,
  upload: z.object({
    url: z.string(),
    method: z.literal("PUT"),
    /** Cabeceras que la subida debe llevar tal cual (van firmadas). */
    headers: z.record(z.string(), z.string()),
    expiresAt: isoDateTime,
  }),
});

export const mediaLibraryResponse = z.object({
  items: z.array(mediaAssetResponse),
  usage: z.object({
    usedBytes: z.number().int(),
    /** `null` = sin límite en el plan. */
    limitBytes: z.number().int().nullable(),
  }),
  /** `false` mientras no haya credenciales del proveedor: el panel explica en vez de fallar. */
  storageConfigured: z.boolean(),
  /** `false` mientras no haya ffmpeg configurado (PP6, ADR-007): el panel no ofrece subir video. */
  videoConfigured: z.boolean(),
});

export type MediaAssetResponse = z.infer<typeof mediaAssetResponse>;
export type MediaUploadResponse = z.infer<typeof mediaUploadResponse>;
export type MediaLibraryResponse = z.infer<typeof mediaLibraryResponse>;
