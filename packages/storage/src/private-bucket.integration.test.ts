import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseStorageConfig } from "./config.js";
import { productFileKey } from "./keys.js";
import { privateStorageAdapter } from "./s3-adapter.js";

// Bucket privado real contra MinIO (F5.11b, ADR-015): lo que se sube ahí NO se lee sin firma, y la
// URL de descarga firmada entrega el archivo con su nombre. Necesita `setup:local` con
// STORAGE_PRIVATE_BUCKET; sin esa variable se omite y lo dice.

try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", "..", ".env"));
} catch {
  // sin .env: variables del entorno.
}
const config = parseStorageConfig(process.env);
const storage = config ? privateStorageAdapter(config) : null;

describe.skipIf(!storage)("bucket privado contra MinIO (ADR-015)", () => {
  const body = new TextEncoder().encode("%PDF-1.7\nun archivo que se vende\n");

  it("sube por URL prefirmada; sin firma no se lee; la descarga firmada lo entrega con su nombre y se borra", async () => {
    const key = productFileKey(randomUUID(), randomUUID(), randomUUID());
    const upload = await storage!.createUploadUrl({ key, contentType: "application/pdf", contentLength: body.byteLength, expiresInSeconds: 60 });
    expect((await fetch(upload.url, { method: "PUT", headers: upload.headers, body })).status).toBe(200);
    expect(await storage!.head(key)).toMatchObject({ sizeBytes: body.byteLength, contentType: "application/pdf" });

    // Lectura directa sin firma (lo que haría alguien que adivina o filtra la clave): rechazada.
    const anonymous = await fetch(`${config!.endpoint.replace(/\/+$/, "")}/${config!.privateBucket}/${key}`);
    expect(anonymous.status).toBe(403);

    const download = await storage!.createDownloadUrl({ key, expiresInSeconds: 60, fileName: "Guía de cerámica.pdf" });
    const signed = await fetch(download.url);
    expect(signed.status).toBe(200);
    expect(signed.headers.get("content-disposition")).toContain("filename*=UTF-8''Gu%C3%ADa%20de%20cer%C3%A1mica.pdf");
    expect(new Uint8Array(await signed.arrayBuffer())).toEqual(body);

    await storage!.deleteObjects([key]);
    expect(await storage!.head(key)).toBeNull();
  });
});
