import type { DownloadMimeType, ImageMimeType, VideoMimeType } from "@impulza/validation";

/** Bytes necesarios para reconocer cualquiera de los formatos permitidos (el tipo de documento de un
 *  WebM puede aparecer pasados los primeros 32 bytes de su cabecera EBML). */
export const MAGIC_BYTES_LENGTH = 64;

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

/** Marcas ISO-BMFF de imagen: con ellas, un `ftyp` es AVIF/HEIF y no un video. */
const IMAGE_BRANDS = ["avif", "avis", "heic", "heix", "mif1", "msf1"];

/**
 * Tipo real de un video por su firma binaria (PP6, ADR-007). El resultado decide también el demuxer
 * que usa ffmpeg (nunca autodetectado), así que un archivo que no es lo que dice no llega a él.
 *
 * - MP4 y MOV son ISO-BMFF (`ftyp` en el byte 4): la marca `qt  ` es un MOV de iPhone; cualquier otra
 *   que no sea de imagen, un MP4.
 * - WebM es Matroska (cabecera EBML `1A 45 DF A3`) con tipo de documento `webm`.
 */
export function detectVideoType(bytes: Uint8Array): VideoMimeType | null {
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const major = ascii(bytes, 8, 12);
    const brands = ascii(bytes, 8, Math.min(bytes.length, MAGIC_BYTES_LENGTH));
    if (IMAGE_BRANDS.some((brand) => brands.includes(brand))) {
      return null;
    }
    return major === "qt  " ? "video/quicktime" : "video/mp4";
  }
  const ebml = [0x1a, 0x45, 0xdf, 0xa3];
  if (bytes.length >= 4 && ebml.every((value, index) => bytes[index] === value)) {
    return ascii(bytes, 4, Math.min(bytes.length, MAGIC_BYTES_LENGTH)).includes("webm") ? "video/webm" : null;
  }
  return null;
}

/**
 * ¿Los primeros bytes corresponden al tipo declarado de un archivo en venta (F5.11b, ADR-015)? Mismo
 * criterio que las imágenes: el archivo tiene que ser lo que dice, no se confía en la extensión.
 * EPUB es un ZIP cuyo primer archivo es `mimetype` con `application/epub+zip` (especificación OCF).
 */
export function matchesDownloadType(bytes: Uint8Array, declared: DownloadMimeType): boolean {
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  switch (declared) {
    case "application/pdf":
      return bytes.length >= 5 && ascii(bytes, 0, 5) === "%PDF-";
    case "application/zip":
      return isZip;
    case "application/epub+zip":
      return isZip && ascii(bytes, 30, Math.min(bytes.length, MAGIC_BYTES_LENGTH)).startsWith("mimetypeapplication/epub+zip");
    case "audio/mpeg":
      // Etiqueta ID3 al comienzo, o directamente un cuadro MPEG (11 bits de sincronía en 1).
      return (bytes.length >= 3 && ascii(bytes, 0, 3) === "ID3") || (bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0);
    case "video/mp4":
      return detectVideoType(bytes) === "video/mp4";
    case "image/png":
    case "image/jpeg":
      return detectImageType(bytes) === declared;
  }
}
