import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { MAX_VIDEO_SECONDS, VIDEO_MAX_SHORT_SIDE, type VideoMimeType } from "@impulza/validation";

// Conversión de video con ffmpeg (PP6, ADR-007). ffmpeg lee archivos subidos por usuarios, así que
// cada invocación va endurecida: sin shell, con el demuxer forzado según el tipo verificado por
// bytes mágicos, `-protocol_whitelist file` (un archivo manipulado no puede leer otros archivos ni
// salir a la red), sin leer la entrada estándar y con un límite de tiempo.

export interface VideoToolsConfig {
  ffmpegPath: string;
  ffprobePath: string;
}

/**
 * `FFMPEG_PATH` y `FFPROBE_PATH`, todo o nada (mismo criterio que el almacenamiento, ADR-006): sin
 * ninguna, `null` y la subida de video queda deshabilitada; con una sola, o con una ruta que no
 * existe, el proceso no arranca — es un error de despliegue y conviene verlo al iniciar.
 */
export function parseVideoToolsConfig(source: Record<string, string | undefined>): VideoToolsConfig | null {
  const ffmpegPath = source.FFMPEG_PATH?.trim() ?? "";
  const ffprobePath = source.FFPROBE_PATH?.trim() ?? "";
  if (ffmpegPath === "" && ffprobePath === "") {
    return null;
  }
  if (ffmpegPath === "" || ffprobePath === "") {
    throw new Error(`Configuración de video incompleta: falta ${ffmpegPath === "" ? "FFMPEG_PATH" : "FFPROBE_PATH"}.`);
  }
  for (const [name, value] of [["FFMPEG_PATH", ffmpegPath], ["FFPROBE_PATH", ffprobePath]] as const) {
    if (!existsSync(value)) {
      throw new Error(`Configuración de video inválida: ${name} no existe (${value}).`);
    }
  }
  return { ffmpegPath, ffprobePath };
}

/** Motivo de rechazo que se le puede mostrar al usuario tal cual (el resto de los errores, no). */
export class VideoRejectedError extends Error {}

/** Demuxer de ffmpeg para cada tipo verificado. Nunca se deja que ffmpeg lo adivine. */
const DEMUXERS: Record<VideoMimeType, string> = {
  "video/mp4": "mov",
  "video/quicktime": "mov",
  "video/webm": "matroska",
};

const PROBE_TIMEOUT_MS = 30_000;
const TRANSCODE_TIMEOUT_MS = 180_000;
/** Lado máximo de la entrada: un video "chico en bytes pero enorme en píxeles" no tumba el worker. */
const MAX_INPUT_SIDE = 4096;
/** Pequeña tolerancia: un loop de 15 s exactos suele medir 15,03 s por cómo se cierran los cuadros. */
const DURATION_TOLERANCE_SECONDS = 0.5;
const STDERR_LIMIT = 8 * 1024;

const HARDENED_INPUT = ["-protocol_whitelist", "file"];

function run(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_LIMIT);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(command)} superó el tiempo límite de ${timeoutMs} ms.`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${path.basename(command)} terminó con código ${code}: ${stderr.trim()}`));
      }
    });
  });
}

export interface VideoProbe {
  durationSeconds: number;
  width: number;
  height: number;
}

/**
 * Lee duración y dimensiones con ffprobe (salida JSON, no texto a interpretar) y rechaza lo que no
 * cumple: sin pista de video, más de 15 s, o más de 4096 px por lado.
 */
export async function probeVideo(tools: VideoToolsConfig, inputPath: string, mimeType: VideoMimeType): Promise<VideoProbe> {
  const output = await run(
    tools.ffprobePath,
    [
      "-v", "error",
      ...HARDENED_INPUT,
      "-f", DEMUXERS[mimeType],
      "-print_format", "json",
      "-show_entries", "format=duration:stream=codec_type,width,height,duration",
      inputPath,
    ],
    PROBE_TIMEOUT_MS,
  ).catch(() => {
    throw new VideoRejectedError("El archivo no es un video válido del formato indicado.");
  });

  const parsed = JSON.parse(output) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  if (!video?.width || !video.height) {
    throw new VideoRejectedError("El archivo no tiene imagen de video.");
  }
  const durationSeconds = Number(parsed.format?.duration ?? video.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new VideoRejectedError("No pudimos leer la duración del video.");
  }
  if (durationSeconds > MAX_VIDEO_SECONDS + DURATION_TOLERANCE_SECONDS) {
    throw new VideoRejectedError(`El video dura más de ${MAX_VIDEO_SECONDS} segundos. Recórtalo y vuelve a subirlo.`);
  }
  if (video.width > MAX_INPUT_SIDE || video.height > MAX_INPUT_SIDE) {
    throw new VideoRejectedError(`El video es demasiado grande (máximo ${MAX_INPUT_SIDE} px por lado).`);
  }
  return { durationSeconds, width: video.width, height: video.height };
}

/**
 * Lado corto hasta 720 px sin agrandar, dimensiones pares (H.264 con `yuv420p` las exige) y píxel
 * cuadrado. ffmpeg ya endereza según la rotación del teléfono antes de este filtro, así que
 * `iw`/`ih` son las dimensiones como se ve el video.
 */
const SCALE_FILTER =
  `scale=w='if(gt(iw,ih),-2,trunc(min(${VIDEO_MAX_SHORT_SIDE},iw)/2)*2)'` +
  `:h='if(gt(iw,ih),trunc(min(${VIDEO_MAX_SHORT_SIDE},ih)/2)*2,-2)',setsar=1`;

/**
 * Convierte a MP4 H.264 para cualquier teléfono: sin audio, sin metadatos (un video de celular puede
 * traer la ubicación), hasta 30 cuadros por segundo, tasa acotada y `faststart` (empieza a
 * reproducirse antes de terminar de bajar).
 */
export async function transcodeVideo(tools: VideoToolsConfig, inputPath: string, mimeType: VideoMimeType, outputPath: string): Promise<void> {
  await run(
    tools.ffmpegPath,
    [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      ...HARDENED_INPUT,
      "-f", DEMUXERS[mimeType],
      "-i", inputPath,
      "-map", "0:v:0", "-an", "-sn", "-dn",
      "-map_metadata", "-1", "-map_chapters", "-1",
      "-t", String(MAX_VIDEO_SECONDS),
      "-vf", SCALE_FILTER,
      "-fpsmax", "30",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-maxrate", "2500k", "-bufsize", "5000k",
      "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-f", "mp4", "-y", outputPath,
    ],
    TRANSCODE_TIMEOUT_MS,
  );
}

/**
 * Del video **ya convertido** (propio, no el del usuario): el primer cuadro como póster a tamaño
 * completo, y un cuadro por segundo en miniatura para medir los tonos de todas las escenas.
 */
export async function extractVideoFrames(
  tools: VideoToolsConfig,
  videoPath: string,
  output: { posterPath: string; framesPattern: string },
): Promise<void> {
  const input = ["-nostdin", "-hide_banner", "-loglevel", "error", ...HARDENED_INPUT, "-f", "mov", "-i", videoPath];
  await run(tools.ffmpegPath, [...input, "-frames:v", "1", "-f", "image2", "-c:v", "png", "-y", output.posterPath], PROBE_TIMEOUT_MS);
  await run(
    tools.ffmpegPath,
    [...input, "-vf", "fps=1,scale=64:64:force_original_aspect_ratio=decrease", "-f", "image2", "-c:v", "png", "-y", output.framesPattern],
    PROBE_TIMEOUT_MS,
  );
}
