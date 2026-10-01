import "./load-dotenv.js";
import { prisma } from "@impulza/database";
import { initSentry } from "@impulza/observability";
import { Redis } from "ioredis";
import { parseStorageConfig, parseVideoToolsConfig, privateStorageAdapter, S3StorageAdapter } from "@impulza/storage";
import { ConsoleEmailAdapter } from "@impulza/auth";
import { MercadoPagoGateway, MercadoPagoOAuth, WebpayOneclickGateway } from "@impulza/payments";
import { startAnalyticsWorkers } from "./analytics-workers.js";
import { startAutomationWorkers } from "./automations.js";
import { startBillingWorkers } from "./billing.js";
import { startPaymentAccountWorkers } from "./payment-accounts.js";
import { startBookingDepositWorkers } from "./booking-deposits.js";
import { startBookingReminderWorkers } from "./booking-reminders.js";
import { startCampaignDispatchWorkers } from "./campaign-dispatch.js";
import { env, mercadoPagoConfig, mercadoPagoOAuthConfig, webpayConfig } from "./env.js";
import { createHealthServer } from "./health-server.js";
import { startMediaWorkers } from "./media-workers.js";
import { emitWebhookEvent, startWebhookWorkers } from "./webhooks.js";
import { startNewsletterWorkers } from "./newsletter.js";
import { startSequenceWorkers } from "./sequences.js";
import { httpSiteRevalidator, startPageCampaignWorkers } from "./page-campaigns.js";
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
      privateStorage: privateStorageAdapter(storageConfig),
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

// Webhooks salientes (F7.2, ADR-017): los secretos se guardan cifrados; sin la clave no se entregan.
const webhooks = env.AUTH_ENCRYPTION_KEY
  ? await startWebhookWorkers({
      prisma,
      email: new ConsoleEmailAdapter(),
      connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
      encryptionKey: env.AUTH_ENCRYPTION_KEY,
      dashboardBaseUrl: env.APP_BASE_URL,
    })
  : null;
if (!webhooks) {
  logger.warn("Sin AUTH_ENCRYPTION_KEY: la entrega de webhooks no se inicia");
}

// Señas de reservas (F5.10): libera cada minuto las horas cuya seña no se pagó a tiempo. La reserva
// liberada también avisa por webhook (`booking.cancelled`).
const bookingDeposits = await startBookingDepositWorkers({
  prisma,
  email: new ConsoleEmailAdapter(),
  connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
  onReleased: webhooks
    ? (booking) => emitWebhookEvent(prisma, webhooks.queue, { organizationId: booking.organizationId, type: "booking.cancelled", subjectId: booking.id })
    : undefined,
});

// Newsletter (F7.4, ADR-019): purga diaria de solicitudes que ya no hacen falta.
const newsletter = await startNewsletterWorkers({ prisma, connection: { url: env.REDIS_URL, maxRetriesPerRequest: null } });

// Campañas de email (F5.6): el enlace de baja se firma con el mismo secreto de enlaces de correo.
const campaignDispatch = await startCampaignDispatchWorkers({
  prisma,
  email: new ConsoleEmailAdapter(),
  connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
  publicSiteBaseUrl: env.PUBLIC_SITE_BASE_URL,
  linkSecret: env.BOOKING_LINK_SECRET,
});

// Secuencias de correo (F7.5, ADR-020): mismo secreto de enlaces firmados que las campañas (baja).
const sequences = await startSequenceWorkers({
  prisma,
  email: new ConsoleEmailAdapter(),
  connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
  publicSiteBaseUrl: env.PUBLIC_SITE_BASE_URL,
  linkSecret: env.BOOKING_LINK_SECRET,
});

// Modo campaña (F7.7, ADR-022): al empezar y terminar cada campaña se invalida la caché del sitio.
// Sin apps/web configurada no corre (y lo dice): las marcas quedan para cuando se configure.
const pageCampaigns =
  env.WEB_APP_URL && env.WEB_REVALIDATE_SECRET
    ? await startPageCampaignWorkers({
        prisma,
        connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
        revalidate: httpSiteRevalidator(env.WEB_APP_URL, env.WEB_REVALIDATE_SECRET),
      })
    : null;
if (!pageCampaigns) {
  logger.warn("page_campaign.disabled", { reason: "Sin WEB_APP_URL o WEB_REVALIDATE_SECRET: las campañas cambian en la próxima publicación." });
}

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
// Mercado Pago (F4.6b) cobra solo; el ciclo concilia sus avisos perdidos y cancela allá lo que cierra.
const webpayReady = Boolean(webpayConfig && env.AUTH_ENCRYPTION_KEY);
const billing =
  (webpayReady || mercadoPagoConfig) && env.AUTH_ENCRYPTION_KEY
    ? await startBillingWorkers({
        prisma,
        connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
        gateway: webpayReady ? new WebpayOneclickGateway(webpayConfig!) : null,
        mercadoPago: mercadoPagoConfig ? new MercadoPagoGateway(mercadoPagoConfig) : null,
        email: new ConsoleEmailAdapter(),
        encryptionKey: env.AUTH_ENCRYPTION_KEY,
        dashboardBaseUrl: env.APP_BASE_URL,
      })
    : null;
if (!billing) {
  logger.warn("Sin pasarela de pago configurada (o sin AUTH_ENCRYPTION_KEY): el ciclo de facturación no se inicia");
}

// Cuentas de Mercado Pago de los negocios (F5.8, ADR-013): renovación diaria de sus tokens.
const paymentAccounts =
  mercadoPagoOAuthConfig && env.AUTH_ENCRYPTION_KEY
    ? await startPaymentAccountWorkers({
        prisma,
        connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
        oauth: new MercadoPagoOAuth(mercadoPagoOAuthConfig),
        email: new ConsoleEmailAdapter(),
        encryptionKey: env.AUTH_ENCRYPTION_KEY,
        dashboardBaseUrl: env.APP_BASE_URL,
      })
    : null;

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
  await bookingDeposits.close();
  await campaignDispatch.close();
  await automations.close();
  await billing?.close();
  await paymentAccounts?.close();
  await webhooks?.close();
  await newsletter.close();
  await sequences.close();
  await pageCampaigns?.close();
  healthRedis.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
