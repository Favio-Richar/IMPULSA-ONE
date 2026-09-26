import type { MediaAssetResponse } from "@impulza/contracts";
import { isVideoMimeType, requestImageUploadSchema, requestMediaUploadSchema } from "@impulza/validation";
import { ApiError } from "./api-client";
import { confirmMediaUpload, getMediaAsset, requestMediaUpload } from "./api/media";

export type UploadPhase = "validating" | "uploading" | "verifying" | "processing" | "ready" | "failed";

export interface UploadProgress {
  phase: UploadPhase;
  /** 0–100 durante `uploading`. */
  percent: number;
}

/** Error de subida con un mensaje ya listo para mostrar. `origin` conserva el `ApiError` (p. ej. un
 *  402 de límite de plan, que la pantalla muestra con su propio aviso). */
export class UploadError extends Error {
  constructor(
    message: string,
    public readonly origin?: unknown,
  ) {
    super(message);
  }
}

/** `fetch` no informa el avance de una subida; `XMLHttpRequest` sí. */
function putWithProgress(url: string, file: File, headers: Record<string, string>, onPercent: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onPercent(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadError("El almacenamiento rechazó el archivo. Intenta de nuevo.")));
    xhr.onerror = () => reject(new UploadError("Se cortó la conexión durante la subida. Intenta de nuevo."));
    xhr.send(file);
  });
}

function messageFor(error: unknown, isVideo: boolean): string {
  if (error instanceof UploadError) {
    return error.message;
  }
  if (error instanceof ApiError) {
    const body = error.body as { code?: string; message?: string } | undefined;
    if (error.status === 402) return body?.message ?? "Llegaste al máximo de almacenamiento de tu plan.";
    if (error.status === 503 && body?.code === "STORAGE_NOT_CONFIGURED") return "La subida de archivos todavía no está habilitada.";
    if (error.status === 503 && body?.code === "VIDEO_NOT_CONFIGURED") return "La subida de videos todavía no está habilitada.";
    if (error.status === 429) return "Subiste muchos archivos seguidos. Espera un momento.";
    if (error.status === 403) return "Tu rol no permite subir archivos.";
    if (typeof body?.message === "string") return body.message;
  }
  return isVideo ? "No pudimos subir el video. Intenta de nuevo." : "No pudimos subir la imagen. Intenta de nuevo.";
}

/** Un video tarda más: se convierte en el worker (PP6). */
const PROCESSING_DEADLINE_MS = { image: 90_000, video: 240_000 };

/**
 * Subida completa (PP2, ADR-006; video desde PP6, ADR-007): valida con las mismas reglas que el
 * servidor, pide la URL (reserva cuota), sube **directo al almacenamiento** con progreso, confirma
 * (el servidor verifica el archivo real) y espera a que el worker la optimice o convierta. Devuelve
 * el asset `READY`. `allowVideo` solo en la biblioteca: el selector de los bloques es de imágenes.
 */
export async function uploadMedia(
  organizationId: string,
  file: File,
  onProgress: (progress: UploadProgress) => void,
  options: { allowVideo?: boolean } = {},
): Promise<MediaAssetResponse> {
  onProgress({ phase: "validating", percent: 0 });
  const isVideo = isVideoMimeType(file.type);
  const schema = options.allowVideo ? requestMediaUploadSchema : requestImageUploadSchema;
  const input = schema.safeParse({ fileName: file.name, contentType: file.type, sizeBytes: file.size });
  if (!input.success) {
    throw new UploadError(input.error.issues[0]?.message ?? "Archivo no permitido.");
  }

  try {
    const { asset, upload } = await requestMediaUpload(organizationId, input.data);
    onProgress({ phase: "uploading", percent: 0 });
    await putWithProgress(upload.url, file, upload.headers, (percent) => onProgress({ phase: "uploading", percent }));

    onProgress({ phase: "verifying", percent: 100 });
    let current = await confirmMediaUpload(organizationId, asset.id);

    onProgress({ phase: "processing", percent: 100 });
    const deadline = Date.now() + PROCESSING_DEADLINE_MS[isVideo ? "video" : "image"];
    while (current.status === "PROCESSING" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, isVideo ? 1500 : 800));
      current = await getMediaAsset(organizationId, asset.id);
    }
    if (current.status !== "READY") {
      throw new UploadError(
        current.failureReason ??
          (isVideo
            ? "El video sigue convirtiéndose. Aparecerá en tu biblioteca en unos minutos."
            : "La imagen sigue procesándose. Aparecerá en tu biblioteca en unos minutos."),
      );
    }
    onProgress({ phase: "ready", percent: 100 });
    return current;
  } catch (error) {
    onProgress({ phase: "failed", percent: 0 });
    throw error instanceof UploadError ? error : new UploadError(messageFor(error, isVideo), error);
  }
}

/** Selector de imágenes de los bloques (PP2): solo imágenes. */
export function uploadImage(organizationId: string, file: File, onProgress: (progress: UploadProgress) => void): Promise<MediaAssetResponse> {
  return uploadMedia(organizationId, file, onProgress);
}
