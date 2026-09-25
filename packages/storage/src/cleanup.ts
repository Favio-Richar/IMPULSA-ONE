import { MediaStatus, type PrismaClient } from "@impulza/database";
import type { StorageAdapter } from "./adapter.js";
import { originalKey } from "./keys.js";

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
