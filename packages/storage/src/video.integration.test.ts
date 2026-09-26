import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { extractVideoFrames, parseVideoToolsConfig, probeVideo, transcodeVideo, VideoRejectedError } from "./video.js";

// ffmpeg real (ADR-007). Necesita FFMPEG_PATH y FFPROBE_PATH (en local, en el `.env`; en CI, el
// ffmpeg instalado por el workflow). Sin ellas se omite y lo dice. Los videos de entrada los genera
// ffmpeg mismo con sus fuentes sintéticas: nada binario en el repositorio.

try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", "..", ".env"));
} catch {
  // sin .env: variables del entorno.
}
const tools = parseVideoToolsConfig(process.env);

describe.skipIf(!tools)("conversión de video con ffmpeg real (PP6, ADR-007)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "impulza-video-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function generate(name: string, args: string[]): string {
    const output = path.join(dir, name);
    const result = spawnSync(tools!.ffmpegPath, ["-hide_banner", "-loglevel", "error", ...args, "-y", output]);
    if (result.status !== 0) {
      throw new Error(`No se pudo generar ${name}: ${result.stderr.toString()}`);
    }
    return output;
  }

  function probeJson(file: string): {
    streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; avg_frame_rate?: string; pix_fmt?: string }>;
    format: { tags?: Record<string, string> };
  } {
    const result = spawnSync(tools!.ffprobePath, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
    return JSON.parse(result.stdout.toString());
  }

  // Video vertical de teléfono: 1080×1920 a 60 cuadros, con audio y metadatos (incluida una ubicación).
  const phone = () =>
    generate("telefono.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=60:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-metadata", "title=Secreto", "-metadata", "location=+33.4489-070.6693/",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      "-movflags", "+use_metadata_tags",
    ]);

  it("convierte a H.264 de 720p sin audio, sin metadatos, a 30 cuadros y con faststart", async () => {
    const input = phone();
    expect((await probeVideo(tools!, input, "video/mp4")).durationSeconds).toBeCloseTo(3, 0);

    const output = path.join(dir, "salida.mp4");
    await transcodeVideo(tools!, input, "video/mp4", output);
    const info = probeJson(output);

    expect(info.streams.map((stream) => stream.codec_type)).toEqual(["video"]);
    const [video] = info.streams;
    expect(video).toMatchObject({ codec_name: "h264", width: 720, height: 1280, pix_fmt: "yuv420p" });
    const [num, den] = video!.avg_frame_rate!.split("/").map(Number);
    expect(num! / den!).toBeLessThanOrEqual(30);
    expect(info.format.tags?.title).toBeUndefined();
    expect(info.format.tags?.location).toBeUndefined();
    expect(JSON.stringify(info)).not.toContain("33.4489");

    // faststart: el índice (`moov`) va antes de los datos (`mdat`), así se reproduce mientras baja.
    const bytes = readFileSync(output);
    expect(bytes.indexOf("moov")).toBeGreaterThan(0);
    expect(bytes.indexOf("moov")).toBeLessThan(bytes.indexOf("mdat"));

    // Póster a tamaño completo y un cuadro por segundo en miniatura para medir los tonos.
    const frames = path.join(dir, "cuadros");
    mkdirSync(frames);
    await extractVideoFrames(tools!, output, { posterPath: path.join(dir, "poster.png"), framesPattern: path.join(frames, "f%03d.png") });
    expect(readFileSync(path.join(dir, "poster.png")).subarray(1, 4).toString()).toBe("PNG");
    expect(readdirSync(frames).length).toBeGreaterThanOrEqual(3);
  });

  it("no agranda un video chico y deja dimensiones pares aunque el original sea impar", async () => {
    const input = generate("chico.webm", ["-f", "lavfi", "-i", "testsrc2=size=479x271:rate=24:duration=1", "-c:v", "libvpx", "-b:v", "200k"]);
    const output = path.join(dir, "chico.mp4");
    await transcodeVideo(tools!, input, "video/webm", output);
    const [video] = probeJson(output).streams;
    expect(video!.height).toBe(270);
    expect(video!.width! % 2).toBe(0);
    expect(video!.width!).toBeLessThanOrEqual(480);
  });

  it("rechaza un video de más de 15 segundos", async () => {
    const input = generate("largo.mp4", ["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=10:duration=20", "-c:v", "libx264", "-pix_fmt", "yuv420p"]);
    await expect(probeVideo(tools!, input, "video/mp4")).rejects.toThrow(/más de 15 segundos/);
  });

  it("un archivo que no es lo que dice no llega a convertirse: el demuxer está forzado", async () => {
    // Una lista de concatenación con nombre de video que intenta leer otro archivo del servidor. Con
    // ruta relativa, que el modo seguro de `concat` sí permite: lo único que la frena es el demuxer
    // forzado (sin él, ffmpeg la reconoce sola y lee el otro archivo como si fuera el subido).
    phone();
    const disguised = path.join(dir, "trampa.mp4");
    writeFileSync(disguised, "ffconcat version 1.0\nfile 'telefono.mp4'\n");
    await expect(probeVideo(tools!, disguised, "video/mp4")).rejects.toBeInstanceOf(VideoRejectedError);
    await expect(transcodeVideo(tools!, disguised, "video/mp4", path.join(dir, "trampa-salida.mp4"))).rejects.toThrow();
  });
});
