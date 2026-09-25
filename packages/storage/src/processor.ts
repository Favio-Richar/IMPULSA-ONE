import { MediaStatus, type PrismaClient } from "@impulza/database";
import { MAX_IMAGE_PIXELS, type MediaVariant, planVariantWidths } from "@impulza/validation";
import sharp, { type Metadata } from "sharp";
import type { StorageAdapter } from "./adapter.js";
import { originalKey, variantKey } from "./keys.js";

/** Las variantes nunca cambian (la clave incluye el ancho y el asset es inmutable): el navegador y
 *  la CDN pueden guardarlas un año sin preguntar. */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const WEBP_QUALITY = 82;

export type MediaProcessResult = "processed" | "skipped" | "failed";

/** Orientación EXIF 5–8 = la foto se sacó girada 90°: al enderezarla, ancho y alto se invierten. */
function orientedSize(metadata: Metadata): { width: number; height: number } {
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  return (metadata.orientation ?? 1) >= 5 ? { width: height, height: width } : { width, height };
}

/**
 * Procesa una imagen confirmada (ADR-006 §4): la endereza según su EXIF, genera variantes WebP
 * (400/800/1600, sin agrandar) **sin metadatos** —las fotos de celular traen la ubicación GPS—, las
 * guarda con caché inmutable y **borra el original**. Lo mismo corre en el worker y en las pruebas.
 *
 * Idempotente: si el asset ya no está `PROCESSING` (otro intento lo terminó o se borró), no hace
 * nada. Si falla, deja el asset `FAILED` con un motivo legible y limpia todo lo que alcanzó a
 * escribir, así un error no deja basura ocupando la cuota.
 */
export async function processMediaAsset(prisma: PrismaClient, storage: StorageAdapter, assetId: string): Promise<MediaProcessResult> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.status !== MediaStatus.PROCESSING) {
    return "skipped";
  }

  const source = originalKey(asset.organizationId, asset.id);
  const written: string[] = [];

  try {
    const original = Buffer.from(await storage.getObject(source));
    // `limitInputPixels`: una imagen chica en bytes pero enorme en píxeles no tumba el worker.
    const metadata = await sharp(original, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
    const size = orientedSize(metadata);
    if (size.width === 0 || size.height === 0) {
      throw new Error("La imagen no tiene dimensiones legibles.");
    }

    const variants: MediaVariant[] = [];
    for (const width of planVariantWidths(size.width)) {
      // `rotate()` sin argumentos endereza según el EXIF; sharp no copia metadatos a la salida
      // salvo que se pida con `withMetadata()`, que acá no se usa a propósito.
      const { data } = await sharp(original, { limitInputPixels: MAX_IMAGE_PIXELS })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
      const key = variantKey(asset.organizationId, asset.id, width);
      await storage.putObject({ key, body: data, contentType: "image/webp", cacheControl: IMMUTABLE_CACHE });
      written.push(key);
      variants.push({ width, key, sizeBytes: data.byteLength });
    }

    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: MediaStatus.READY,
        width: size.width,
        height: size.height,
        variants,
        storedBytes: variants.reduce((total, variant) => total + variant.sizeBytes, 0),
        failureReason: null,
      },
    });
    await storage.deleteObjects([source]);
    return "processed";
  } catch (error) {
    await storage.deleteObjects([...written, source]).catch(() => undefined);
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: MediaStatus.FAILED,
        storedBytes: 0,
        variants: [],
        failureReason: error instanceof Error && /pixel/i.test(error.message)
          ? "La imagen es demasiado grande en píxeles (máximo 40 megapíxeles)."
          : "No pudimos procesar la imagen. Prueba con otro archivo.",
      },
    });
    return "failed";
  }
}
