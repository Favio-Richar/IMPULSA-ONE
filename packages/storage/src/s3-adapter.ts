import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageAdapter, StoredObjectInfo, UploadTarget } from "./adapter.js";
import type { StorageConfig } from "./config.js";

/**
 * Adaptador S3 (ADR-006 §1). El mismo código sirve para Cloudflare R2 (producción) y MinIO
 * (desarrollo): cambia la configuración, no el código.
 */
export class S3StorageAdapter implements StorageAdapter {
  private readonly client: S3Client;

  constructor(private readonly config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async createUploadUrl(input: { key: string; contentType: string; contentLength: number; expiresInSeconds: number }): Promise<UploadTarget> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });
    // Tipo y tamaño van **firmados**: si el navegador manda otro tipo u otro tamaño, el proveedor
    // rechaza la subida porque la firma deja de ser válida.
    const url = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType ?? null };
    } catch (error) {
      if (error instanceof NotFound || (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)) {
        return null;
      }
      throw error;
    }
  }

  async readStart(key: string, length: number): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key, Range: `bytes=0-${length - 1}` }),
    );
    return (await result.Body?.transformToByteArray()) ?? new Uint8Array();
  }

  async getObject(key: string): Promise<Uint8Array> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    return (await result.Body?.transformToByteArray()) ?? new Uint8Array();
  }

  async putObject(input: { key: string; body: Uint8Array; contentType: string; cacheControl: string }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: input.cacheControl,
      }),
    );
  }

  async deleteObjects(keys: string[]): Promise<void> {
    // DeleteObjects acepta hasta 1000 claves por llamada.
    for (let index = 0; index < keys.length; index += 1000) {
      const batch = keys.slice(index, index + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.config.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }

  publicUrl(key: string): string {
    return `${this.config.publicBaseUrl}/${key}`;
  }
}
