// Claves del bucket (ADR-006 §2). Las decide siempre el servidor; el nombre del archivo que eligió
// el usuario nunca forma parte de la ruta.

export function assetPrefix(organizationId: string, assetId: string): string {
  return `org/${organizationId}/${assetId}/`;
}

export function originalKey(organizationId: string, assetId: string): string {
  return `${assetPrefix(organizationId, assetId)}original`;
}

export function variantKey(organizationId: string, assetId: string, width: number): string {
  return `${assetPrefix(organizationId, assetId)}w${width}.webp`;
}

/** Video convertido (PP6). El póster usa las mismas claves `wN.webp` que una imagen. */
export function videoKey(organizationId: string, assetId: string): string {
  return `${assetPrefix(organizationId, assetId)}video.mp4`;
}

/** Archivo en venta de un producto (F5.11b), en el bucket privado. */
export function productFileKey(organizationId: string, productId: string, fileId: string): string {
  return `org/${organizationId}/products/${productId}/${fileId}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MEDIA_PATH = new RegExp(`^org/(${UUID})/(${UUID})/`, "i");

/**
 * Si `url` apunta a un medio propio (`{publicBaseUrl}/org/{org}/{asset}/...`), devuelve de qué
 * organización y asset es; si no, `null`. Sirve para rechazar que un bloque use medios de otra
 * organización (ADR-006 §9) y para saber qué assets usa una página.
 */
export function parseMediaUrl(url: string, publicBaseUrl: string): { organizationId: string; assetId: string } | null {
  const base = publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`;
  if (!url.startsWith(base)) {
    return null;
  }
  const match = MEDIA_PATH.exec(url.slice(base.length));
  return match ? { organizationId: match[1]!.toLowerCase(), assetId: match[2]!.toLowerCase() } : null;
}
