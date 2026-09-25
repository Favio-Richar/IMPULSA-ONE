/**
 * ¿Dos configuraciones de bloque son el mismo valor? Sin importar el orden de las claves: PostgreSQL
 * guarda la configuración como JSONB, que **reordena las claves** (primero las más cortas), así que
 * lo que devuelve el servidor casi nunca tiene el mismo orden que lo que se envió. Comparar con
 * `JSON.stringify` a secas confundía el eco del propio autoguardado con un cambio externo, y el
 * panel reiniciaba el formulario y volvía a "Sin cambios" justo después de guardar (encontrado en
 * PP2 con la imagen de fondo de la portada: `{url, alt}` volvía como `{alt, url}`).
 */
export function sameConfig(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameConfig(item, b[index]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    // Una clave con `undefined` no llega al servidor (JSON la omite): cuenta como ausente.
    const left = Object.entries(a).filter(([, value]) => value !== undefined);
    const right = new Map(Object.entries(b).filter(([, value]) => value !== undefined));
    return left.length === right.size && left.every(([key, value]) => right.has(key) && sameConfig(value, right.get(key)));
  }
  return false;
}
