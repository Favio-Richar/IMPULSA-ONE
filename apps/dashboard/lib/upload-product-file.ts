import type { ProductResponse } from "@impulza/contracts";
import { requestProductFileUploadSchema } from "@impulza/validation";
import { ApiError } from "./api-client";
import { confirmProductFile, requestProductFileUpload } from "./api/catalog";
import { putWithProgress, UploadError } from "./upload-image";

function messageFor(error: unknown): string {
  if (error instanceof UploadError) return error.message;
  if (error instanceof ApiError) {
    const body = error.body as { code?: string; message?: string } | undefined;
    if (error.status === 402) return body?.message ?? "Llegaste al máximo de almacenamiento de tu plan.";
    if (error.status === 503 && body?.code === "DOWNLOADS_NOT_CONFIGURED") return "La venta de archivos todavía no está habilitada en esta instalación.";
    if (error.status === 403) return "Tu rol no permite cambiar el catálogo.";
    if (typeof body?.message === "string") return body.message;
  }
  return "No pudimos subir el archivo. Intenta de nuevo.";
}

/**
 * Archivo en venta (F5.11b, ADR-015): valida con las mismas reglas que el servidor, pide la URL
 * (reserva cuota), sube directo al bucket privado con progreso y confirma (el servidor verifica el
 * tamaño exacto y el tipo real). Devuelve el producto con su archivo listo.
 */
export async function uploadProductFile(
  organizationId: string,
  siteId: string,
  productId: string,
  file: File,
  onPercent: (percent: number) => void,
): Promise<ProductResponse> {
  const input = requestProductFileUploadSchema.safeParse({ fileName: file.name, contentType: file.type, sizeBytes: file.size });
  if (!input.success) {
    throw new UploadError(input.error.issues[0]?.message ?? "Archivo no permitido.");
  }
  try {
    const { fileId, upload } = await requestProductFileUpload(organizationId, siteId, productId, input.data);
    await putWithProgress(upload.url, file, upload.headers, onPercent);
    return await confirmProductFile(organizationId, siteId, productId, fileId);
  } catch (error) {
    throw new UploadError(messageFor(error), error);
  }
}
