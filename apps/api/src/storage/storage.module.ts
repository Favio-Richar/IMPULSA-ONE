import { Global, Module } from "@nestjs/common";
import { parseStorageConfig, parseVideoToolsConfig, S3StorageAdapter, type StorageAdapter, type VideoToolsConfig } from "@impulza/storage";

/** Adaptador de almacenamiento (ADR-006), o `null` si no hay credenciales configuradas. */
export const STORAGE = Symbol("STORAGE");
/** ffmpeg/ffprobe (PP6, ADR-007), o `null` si no están configurados. La API no ejecuta ffmpeg: solo
 *  lo usa para saber si aceptar subidas de video (las convierte el worker, con la misma regla). */
export const VIDEO_TOOLS = Symbol("VIDEO_TOOLS");

// Se lee al importar el módulo, igual que `env.ts`: una configuración a medias impide arrancar la
// API (ver `parseStorageConfig` y `parseVideoToolsConfig`); sin configuración, la API arranca y la
// biblioteca de medios responde "no configurado".
const storageConfig = parseStorageConfig(process.env);
const videoTools = parseVideoToolsConfig(process.env);

@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      useFactory: (): StorageAdapter | null => (storageConfig ? new S3StorageAdapter(storageConfig) : null),
    },
    { provide: VIDEO_TOOLS, useValue: videoTools satisfies VideoToolsConfig | null },
  ],
  exports: [STORAGE, VIDEO_TOOLS],
})
export class StorageModule {}
