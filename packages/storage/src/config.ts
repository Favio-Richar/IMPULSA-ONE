import { z } from "zod";

// Configuración del almacenamiento (ADR-006). Todo o nada:
// - sin ninguna variable, la API y el worker arrancan igual y la subida responde "almacenamiento no
//   configurado" (así se desarrolla y se prueba sin credenciales de R2);
// - con algunas sí y otras no, el proceso **no arranca**: una configuración a medias es casi siempre
//   un error de despliegue, y es mejor verlo al iniciar que en la primera subida de un cliente.
const storageEnvSchema = z.object({
  STORAGE_ENDPOINT: z.url(),
  STORAGE_REGION: z.string().min(1).default("auto"),
  STORAGE_BUCKET: z.string().min(3).max(63),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  // Dominio de lectura pública (CDN de R2 o, en local, el endpoint de MinIO con el bucket), sin "/".
  STORAGE_PUBLIC_BASE_URL: z.url().transform((value) => value.replace(/\/+$/, "")),
  // MinIO necesita rutas "endpoint/bucket/clave"; R2 acepta ambas formas.
  STORAGE_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Bucket privado para archivos en venta (F5.11b, ADR-015): mismas credenciales, sin lectura pública.
  // Opcional: sin él, la venta de archivos no se ofrece.
  STORAGE_PRIVATE_BUCKET: z.string().min(3).max(63).optional(),
});

const REQUIRED_KEYS = [
  "STORAGE_ENDPOINT",
  "STORAGE_BUCKET",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
  "STORAGE_PUBLIC_BASE_URL",
] as const;

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  forcePathStyle: boolean;
  /** Bucket privado de archivos en venta (ADR-015), o `null` si no está configurado. */
  privateBucket: string | null;
}

export function parseStorageConfig(source: Record<string, string | undefined>): StorageConfig | null {
  const present = REQUIRED_KEYS.filter((key) => source[key] !== undefined && source[key] !== "");
  if (present.length === 0) {
    if (source.STORAGE_PRIVATE_BUCKET) {
      throw new Error("STORAGE_PRIVATE_BUCKET necesita el resto de la configuración de almacenamiento (STORAGE_*).");
    }
    return null;
  }
  if (present.length !== REQUIRED_KEYS.length) {
    const missing = REQUIRED_KEYS.filter((key) => !present.includes(key));
    throw new Error(`Configuración de almacenamiento incompleta: faltan ${missing.join(", ")}.`);
  }
  const parsed = storageEnvSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Configuración de almacenamiento inválida en: ${fields}.`);
  }
  const env = parsed.data;
  // Un bucket privado igual al público dejaría los archivos en venta legibles por cualquiera.
  if (env.STORAGE_PRIVATE_BUCKET && env.STORAGE_PRIVATE_BUCKET === env.STORAGE_BUCKET) {
    throw new Error("STORAGE_PRIVATE_BUCKET tiene que ser un bucket distinto de STORAGE_BUCKET (ADR-015).");
  }
  return {
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    bucket: env.STORAGE_BUCKET,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    privateBucket: env.STORAGE_PRIVATE_BUCKET ?? null,
  };
}
