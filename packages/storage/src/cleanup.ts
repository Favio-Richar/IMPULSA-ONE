import { MediaStatus, type PrismaClient, ProductFileStatus } from "@impulza/database";
import type { StorageAdapter } from "./adapter.js";
import { originalKey, productFileKey } from "./keys.js";

/** Una URL prefirmada vence a los 10 minutos: pasada una hora, nadie va a confirmar esa subida. */
const ABANDONED_UPLOAD_MS = 60 * 60 * 1000;
/** El aviso de "no se pudo procesar" se muestra una semana en la biblioteca. */
const FAILED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Subidas pedidas y nunca confirmadas, y fallidas viejas: se borran filas y objetos (si el navegador
 * alcanzó a subir algo). Así no ocupan cuota ni espacio en el bucket.
 */
export async function cleanupAbandonedMedia(prisma: PrismaClient, storage: StorageAdapter, now = new Date()): Promise<number> {
  const stale = await prisma.mediaAsset.findMany({
    where: {
      OR: [
        { status: MediaStatus.PENDING_UPLOAD, createdAt: { lt: new Date(now.getTime() - ABANDONED_UPLOAD_MS) } },
        { status: MediaStatus.FAILED, updatedAt: { lt: new Date(now.getTime() - FAILED_RETENTION_MS) } },
      ],
    },
    select: { id: true, organizationId: true },
    take: 500,
  });
  if (stale.length === 0) {
    return 0;
  }
  await storage.deleteObjects(stale.map((asset) => originalKey(asset.organizationId, asset.id)));
  await prisma.mediaAsset.deleteMany({ where: { id: { in: stale.map((asset) => asset.id) } } });
  return stale.length;
}

/**
 * Lo mismo para los archivos en venta del bucket privado (F5.11b, ADR-015): subidas pedidas y nunca
 * confirmadas, y rechazadas viejas. Un archivo `READY` nunca se toca acá.
 */
export async function cleanupAbandonedProductFiles(
  prisma: PrismaClient,
  privateStorage: StorageAdapter,
  now = new Date(),
  /** Solo para pruebas: con el reloj adelantado, nunca tocar archivos de otras suites que corren a la vez. */
  scope: { organizationId?: string } = {},
): Promise<number> {
  const stale = await prisma.productFile.findMany({
    where: {
      ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
      OR: [
        { status: ProductFileStatus.PENDING_UPLOAD, createdAt: { lt: new Date(now.getTime() - ABANDONED_UPLOAD_MS) } },
        { status: ProductFileStatus.FAILED, createdAt: { lt: new Date(now.getTime() - FAILED_RETENTION_MS) } },
      ],
    },
    select: { id: true, organizationId: true, productId: true },
    take: 500,
  });
  if (stale.length === 0) {
    return 0;
  }
  await privateStorage.deleteObjects(stale.map((file) => productFileKey(file.organizationId, file.productId, file.id)));
  await prisma.productFile.deleteMany({ where: { id: { in: stale.map((file) => file.id) }, status: { not: ProductFileStatus.READY } } });
  return stale.length;
}
