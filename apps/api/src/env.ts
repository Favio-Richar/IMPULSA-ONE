import { z } from "zod";
import {
  corsOriginsSchema,
  databaseUrlSchema,
  encryptionKeySchema,
  loadEnv,
  nodeEnvSchema,
  portSchema,
  redisUrlSchema,
  urlSchema,
} from "@impulza/config";
import {
  mercadoPagoConfigFromEnv,
  mercadoPagoEnvShape,
  mercadoPagoOAuthConfigFromEnv,
  mercadoPagoOAuthEnvShape,
  webpayConfigFromEnv,
  webpayEnvShape,
} from "@impulza/payments";

// Se valida una sola vez, al importar este módulo (primer import en main.ts) — si falta o es
// inválida una variable requerida, el proceso no debe arrancar (ST §15, F1.2).
export const env = loadEnv({
  NODE_ENV: nodeEnvSchema,
  PORT: portSchema.default(4000),
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
  // Orígenes exactos permitidos para CORS — nunca "*" (ST §15, no negociable).
  CORS_ORIGINS: corsOriginsSchema,
  // Clave simétrica para cifrar el secreto TOTP de 2FA en reposo.
  AUTH_ENCRYPTION_KEY: encryptionKeySchema,
  // Base de las URLs de verificación/recuperación que se envían por email.
  APP_BASE_URL: urlSchema,
  // Sal para el visitante anonimizado de analítica (F3.4, ADR-004 punto 1) — nunca se persiste la
  // IP cruda del visitante, solo un hash derivado de esto y rotado por sitio/día.
  ANALYTICS_SALT_SECRET: z.string().min(32),
  // Secreto compartido con apps/web (F3.6): solo cuando una petición lo trae, la API cree las
  // cabeceras con la IP/user-agent/país del visitante real que reenvía apps/web (ver
  // packages/analytics/src/proxy-headers.ts). Sin él, esas cabeceras se ignoran — si se aceptaran
  // de cualquiera, bastaría inventarse una IP para saltarse el rate limit.
  INTERNAL_PROXY_SECRET: z.string().min(32),
  // Opcional a propósito: Sentry no es requerido para arrancar (F1.10). Sin DSN, initSentry() es
  // un no-op — así se puede desarrollar localmente sin cuenta de Sentry.
  SENTRY_DSN: urlSchema.optional(),
  SENTRY_RELEASE: z.string().optional(),
  // URL base de apps/web y el secreto compartido de su webhook de invalidación de caché (F2.7).
  // Opcionales por el mismo criterio que Sentry: sin ellos, RevalidateWebService no llama a nada
  // y publicar/restaurar siguen funcionando igual — el aviso de caché es best-effort, nunca un
  // requisito para que la API arranque o para que publicar tenga éxito.
  WEB_APP_URL: urlSchema.optional(),
  WEB_REVALIDATE_SECRET: z.string().min(32).optional(),
  // Soporte (F4.5): bandeja del equipo que recibe el aviso de cada solicitud nueva o respuesta del
  // cliente, y URL de apps/admin para el enlace del aviso. Opcionales por el mismo criterio que
  // Sentry: sin ellos, el cliente igual recibe su confirmación y el aviso al equipo se omite con un
  // warning en el log — nunca falla abrir una solicitud por eso.
  SUPPORT_NOTIFICATION_EMAIL: z.email().optional(),
  ADMIN_BASE_URL: urlSchema.optional(),
  // Dominios propios (F4.7). `PLATFORM_DOMAIN`: el dominio de la plataforma (y sus subdominios), que
  // ningún cliente puede reclamar. `CUSTOM_DOMAIN_CNAME_TARGET`: a dónde apunta el cliente su dominio
  // verificado. Opcionales mientras no esté la decisión #1 (nombre y dominio definitivos): sin ellos
  // la verificación funciona y el panel dice que el destino del CNAME se define al desplegar.
  PLATFORM_DOMAIN: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/).optional(),
  CUSTOM_DOMAIN_CNAME_TARGET: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/).optional(),
  // Reservas (F5.4): origen público de apps/web para los enlaces que recibe el cliente por correo
  // ("gestiona tu reserva"). Opcional: sin él, el correo no trae enlace y lo dice.
  PUBLIC_SITE_BASE_URL: urlSchema.optional(),
  // Secreto de la firma del enlace "gestiona tu reserva" (F5.4). El mismo en la API y el worker.
  // Opcional: sin él, los correos no traen enlace y la página de gestión no existe.
  BOOKING_LINK_SECRET: z.string().min(32).optional(),
  // Cobro de suscripciones (F4.6, ADR-012): credenciales de Webpay Oneclick (todas o ninguna) y la
  // URL pública de esta API, a la que Transbank devuelve al cliente. Sin ambas, Webpay no se ofrece.
  ...webpayEnvShape,
  // Mercado Pago (F4.6b): token de acceso y clave de firma de webhooks, los dos o ninguno.
  ...mercadoPagoEnvShape,
  // Aplicación de Impulza en Mercado Pago para que cada negocio conecte SU cuenta (F5.8, ADR-013).
  ...mercadoPagoOAuthEnvShape,
  // Google Calendar (F7.9c, ADR-024): credenciales OAuth para sincronización de citas.
  // Opcionales: sin ellas opera en modo desacoplado sin fallar y queda listo para cuando se suministren.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  API_PUBLIC_URL: urlSchema.optional(),
  // Panel de operaciones (F7.11): URL del `/health` del worker. Sin ella, fuera de producción se usa
  // `http://localhost:4100/health`; en producción el panel informa que no está configurada.
  WORKER_HEALTH_URL: urlSchema.optional(),
});

// Todas o ninguna: una configuración de Webpay a medias detiene el arranque aquí (ST §15).
export const webpayConfig = webpayConfigFromEnv(env);
export const mercadoPagoConfig = mercadoPagoConfigFromEnv(env);
export const mercadoPagoOAuthConfig = mercadoPagoOAuthConfigFromEnv(env);
export const googleCalendarConfig =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
    : null;
