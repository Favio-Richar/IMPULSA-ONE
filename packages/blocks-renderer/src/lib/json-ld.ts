/**
 * JSON para un `<script type="application/ld+json">`. El texto viene del negocio: `JSON.stringify`
 * no escapa `<`, así que un nombre con `</script><script>…` cerraría la etiqueta y ejecutaría código.
 * Se escapan `<`, `>`, `&` y los separadores de línea U+2028/U+2029 como secuencias de escape JSON
 * de 4 dígitos hexadecimales (JSON válido: el valor leído es el mismo).
 */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const BACKSLASH = String.fromCharCode(0x5c);

/** Secuencia de escape JSON del carácter (barra invertida, `u` y su código en 4 dígitos). */
function jsonEscape(char: string): string {
  return `${BACKSLASH}u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&]/g, jsonEscape).replaceAll(LINE_SEPARATOR, jsonEscape).replaceAll(PARAGRAPH_SEPARATOR, jsonEscape);
}
