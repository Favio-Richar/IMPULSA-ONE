import "./load-dotenv.js";
import { prisma } from "@impulza/database";
import { initSentry } from "@impulza/observability";
import { Redis } from "ioredis";
import { parseStorageConfig, parseVideoToolsConfig, S3StorageAdapter } from "@impulza/storage";
import { ConsoleEmailAdapter } from "@impulza/auth";
import { WebpayOneclickGateway } from "@impulza/payments";
import { startAnalyticsWorkers } from "./analytics-workers.js";
import { startAutomationWorkers } from "./automations.js";
import { startBillingWorkers } from "./billing.js";
import { startBookingReminderWorkers } from "./booking-reminders.js";
import { startCampaignDispatchWorkers } from "./campaign-dispatch.js";
import { env, webpayConfig } from "./env.js";
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
// Video (PP6, ADR-007): ffmpeg y ffprobe del sistema, todo o nada. A medias, el worker no arranca.
const videoTools = parseVideoToolsConfig(process.env);
const mediaWorkers = storageConfig
  ? await startMediaWorkers({
      prisma,
      storage: new S3StorageAdapter(storageConfig),
      connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
      videoTools,
    })
  : null;
if (!mediaWorkers) {
  logger.warn("almacenamiento no configurado: el procesamiento de medios no se inicia");
} else if (!videoTools) {
  logger.warn("ffmpeg no configurado: la cola de video no se inicia (FFMPEG_PATH/FFPROBE_PATH)");
}

// Recordatorios de reservas (F5.4). Correo por consola hasta que exista un proveedor real
// (ARCHITECTURE.md §5), igual que en la API.
const bookingReminders = await startBookingReminderWorkers({
  prisma,
  email: new ConsoleEmailAdapter(),
  connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
  publicSiteBaseUrl: env.PUBLIC_SITE_BASE_URL,
  bookingLinkSecret: env.BOOKING_LINK_SECRET,
});

// Campañas de email (F5.6): el enlace de baja se firma con el mismo secreto de enlaces de correo.
const campaignDispatch = await startCampaignDispatchWorkers({
  prisma,
  email: new ConsoleEmailAdapter(),
  connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
  publicSiteBaseUrl: env.PUBLIC_SITE_BASE_URL,
  linkSecret: env.BOOKING_LINK_SECRET,
});

// Automatizaciones (F6.7): disparador → acción, una vez por evento. Aviso al equipo por consola hasta
// que exista un proveedor de correo real, igual que el resto de los correos.
const automations = startAutomationWorkers({
  prisma,
  email: new ConsoleEmailAdapter(),
  connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
  dashboardBaseUrl: env.APP_BASE_URL,
});

// Renovación de suscripciones (F4.6a, ADR-012): Webpay Oneclick no cobra solo, lo hace este ciclo.
// Sin credenciales de Webpay o sin la clave de cifrado no corre (y lo dice): nadie queda cobrado a medias.
const billing =
  webpayConfig && env.AUTH_ENCRYPTION_KEY
    ? await startBillingWorkers({
        prisma,
        connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
        gateway: new WebpayOneclickGateway(webpayConfig),
        email: new ConsoleEmailAdapter(),
        encryptionKey: env.AUTH_ENCRYPTION_KEY,
        dashboardBaseUrl: env.APP_BASE_URL,
      })
    : null;
if (!billing) {
  logger.warn("Webpay o AUTH_ENCRYPTION_KEY no configurados: la renovación de suscripciones no se inicia");
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
  await bookingReminders.close();
  await campaignDispatch.close();
  await automations.close();
  await billing?.close();
  healthRedis.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
