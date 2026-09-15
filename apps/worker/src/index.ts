import { initSentry } from "@impulza/observability";
import { env } from "./env.js";
import { createHealthServer } from "./health-server.js";
import { logger } from "./observability/logger.js";

// Placeholder del worker — el procesamiento asíncrono real (BullMQ: analítica, emails, media,
// webhooks) se agrega cuando exista el primer job concreto, para no depender de una cola vacía
// sin uso (ver ARCHITECTURE.md §3 y docs/BACKLOG_FASE_0_1.md). F1.10 agrega lo mínimo exigible
// mientras tanto: logs JSON estructurados, /health y Sentry conectado.
initSentry({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  release: env.SENTRY_RELEASE,
  service: "impulza-worker",
});

createHealthServer().listen(env.WORKER_PORT, () => {
  logger.info("worker iniciado — en construcción (Fase 0), sin colas configuradas todavía", {
    port: env.WORKER_PORT,
  });
});
