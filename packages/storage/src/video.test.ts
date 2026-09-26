import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectImageType, detectVideoType } from "./magic.js";
import { combineTones } from "./processor.js";
import { parseVideoToolsConfig } from "./video.js";

function bytes(...parts: Array<string | number[]>): Uint8Array {
  return new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? [...part].map((char) => char.charCodeAt(0)) : part)));
}

describe("detectVideoType (bytes mágicos, PP6)", () => {
  it("reconoce MP4, MOV de iPhone y WebM", () => {
    expect(detectVideoType(bytes([0, 0, 0, 0x20], "ftypisom", [0, 0, 2, 0], "isomiso2avc1mp41"))).toBe("video/mp4");
    expect(detectVideoType(bytes([0, 0, 0, 0x14], "ftypqt  ", [0, 0, 0, 0], "qt  "))).toBe("video/quicktime");
    expect(detectVideoType(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84], "webm"))).toBe("video/webm");
  });

  it("no confunde una imagen AVIF/HEIC con un video, ni un Matroska que no es WebM", () => {
    expect(detectVideoType(bytes([0, 0, 0, 0x1c], "ftypavif", [0, 0, 0, 0], "avifmif1miaf"))).toBeNull();
    expect(detectVideoType(bytes([0, 0, 0, 0x18], "ftypheic", [0, 0, 0, 0], "mif1heic"))).toBeNull();
    expect(detectVideoType(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88], "matroska"))).toBeNull();
    // Y al revés: un MP4 nunca pasa como imagen.
    expect(detectImageType(bytes([0, 0, 0, 0x20], "ftypisom", [0, 0, 2, 0], "isomiso2avc1mp41"))).toBeNull();
  });

  it("rechaza lo que se disfraza de video: HTML, una lista de concatenación o una lista HLS", () => {
    expect(detectVideoType(bytes("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(detectVideoType(bytes("ffconcat version 1.0\nfile '/etc/passwd'\n"))).toBeNull();
    expect(detectVideoType(bytes("#EXTM3U\n#EXT-X-TARGETDURATION:10\n"))).toBeNull();
    expect(detectVideoType(new Uint8Array())).toBeNull();
  });
});

describe("combineTones (PP6)", () => {
  it("toma el tono más oscuro y el más claro entre todos los cuadros", () => {
    expect(
      combineTones([
        { darkest: "#303030", lightest: "#909090" },
        { darkest: "#101010", lightest: "#a0a0a0" },
        { darkest: "#202020", lightest: "#f0f0f0" },
      ]),
    ).toEqual({ darkest: "#101010", lightest: "#f0f0f0" });
  });
});

describe("parseVideoToolsConfig (ADR-007)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "impulza-tools-"));
  const ffmpeg = path.join(dir, "ffmpeg");
  const ffprobe = path.join(dir, "ffprobe");
  writeFileSync(ffmpeg, "");
  writeFileSync(ffprobe, "");

  it("sin ninguna variable: video deshabilitado, sin error", () => {
    expect(parseVideoToolsConfig({})).toBeNull();
    expect(parseVideoToolsConfig({ FFMPEG_PATH: " ", FFPROBE_PATH: "" })).toBeNull();
  });

  it("con las dos rutas existentes: configurado", () => {
    expect(parseVideoToolsConfig({ FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe })).toEqual({ ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  });

  it("a medias o con una ruta inexistente, el proceso no arranca", () => {
    expect(() => parseVideoToolsConfig({ FFMPEG_PATH: ffmpeg })).toThrow(/FFPROBE_PATH/);
    expect(() => parseVideoToolsConfig({ FFPROBE_PATH: ffprobe })).toThrow(/FFMPEG_PATH/);
    expect(() => parseVideoToolsConfig({ FFMPEG_PATH: path.join(dir, "no-existe"), FFPROBE_PATH: ffprobe })).toThrow(/no existe/);
  });
});
