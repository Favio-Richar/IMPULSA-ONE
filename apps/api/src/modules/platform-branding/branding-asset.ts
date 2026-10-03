import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";
import {
  MAX_BRANDING_DIMENSION,
  MAX_BRANDING_FAVICON_BYTES,
  MAX_BRANDING_LOGO_BYTES,
  MIN_BRANDING_FAVICON_DIMENSION,
  MIN_BRANDING_LOGO_DIMENSION,
  validateAndSanitizeSvg,
  type UploadBrandingAssetDto,
} from "@impulza/validation";
import { detectImageType, MAGIC_BYTES_LENGTH } from "@impulza/storage";

export interface PreparedBrandingAsset {
  body: Buffer;
  extension: "png" | "jpg" | "webp" | "svg";
}

/**
 * Valida y prepara un logo o favicon recibido en base64: tamaño, tipo real (bytes mágicos), decodificación
 * con `sharp` y dimensiones para imágenes, y saneado por lista de permitidos para SVG.
 *
 * **Una sola implementación** para la marca de la plataforma (F9.1) y la de cada organización (F9.2): una
 * corrección de seguridad aquí protege las dos rutas. Lanza `BadRequestException` con un motivo claro.
 */
export async function prepareBrandingAsset(input: UploadBrandingAssetDto): Promise<PreparedBrandingAsset> {
  const maxBytes = input.target === "favicon" ? MAX_BRANDING_FAVICON_BYTES : MAX_BRANDING_LOGO_BYTES;
  if (input.sizeBytes > maxBytes) {
    throw new BadRequestException(`El archivo excede el tamaño máximo permitido de ${Math.round(maxBytes / 1024)} KB.`);
  }

  let base64 = input.base64Data;
  const dataUrlMatch = base64.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    base64 = dataUrlMatch[2]!;
  }
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > maxBytes) {
    throw new BadRequestException(`El contenido decodificado excede el tamaño máximo de ${Math.round(maxBytes / 1024)} KB.`);
  }

  if (input.contentType === "image/svg+xml") {
    const validation = validateAndSanitizeSvg(buffer.toString("utf8"));
    if (!validation.ok) {
      throw new BadRequestException(validation.error);
    }
    return { body: Buffer.from(validation.sanitized, "utf8"), extension: "svg" };
  }

  const detected = detectImageType(new Uint8Array(buffer.subarray(0, MAGIC_BYTES_LENGTH)));
  if (!detected || detected !== input.contentType) {
    throw new BadRequestException("El contenido del archivo no coincide con el formato de imagen declarado.");
  }

  // Los bytes mágicos solo prueban el encabezado: `sharp` decodifica de verdad (un archivo truncado o
  // corrupto falla acá) y entrega las dimensiones reales para exigir un mínimo.
  let width: number | undefined;
  let height: number | undefined;
  try {
    const metadata = await sharp(buffer, { limitInputPixels: MAX_BRANDING_DIMENSION * MAX_BRANDING_DIMENSION }).metadata();
    width = metadata.width;
    height = metadata.height;
  } catch {
    throw new BadRequestException("No se pudo leer la imagen: el archivo está dañado o no es válido.");
  }
  const minimum = input.target === "favicon" ? MIN_BRANDING_FAVICON_DIMENSION : MIN_BRANDING_LOGO_DIMENSION;
  if (!width || !height || width < minimum || height < minimum) {
    throw new BadRequestException(`La imagen es demasiado pequeña: debe medir al menos ${minimum} × ${minimum} px.`);
  }
  if (width > MAX_BRANDING_DIMENSION || height > MAX_BRANDING_DIMENSION) {
    throw new BadRequestException(`La imagen es demasiado grande: el máximo es ${MAX_BRANDING_DIMENSION} × ${MAX_BRANDING_DIMENSION} px.`);
  }

  const extension = input.contentType === "image/jpeg" ? "jpg" : input.contentType === "image/webp" ? "webp" : "png";
  return { body: buffer, extension };
}
