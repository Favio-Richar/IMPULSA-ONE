import { databaseUrlSchema, loadEnv, nodeEnvSchema, portSchema, redisUrlSchema, urlSchema } from "@impulza/config";
import { z } from "zod";

export const env = loadEnv({
  NODE_ENV: nodeEnvSchema,
  // Puerto propio y distinto del de apps/api (PORT=4000): ambos procesos leen el mismo .env de
  // raíz en desarrollo local, así que no pueden compartir el nombre de variable.
  WORKER_PORT: portSchema.default(4100),
  // F3.6: primer trabajo real del worker (pipeline de analítica), así que Postgres y Redis pasan a
  // ser requeridos para arrancar.
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
  // Retención del AnalyticsEvent crudo (ADR-004 punto 4): en configuración, no en el código, para
  // que el propietario la ajuste al publicar su política de privacidad sin migración ni deploy de
  // código. Nunca "indefinida": hay mínimo y máximo.
  ANALYTICS_RETENTION_MONTHS: z.coerce.number().int().min(1).max(120).default(14),
  // Meses sin interacción tras los que un contacto se marca para que el dueño revise si lo
  // conserva (ADR-004 punto 4). Solo marca: nunca borra un contacto.
  CONTACT_RETENTION_REVIEW_MONTHS: z.coerce.number().int().min(1).max(240).default(36),
  // Opcional a propósito: Sentry no es requerido para arrancar (F1.10).
  SENTRY_DSN: urlSchema.optional(),
  SENTRY_RELEASE: z.string().optional(),
  // Recordatorios de reserva (F5.4): origen de apps/web para el enlace "gestiona tu reserva".
  PUBLIC_SITE_BASE_URL: urlSchema.optional(),
  // Secreto de los enlaces firmados de correos: "gestiona tu reserva" (F5.4) y la baja de campañas
  // (F5.6, con otro propósito en la firma). El mismo en la API y el worker.
  // Opcional: sin él, los correos no traen enlace y la página de gestión no existe.
  BOOKING_LINK_SECRET: z.string().min(32).optional(),
  // Automatizaciones (F6.7): origen del panel para el enlace del aviso al equipo. El mismo nombre
  // que usa la API para sus correos. Opcional: sin él, el aviso va sin enlace.
  APP_BASE_URL: urlSchema.optional(),
});
