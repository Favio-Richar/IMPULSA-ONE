// Almacenamiento de medios (ADR-006): contrato con el proveedor, adaptadores, claves del bucket,
// verificación de tipo real y procesamiento de imágenes. Solo Node (usa sharp y el SDK de S3):
// nunca se importa desde un frontend.
export type { StorageAdapter, StoredObjectInfo, UploadTarget } from "./adapter.js";
export { parseStorageConfig, type StorageConfig } from "./config.js";
export { S3StorageAdapter } from "./s3-adapter.js";
export { MemoryStorageAdapter } from "./memory-adapter.js";
export { assetPrefix, originalKey, parseMediaUrl, variantKey } from "./keys.js";
export { detectImageType, MAGIC_BYTES_LENGTH } from "./magic.js";
export { MEDIA_PROCESS_QUEUE, type MediaProcessJob } from "./job.js";
export { processMediaAsset, type MediaProcessResult } from "./processor.js";
export { cleanupAbandonedMedia } from "./cleanup.js";
