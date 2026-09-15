import * as Sentry from "@sentry/node";

export interface SentryOptions {
  dsn?: string;
  environment: string;
  service: string;
  release?: string;
}

let enabled = false;

// Sin DSN (desarrollo local, o cualquier entorno donde no se configuró) esto es un no-op explícito
// — Sentry nunca es requerido para arrancar (ST §15: la app no debe depender de un proveedor
// externo opcional para levantar).
export function initSentry(options: SentryOptions): void {
  if (!options.dsn) {
    enabled = false;
    return;
  }

  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    // Nunca enviar IP/cookies/headers por defecto: pueden traer la cookie de sesión, tokens
    // CSRF o cabeceras de autorización (CLAUDE.md "no expone secretos ni datos sensibles").
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
        delete event.request.query_string;
      }
      return event;
    },
  });

  Sentry.setTag("service", options.service);
  enabled = true;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) {
    return;
  }
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export function isSentryEnabled(): boolean {
  return enabled;
}

// Solo para tests / cierre de proceso ordenado — nunca se llama durante un request normal.
export async function closeSentry(timeoutMs = 0): Promise<void> {
  await Sentry.close(timeoutMs);
  enabled = false;
}
