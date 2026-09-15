// Logs estructurados, correlación de request/trace y errores compartidos entre apps/api y
// apps/worker (F1.10). Ver docs/BACKLOG_FASE_0_1.md y ARCHITECTURE.md §2/§3.
export { runWithRequestContext, getRequestContext, getRequestId, getTraceId } from "./context.js";
export type { RequestContext } from "./context.js";

export { createLogger } from "./logger.js";
export type { Logger, LogFields, LogLevel } from "./logger.js";

export { runHealthChecks } from "./health.js";
export type { HealthCheckDefinition, HealthCheckStatus, HealthReport } from "./health.js";

export { initSentry, captureException, isSentryEnabled, closeSentry } from "./sentry.js";
export type { SentryOptions } from "./sentry.js";
