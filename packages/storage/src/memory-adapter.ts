import { attachmentDisposition, type StorageAdapter, type StoredObjectInfo, type UploadTarget } from "./adapter.js";

interface StoredObject {
  body: Uint8Array;
  contentType: string;
  cacheControl?: string;
}

/**
 * Adaptador en memoria para pruebas (mismo criterio que el adaptador falso de email): ejercita el
 * flujo completo (URL de subida, confirmación, procesamiento, borrado) sin un bucket real.
 * `simulateUpload` hace lo que haría el navegador con la URL prefirmada.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  readonly objects = new Map<string, StoredObject>();
  private readonly pendingUploads = new Map<string, { contentType: string }>();

  constructor(private readonly publicBaseUrl = "https://media.test") {}

  async createUploadUrl(input: { key: string; contentType: string; contentLength: number; expiresInSeconds: number }): Promise<UploadTarget> {
    this.pendingUploads.set(input.key, { contentType: input.contentType });
    return {
      url: `memory://upload/${input.key}`,
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  /** Igual que R2, rechaza una subida que no se pidió o con otro tipo que el firmado. El tamaño se
   *  deja pasar a propósito, para poder probar que el servidor lo verifica al confirmar. */
  simulateUpload(url: string, body: Uint8Array, contentType: string): void {
    const key = url.replace("memory://upload/", "");
    const pending = this.pendingUploads.get(key);
    if (!pending || pending.contentType !== contentType) {
      throw new Error("Firma inválida: la subida no coincide con la URL prefirmada.");
    }
    this.objects.set(key, { body, contentType });
    this.pendingUploads.delete(key);
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    const object = this.objects.get(key);
    return object ? { sizeBytes: object.body.byteLength, contentType: object.contentType } : null;
  }

  async readStart(key: string, length: number): Promise<Uint8Array> {
    return (this.objects.get(key)?.body ?? new Uint8Array()).slice(0, length);
  }

  async getObject(key: string): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (!object) {
      throw new Error(`No existe el objeto ${key}`);
    }
    return object.body;
  }

  async putObject(input: { key: string; body: Uint8Array; contentType: string; cacheControl: string }): Promise<void> {
    this.objects.set(input.key, { body: input.body, contentType: input.contentType, cacheControl: input.cacheControl });
  }

  async deleteObjects(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.objects.delete(key);
    }
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  /** URL de descarga simulada: lleva la clave, el vencimiento y el nombre, como la firmada de verdad. */
  async createDownloadUrl(input: { key: string; expiresInSeconds: number; fileName: string }): Promise<{ url: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
    return {
      url: `memory://download/${input.key}?expires=${expiresAt.getTime()}&disposition=${encodeURIComponent(attachmentDisposition(input.fileName))}`,
      expiresAt,
    };
  }

  keysWithPrefix(prefix: string): string[] {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
  }
}
