import type { ImageMimeType } from "@impulza/validation";

/** Bytes necesarios para reconocer cualquiera de los formatos permitidos. */
export const MAGIC_BYTES_LENGTH = 32;

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

/**
 * Tipo real de una imagen por su firma binaria (ADR-006 §3). No se confía en la extensión ni en el
 * `Content-Type` que declaró el navegador: un `.jpg` que en realidad es HTML o SVG se rechaza.
 */
export function detectImageType(bytes: Uint8Array): ImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((value, index) => bytes[index] === value)) {
    return "image/png";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  // ISO-BMFF: [tamaño de la caja][ftyp][marca principal][versión][marcas compatibles...]
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brands = ascii(bytes, 8, Math.min(bytes.length, MAGIC_BYTES_LENGTH));
    if (brands.includes("avif") || brands.includes("avis")) {
      return "image/avif";
    }
  }
  return null;
}
