import { z } from "zod";

// Descargas pagadas (F5.11b, ADR-015): el archivo que se vende con un producto digital. Vive en el
// bucket privado; el tipo real se verifica por bytes mágicos al confirmar la subida.

export const DOWNLOAD_MIME_TYPES = [
  "application/pdf",
  "application/zip",
  "application/epub+zip",
  "audio/mpeg",
  "video/mp4",
  "image/png",
  "image/jpeg",
] as const;
export type DownloadMimeType = (typeof DOWNLOAD_MIME_TYPES)[number];

/** Nombres que ve el negocio en el selector de archivos. */
export const DOWNLOAD_TYPE_LABELS: Record<DownloadMimeType, string> = {
  "application/pdf": "PDF",
  "application/zip": "ZIP",
  "application/epub+zip": "EPUB",
  "audio/mpeg": "MP3",
  "video/mp4": "MP4",
  "image/png": "PNG",
  "image/jpeg": "JPG",
};

/** Tope por archivo (ADR-015). Además cuenta para la cuota de almacenamiento del plan. */
export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

/** Descargas por pedido: un enlace compartido públicamente se agota (ADR-015 §4). */
export const MAX_DOWNLOADS_PER_ORDER = 20;

export function isDownloadMimeType(value: string): value is DownloadMimeType {
  return (DOWNLOAD_MIME_TYPES as readonly string[]).includes(value);
}

export const requestProductFileUploadSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    // Sin caracteres de control ni separadores de ruta (`/` y `\`).
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u001f\u007f/\\]+$/, "Nombre de archivo inválido."),
  contentType: z.enum(DOWNLOAD_MIME_TYPES, { error: "Formato no permitido. Usa PDF, ZIP, EPUB, MP3, MP4, PNG o JPG." }),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(MAX_DOWNLOAD_BYTES, `El archivo puede pesar hasta ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB.`),
});
export type RequestProductFileUploadInput = z.infer<typeof requestProductFileUploadSchema>;
