import { describe, expect, it } from "vitest";
import { attachmentDisposition } from "./adapter.js";
import { parseStorageConfig } from "./config.js";
import { productFileKey } from "./keys.js";
import { matchesDownloadType } from "./magic.js";
import { MemoryStorageAdapter } from "./memory-adapter.js";
import { privateStorageAdapter } from "./s3-adapter.js";

// F5.11b (ADR-015) — archivos en venta: bucket privado, tipo real y descarga con nombre.

function bytes(...parts: Array<string | number[]>): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const char of part) out.push(char.charCodeAt(0));
    else out.push(...part);
  }
  return new Uint8Array(out);
}

const ZIP_HEADER = [0x50, 0x4b, 0x03, 0x04];

describe("matchesDownloadType (bytes mágicos)", () => {
  it("reconoce cada formato admitido", () => {
    expect(matchesDownloadType(bytes("%PDF-1.7\n"), "application/pdf")).toBe(true);
    expect(matchesDownloadType(bytes(ZIP_HEADER, new Array(26).fill(0)), "application/zip")).toBe(true);
    // EPUB: ZIP cuyo primer archivo (nombre desde el byte 30) es `mimetype` con el tipo EPUB.
    const epub = bytes(ZIP_HEADER, new Array(26).fill(0), "mimetypeapplication/epub+zip");
    expect(matchesDownloadType(epub, "application/epub+zip")).toBe(true);
    expect(matchesDownloadType(bytes("ID3", [4, 0, 0]), "audio/mpeg")).toBe(true);
    expect(matchesDownloadType(bytes([0xff, 0xfb, 0x90, 0x00]), "audio/mpeg")).toBe(true);
    expect(matchesDownloadType(bytes([0, 0, 0, 0x18], "ftypisom", [0, 0, 0, 0]), "video/mp4")).toBe(true);
    expect(matchesDownloadType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png")).toBe(true);
    expect(matchesDownloadType(bytes([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).toBe(true);
  });

  it("rechaza un archivo que no es lo que dice", () => {
    const html = bytes("<!doctype html><script>");
    for (const type of ["application/pdf", "application/zip", "application/epub+zip", "audio/mpeg", "video/mp4", "image/png", "image/jpeg"] as const) {
      expect(matchesDownloadType(html, type), type).toBe(false);
    }
    // Un ZIP cualquiera no pasa por EPUB, ni un PNG por JPEG.
    expect(matchesDownloadType(bytes(ZIP_HEADER, new Array(26).fill(0), "mimetypetext/plain"), "application/epub+zip")).toBe(false);
    expect(matchesDownloadType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/jpeg")).toBe(false);
    expect(matchesDownloadType(new Uint8Array(), "application/pdf")).toBe(false);
  });
});

describe("attachmentDisposition", () => {
  it("fuerza la descarga con el nombre original, sin poder romper la cabecera", () => {
    expect(attachmentDisposition("Guía de cerámica.pdf")).toBe(`attachment; filename="Guia de ceramica.pdf"; filename*=UTF-8''Gu%C3%ADa%20de%20cer%C3%A1mica.pdf`);
    const tricky = attachmentDisposition('a"b\\c(1)*.pdf');
    expect(tricky).toContain('filename="abc(1)*.pdf"');
    expect(tricky).toContain("filename*=UTF-8''a%22b%5Cc%281%29%2A.pdf");
    expect(attachmentDisposition("日本.pdf")).toContain('filename=".pdf"');
  });
});

describe("bucket privado (ADR-015)", () => {
  const full = {
    STORAGE_ENDPOINT: "http://localhost:9010",
    STORAGE_BUCKET: "impulza-media",
    STORAGE_ACCESS_KEY_ID: "impulza",
    STORAGE_SECRET_ACCESS_KEY: "secreto-local",
    STORAGE_PUBLIC_BASE_URL: "http://localhost:9010/impulza-media",
  };

  it("es opcional; si está, se usa un adaptador con ese bucket", () => {
    expect(parseStorageConfig(full)?.privateBucket).toBeNull();
    expect(privateStorageAdapter(parseStorageConfig(full)!)).toBeNull();
    const config = parseStorageConfig({ ...full, STORAGE_PRIVATE_BUCKET: "impulza-private" })!;
    expect(config.privateBucket).toBe("impulza-private");
    expect(privateStorageAdapter(config)).not.toBeNull();
  });

  it("nunca igual al bucket público, ni sin el resto de la configuración", () => {
    expect(() => parseStorageConfig({ ...full, STORAGE_PRIVATE_BUCKET: "impulza-media" })).toThrow(/distinto/);
    expect(() => parseStorageConfig({ STORAGE_PRIVATE_BUCKET: "impulza-private" })).toThrow(/STORAGE_\*/);
  });

  it("la URL de descarga vence y lleva el nombre; la clave la decide el servidor", async () => {
    const key = productFileKey("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333");
    expect(key).toBe("org/11111111-1111-4111-8111-111111111111/products/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333");
    const before = Date.now();
    const download = await new MemoryStorageAdapter().createDownloadUrl({ key, expiresInSeconds: 300, fileName: "guía.pdf" });
    expect(download.url).toContain(key);
    expect(decodeURIComponent(download.url)).toContain("attachment;");
    expect(download.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 300_000);
  });
});
