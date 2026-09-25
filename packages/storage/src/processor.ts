import { MediaStatus, type PrismaClient } from "@impulza/database";
import { type ImageTones, MAX_IMAGE_PIXELS, type MediaVariant, planVariantWidths, relativeLuminance } from "@impulza/validation";
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

/** Lado de la versión reducida con la que se miden los tonos: suficiente para que un punto de la
 *  muestra sea una zona del tamaño de un texto, no un píxel suelto (un reflejo no decide nada). */
const TONE_SAMPLE_SIZE = 64;

async function toneSample(input: Buffer, background: string): Promise<string[]> {
  const { data, info } = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS })
    .rotate()
    // Las zonas transparentes se miden sobre negro (para el tono más oscuro) y sobre blanco (para el
    // más claro): así cuenta el peor caso de lo que haya detrás.
    .flatten({ background })
    .resize(TONE_SAMPLE_SIZE, TONE_SAMPLE_SIZE, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hexes: string[] = [];
  for (let offset = 0; offset + 2 < data.length; offset += info.channels) {
    hexes.push(`#${[data[offset]!, data[offset + 1]!, data[offset + 2]!].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`);
  }
  return hexes.sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
}

/**
 * Tonos extremos de una imagen (PP3): el color del percentil 2 de luminosidad (el más oscuro) y el
 * del 98 (el más claro). Con esto la API sabe si el texto se lee sobre **toda** la imagen con cierta
 * capa de oscurecido o aclarado, no solo en promedio (`isOverlayLegible` en `@impulza/validation`).
 */
export async function computeImageTones(input: Buffer): Promise<ImageTones> {
  const [overBlack, overWhite] = await Promise.all([toneSample(input, "#000000"), toneSample(input, "#ffffff")]);
  const percentile = (sorted: string[], p: number) => sorted[Math.round((sorted.length - 1) * p)]!;
  return { darkest: percentile(overBlack, 0.02), lightest: percentile(overWhite, 0.98) };
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

    const tones = await computeImageTones(original);

    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: MediaStatus.READY,
        tones,
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
