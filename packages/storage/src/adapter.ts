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
}
