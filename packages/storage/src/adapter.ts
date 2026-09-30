/**
 * Contrato con el proveedor de almacenamiento (ST §3.4, ADR-006). Todo el sistema habla con esto,
 * nunca con el SDK de un proveedor: R2 en producción, MinIO en desarrollo y un adaptador en memoria
 * en las pruebas son intercambiables.
 */
export interface UploadTarget {
  url: string;
  method: "PUT";
  /** Cabeceras que el navegador **debe** enviar tal cual: van firmadas en la URL. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StoredObjectInfo {
  sizeBytes: number;
  contentType: string | null;
}

export interface StorageAdapter {
  /** URL prefirmada para subir exactamente `contentLength` bytes de `contentType` a `key`. */
  createUploadUrl(input: { key: string; contentType: string; contentLength: number; expiresInSeconds: number }): Promise<UploadTarget>;
  head(key: string): Promise<StoredObjectInfo | null>;
  /** Los primeros `length` bytes (para verificar el tipo real por bytes mágicos). */
  readStart(key: string, length: number): Promise<Uint8Array>;
  getObject(key: string): Promise<Uint8Array>;
  putObject(input: { key: string; body: Uint8Array; contentType: string; cacheControl: string }): Promise<void>;
  deleteObjects(keys: string[]): Promise<void>;
  /** URL pública de lectura (dominio de medios / CDN). */
  publicUrl(key: string): string;
  /**
   * URL prefirmada de **lectura** que vence en `expiresInSeconds` y fuerza la descarga con el nombre
   * dado (F5.11b, ADR-015). Es la única forma de leer un objeto del bucket privado.
   */
  createDownloadUrl(input: { key: string; expiresInSeconds: number; fileName: string }): Promise<{ url: string; expiresAt: Date }>;
}

/**
 * `Content-Disposition` de descarga con el nombre original: versión ASCII segura y `filename*` en
 * UTF-8 (RFC 6266), sin comillas ni saltos que puedan romper la cabecera.
 */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "").trim() || "archivo";
  // RFC 5987: `'`, `(`, `)` y `*` tampoco van sin codificar (encodeURIComponent los deja pasar).
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
