import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type MediaAsset, MediaKind, MediaStatus, type PrismaClient } from "@impulza/database";
import {
  type ImageTones,
  isVideoMimeType,
  MAX_IMAGE_PIXELS,
  type MediaVariant,
  planVariantWidths,
  relativeLuminance,
} from "@impulza/validation";
import sharp, { type Metadata } from "sharp";
import type { StorageAdapter } from "./adapter.js";
import { originalKey, variantKey, videoKey } from "./keys.js";
import { extractVideoFrames, probeVideo, transcodeVideo, VideoRejectedError, type VideoToolsConfig } from "./video.js";

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

/** Tonos de todo un video (PP6): el más oscuro y el más claro entre los de cada cuadro medido. */
export function combineTones(perFrame: ImageTones[]): ImageTones {
  const byLuminance = (a: string, b: string) => relativeLuminance(a) - relativeLuminance(b);
  return {
    darkest: perFrame.map((tones) => tones.darkest).sort(byLuminance)[0]!,
    lightest: perFrame.map((tones) => tones.lightest).sort(byLuminance).at(-1)!,
  };
}

/** Variantes WebP (400/800/1600, sin agrandar ni metadatos) de una imagen, con caché inmutable. */
async function writeImageVariants(
  storage: StorageAdapter,
  asset: MediaAsset,
  source: Buffer,
  originalWidth: number,
  written: string[],
): Promise<MediaVariant[]> {
  const variants: MediaVariant[] = [];
  for (const width of planVariantWidths(originalWidth)) {
    // `rotate()` sin argumentos endereza según el EXIF; sharp no copia metadatos a la salida
    // salvo que se pida con `withMetadata()`, que acá no se usa a propósito.
    const { data } = await sharp(source, { limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    const key = variantKey(asset.organizationId, asset.id, width);
    await storage.putObject({ key, body: data, contentType: "image/webp", cacheControl: IMMUTABLE_CACHE });
    written.push(key);
    variants.push({ width, key, sizeBytes: data.byteLength });
  }
  return variants;
}

interface ProcessedMedia {
  variants: MediaVariant[];
  tones: ImageTones;
  width: number;
  height: number;
}

/**
 * Video (PP6, ADR-007): verifica con ffprobe, convierte a MP4 H.264 de 720p sin audio ni metadatos,
 * saca el póster (primer cuadro) en las mismas variantes WebP que una imagen, y mide los tonos sobre
 * un cuadro por segundo — la capa de legibilidad tiene que servir en todas las escenas, no solo en
 * el póster. Todo en una carpeta temporal propia que se borra siempre.
 */
async function processVideo(
  storage: StorageAdapter,
  tools: VideoToolsConfig,
  asset: MediaAsset,
  original: Buffer,
  written: string[],
): Promise<ProcessedMedia> {
  if (!isVideoMimeType(asset.mimeType)) {
    throw new VideoRejectedError("El archivo no es un video válido del formato indicado.");
  }
  const workDir = await mkdtemp(path.join(tmpdir(), "impulza-video-"));
  try {
    const inputPath = path.join(workDir, "input");
    const outputPath = path.join(workDir, "video.mp4");
    const posterPath = path.join(workDir, "poster.png");
    const framesDir = path.join(workDir, "frames");
    await writeFile(inputPath, original);

    await probeVideo(tools, inputPath, asset.mimeType);
    await transcodeVideo(tools, inputPath, asset.mimeType, outputPath);
    // El original del usuario ya no hace falta: lo que sigue lee solo el video convertido.
    await rm(inputPath, { force: true });
    await mkdir(framesDir);
    await extractVideoFrames(tools, outputPath, { posterPath, framesPattern: path.join(framesDir, "f%03d.png") });

    const poster = await readFile(posterPath);
    const { width = 0, height = 0 } = await sharp(poster).metadata();
    if (width === 0 || height === 0) {
      throw new Error("El póster del video no tiene dimensiones legibles.");
    }

    const video = await readFile(outputPath);
    const key = videoKey(asset.organizationId, asset.id);
    await storage.putObject({ key, body: video, contentType: "video/mp4", cacheControl: IMMUTABLE_CACHE });
    written.push(key);

    const posterVariants = await writeImageVariants(storage, asset, poster, width, written);
    const frames = (await readdir(framesDir)).filter((name) => name.endsWith(".png")).sort();
    const perFrame = await Promise.all(frames.map(async (name) => computeImageTones(await readFile(path.join(framesDir, name)))));
    const tones = combineTones(perFrame.length > 0 ? perFrame : [await computeImageTones(poster)]);

    return { variants: [...posterVariants, { width, key, sizeBytes: video.byteLength }], tones, width, height };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Procesa un medio confirmado (ADR-006 §4). Imagen: la endereza según su EXIF, genera variantes WebP
 * (400/800/1600, sin agrandar) **sin metadatos** —las fotos de celular traen la ubicación GPS—.
 * Video (PP6): ver `processVideo`. En los dos casos guarda con caché inmutable y **borra el
 * original**. Lo mismo corre en el worker y en las pruebas.
 *
 * Idempotente: si el asset ya no está `PROCESSING` (otro intento lo terminó o se borró), no hace
 * nada. Si falla, deja el asset `FAILED` con un motivo legible y limpia todo lo que alcanzó a
 * escribir, así un error no deja basura ocupando la cuota.
 */
export async function processMediaAsset(
  prisma: PrismaClient,
  storage: StorageAdapter,
  assetId: string,
  options: {
    videoTools?: VideoToolsConfig | null;
    /** Para el log estructurado del worker: el detalle técnico queda ahí, nunca en el mensaje al usuario. */
    onError?: (error: unknown) => void;
  } = {},
): Promise<MediaProcessResult> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.status !== MediaStatus.PROCESSING) {
    return "skipped";
  }

  const source = originalKey(asset.organizationId, asset.id);
  const written: string[] = [];
  const isVideo = asset.kind === MediaKind.VIDEO;

  try {
    const original = Buffer.from(await storage.getObject(source));
    let result: ProcessedMedia;

    if (isVideo) {
      if (!options.videoTools) {
        throw new VideoRejectedError("El procesamiento de video no está habilitado en esta instalación.");
      }
      result = await processVideo(storage, options.videoTools, asset, original, written);
    } else {
      // `limitInputPixels`: una imagen chica en bytes pero enorme en píxeles no tumba el worker.
      const metadata = await sharp(original, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
      const size = orientedSize(metadata);
      if (size.width === 0 || size.height === 0) {
        throw new Error("La imagen no tiene dimensiones legibles.");
      }
      const variants = await writeImageVariants(storage, asset, original, size.width, written);
      result = { variants, tones: await computeImageTones(original), width: size.width, height: size.height };
    }

    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: MediaStatus.READY,
        tones: result.tones,
        width: result.width,
        height: result.height,
        variants: result.variants,
        storedBytes: result.variants.reduce((total, variant) => total + variant.sizeBytes, 0),
        failureReason: null,
      },
    });
    await storage.deleteObjects([source]);
    return "processed";
  } catch (error) {
    options.onError?.(error);
    await storage.deleteObjects([...written, source]).catch(() => undefined);
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: MediaStatus.FAILED,
        storedBytes: 0,
        variants: [],
        failureReason: failureReasonFor(error, isVideo),
      },
    });
    return "failed";
  }
}

/** Motivo legible del fallo. Solo los rechazos explícitos se muestran tal cual: el detalle técnico
 *  de un error (salida de ffmpeg, rutas del servidor) nunca llega al usuario. */
function failureReasonFor(error: unknown, isVideo: boolean): string {
  if (error instanceof VideoRejectedError) {
    return error.message;
  }
  if (!isVideo && error instanceof Error && /pixel/i.test(error.message)) {
    return "La imagen es demasiado grande en píxeles (máximo 40 megapíxeles).";
  }
  return isVideo ? "No pudimos procesar el video. Prueba con otro archivo." : "No pudimos procesar la imagen. Prueba con otro archivo.";
}
