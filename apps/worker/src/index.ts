import "./load-dotenv.js";
import { prisma } from "@impulza/database";
import { initSentry } from "@impulza/observability";
import { Redis } from "ioredis";
import { parseStorageConfig, S3StorageAdapter } from "@impulza/storage";
import { startAnalyticsWorkers } from "./analytics-workers.js";
import { env } from "./env.js";
import { createHealthServer } from "./health-server.js";
import { startMediaWorkers } from "./media-workers.js";
import { logger } from "./observability/logger.js";

initSentry({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  release: env.SENTRY_RELEASE,
  service: "impulza-worker",
});

// Cliente aparte solo para el chequeo de salud: las conexiones de BullMQ son suyas y no se
// comparten (BullMQ exige `maxRetriesPerRequest: null`, que no sirve para un ping con timeout).
const healthRedis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

const workers = await startAnalyticsWorkers({
  prisma,
  connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
  retentionMonths: env.ANALYTICS_RETENTION_MONTHS,
  contactReviewMonths: env.CONTACT_RETENTION_REVIEW_MONTHS,
});

// Medios (ADR-006): solo si hay almacenamiento configurado. Una configuración a medias lanza acá y el
// worker no arranca, igual que la API.
const storageConfig = parseStorageConfig(process.env);
const mediaWorkers = storageConfig
  ? await startMediaWorkers({
      prisma,
      storage: new S3StorageAdapter(storageConfig),
      connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
    })
  : null;
if (!mediaWorkers) {
  logger.warn("almacenamiento no configurado: el procesamiento de medios no se inicia");
}

const healthServer = createHealthServer([
  {
    name: "database",
    check: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
  },
  {
    name: "redis",
    check: async () => {
      await healthRedis.ping();
    },
  },
]);

healthServer.listen(env.WORKER_PORT, () => {
  logger.info("worker iniciado — procesando la cola de analítica", {
    port: env.WORKER_PORT,
    retentionMonths: env.ANALYTICS_RETENTION_MONTHS,
  });
});

// Apagado ordenado: BullMQ termina el job en curso antes de cerrar, así un deploy no deja un
// evento a medio procesar (igual se reintentaría, pero sin ruido en la dead-letter).
async function shutdown(signal: string): Promise<void> {
  logger.info("worker deteniéndose", { signal });
  healthServer.close();
  await workers.close();
  await mediaWorkers?.close();
  healthRedis.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
