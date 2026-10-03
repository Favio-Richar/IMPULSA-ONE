import { z } from "zod";
import { HEX_COLOR_PATTERN } from "../contrast.js";

export function isDevelopment(): boolean {
  // Este paquete corre en el navegador y en Node, y no declara tipos de Node: se lee `process` sin ellos.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.NODE_ENV !== "production";
}

/**
 * URL absoluta segura para un recurso (logo, favicon): `https://` siempre; `http://` solo para
 * `localhost` / `127.0.0.1` **exactos** y fuera de producción. Se compara el hostname ya interpretado
 * (`new URL`), nunca el comienzo del texto: `http://localhost.evil.com` no es localhost.
 */
export function isSafeAssetUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && isDevelopment() && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

/** Enlace para el pie y la ayuda: URL absoluta segura o ruta interna (`/privacidad`, nunca `//host`). */
export function isSafeLinkUrl(value: string): boolean {
  if (value.startsWith("/")) {
    if (value.startsWith("//") || value.includes("\\")) return false;
    // Sin espacios ni caracteres de control (se compara por código: el lint prohíbe controles en regex).
    return ![...value].some((char) => char.charCodeAt(0) <= 0x20 || char.charCodeAt(0) === 0x7f);
  }
  return isSafeAssetUrl(value);
}

export const hexColorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR_PATTERN, "Debe ser un color hexadecimal válido de 6 caracteres (ej. #0f6f6b).");
