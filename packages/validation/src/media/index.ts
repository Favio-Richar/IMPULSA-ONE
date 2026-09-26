import { z } from "zod";

// Medios (PP1, ADR-006). Isomorfo: el panel valida con esto antes de subir y la API lo vuelve a
// aplicar — el navegador nunca es la autoridad.

/** Lista cerrada. **Nunca SVG**: puede llevar `<script>` y sería un XSS almacenado servido desde
 *  nuestro propio dominio de medios. */
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Video de fondo propio (PP6, ADR-007). MOV (`video/quicktime`) porque es lo que graba un iPhone;
 * el worker convierte cualquiera de los tres a MP4 H.264 de 720p sin audio.
 */
export const VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export type VideoMimeType = (typeof VIDEO_MIME_TYPES)[number];
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
/** Duración máxima del video subido, en segundos (un loop de fondo, no una película). */
export const MAX_VIDEO_SECONDS = 15;
/** Lado corto máximo del video convertido. */
export const VIDEO_MAX_SHORT_SIDE = 720;

export function isVideoMimeType(mimeType: string): mimeType is VideoMimeType {
  return (VIDEO_MIME_TYPES as readonly string[]).includes(mimeType);
}
/** Tope de píxeles al decodificar: una imagen chica en bytes pero gigante en píxeles ("bomba de
 *  descompresión") no puede tumbar el worker. */
export const MAX_IMAGE_PIXELS = 40_000_000;

/** Anchos de las variantes WebP que se sirven al público. Nunca se agranda una imagen. */
export const IMAGE_VARIANT_WIDTHS = [400, 800, 1600] as const;

/** Anchos a generar para una imagen de `originalWidth`: los fijos menores que el original, más el
 *  ancho original si queda por debajo del mayor (así una imagen de 1000 px tiene 400, 800 y 1000). */
export function planVariantWidths(originalWidth: number): number[] {
  const largest = IMAGE_VARIANT_WIDTHS[IMAGE_VARIANT_WIDTHS.length - 1]!;
  const widths: number[] = IMAGE_VARIANT_WIDTHS.filter((width) => width < originalWidth);
  const top = Math.min(originalWidth, largest);
  if (!widths.includes(top)) {
    widths.push(top);
  }
  return widths;
}

const MEDIA_VARIANT_URL =
  /\/org\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/w(\d+)\.webp$/i;

/**
 * `srcset` de una imagen de la biblioteca a partir de la URL de su variante más grande (la que
 * guardan los bloques). No hace falta guardar la lista: dado el ancho mayor `N`, las variantes son
 * exactamente `planVariantWidths(N)` (si `N` es 1600, el original era igual o más ancho y se
 * generaron las tres fijas). Una URL externa devuelve `null` y se usa tal cual.
 */
export function mediaSrcSet(url: string): string | null {
  const match = MEDIA_VARIANT_URL.exec(url);
  if (!match) {
    return null;
  }
  const largest = Number(match[1]);
  return planVariantWidths(largest)
    .map((width) => `${url.replace(/w\d+\.webp$/i, `w${width}.webp`)} ${width}w`)
    .join(", ");
}

// Solo para mostrarlo en la biblioteca; nunca forma parte de la clave en el bucket.
const uploadFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  // Sin caracteres de control ni separadores de ruta (`/` y `\`).
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f/\\]+$/, "Nombre de archivo inválido.");

/**
 * Subida a la biblioteca (`/medios`): una imagen o un video (PP6), cada uno con su tope de tamaño.
 * El selector de imágenes de los bloques sigue usando `requestImageUploadSchema`, que no acepta video.
 */
export const requestMediaUploadSchema = z
  .object({
    fileName: uploadFileNameSchema,
    contentType: z.enum([...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES], {
      error: "Formato no permitido. Usa JPG, PNG, WebP o AVIF para imágenes, y MP4, WebM o MOV para video.",
    }),
    sizeBytes: z.number().int().min(1),
  })
  .superRefine((value, ctx) => {
    const video = isVideoMimeType(value.contentType);
    const limit = video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (value.sizeBytes > limit) {
      ctx.addIssue({
        code: "custom",
        path: ["sizeBytes"],
        message: video ? "El video supera los 30 MB." : "La imagen supera los 8 MB.",
      });
    }
  });
export type RequestMediaUploadInput = z.infer<typeof requestMediaUploadSchema>;

export const requestImageUploadSchema = z.object({
  fileName: uploadFileNameSchema,
  contentType: z.enum(IMAGE_MIME_TYPES, { error: "Formato no permitido. Usa JPG, PNG, WebP o AVIF." }),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(MAX_IMAGE_BYTES, { error: "La imagen supera los 8 MB." }),
});
export type RequestImageUploadInput = z.infer<typeof requestImageUploadSchema>;

export const mediaVariantSchema = z.object({
  width: z.number().int().positive(),
  key: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});
export const mediaVariantsSchema = z.array(mediaVariantSchema);
export type MediaVariant = z.infer<typeof mediaVariantSchema>;
