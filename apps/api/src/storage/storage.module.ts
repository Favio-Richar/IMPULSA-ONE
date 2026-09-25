import { Global, Module } from "@nestjs/common";
import { parseStorageConfig, S3StorageAdapter, type StorageAdapter } from "@impulza/storage";

/** Adaptador de almacenamiento (ADR-006), o `null` si no hay credenciales configuradas. */
export const STORAGE = Symbol("STORAGE");

// Se lee al importar el módulo, igual que `env.ts`: una configuración a medias impide arrancar la
// API (ver `parseStorageConfig`); sin configuración, la API arranca y la biblioteca de medios
// responde "almacenamiento no configurado".
const storageConfig = parseStorageConfig(process.env);

@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      useFactory: (): StorageAdapter | null => (storageConfig ? new S3StorageAdapter(storageConfig) : null),
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
