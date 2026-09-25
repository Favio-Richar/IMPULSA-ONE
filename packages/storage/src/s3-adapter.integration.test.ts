import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseStorageConfig } from "./config.js";
import { originalKey } from "./keys.js";
import { S3StorageAdapter } from "./s3-adapter.js";

// Adaptador S3 real contra MinIO (el mismo protocolo que Cloudflare R2). Necesita el bucket local:
// `docker compose --profile storage up -d minio` + `pnpm --filter @impulza/storage run setup:local`.
// En CI corre con el servicio MinIO del workflow. Sin variables STORAGE_* se omite y lo dice.

try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", "..", ".env"));
} catch {
  // sin .env: variables del entorno.
}
const config = parseStorageConfig(process.env);

describe.skipIf(!config)("S3StorageAdapter contra MinIO (ADR-006)", () => {
  const storage = new S3StorageAdapter(config!);
  const jpegStart = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const body = new Uint8Array([...jpegStart, ...new Uint8Array(1014).fill(7)]);

  function key(): string {
    return originalKey(randomUUID(), randomUUID());
  }

  it("sube por URL prefirmada, verifica, sirve público y borra", async () => {
    const target = key();
    const upload = await storage.createUploadUrl({ key: target, contentType: "image/jpeg", contentLength: body.byteLength, expiresInSeconds: 60 });
    const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body });
    expect(put.status).toBe(200);

    expect(await storage.head(target)).toMatchObject({ sizeBytes: body.byteLength, contentType: "image/jpeg" });
    expect(Array.from(await storage.readStart(target, 4))).toEqual([0xff, 0xd8, 0xff, 0xe0]);

    const publicGet = await fetch(storage.publicUrl(target));
    expect(publicGet.status).toBe(200);
    expect(new Uint8Array(await publicGet.arrayBuffer()).byteLength).toBe(body.byteLength);

    await storage.deleteObjects([target]);
    expect(await storage.head(target)).toBeNull();
  });

  it("rechaza una subida con otro tipo o con otro tamaño que el firmado", async () => {
    const target = key();
    const upload = await storage.createUploadUrl({ key: target, contentType: "image/jpeg", contentLength: body.byteLength, expiresInSeconds: 60 });

    const wrongType = await fetch(upload.url, { method: "PUT", headers: { "Content-Type": "text/html" }, body });
    expect(wrongType.ok).toBe(false);
    const wrongSize = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: body.slice(0, 100) });
    expect(wrongSize.ok).toBe(false);
    expect(await storage.head(target)).toBeNull();
  });

  it("head de una clave inexistente devuelve null, no un error", async () => {
    expect(await storage.head(key())).toBeNull();
  });

  it("putObject guarda tipo y caché para las variantes", async () => {
    const target = key();
    await storage.putObject({ key: target, body, contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" });
    const response = await fetch(storage.publicUrl(target));
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("immutable");
    await storage.deleteObjects([target]);
  });
});
