import { getRequestContext } from "./context.js";

export type LogFields = Record<string, unknown>;
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

// Claves que nunca deben salir en texto plano en un log, sin importar en qué profundidad del
// objeto aparezcan — defensa en profundidad (CLAUDE.md "no expone secretos ni datos sensibles").
// Además de esto, los llamadores no deben loguear objetos completos de contraseñas/tokens.
const SENSITIVE_KEY_PATTERN =
  /password|secret|token|authorization|cookie|api[-_]?key|encryptionkey|dsn/i;
const REDACTED = "[REDACTED]";

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  if (value !== null && typeof value === "object") {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }
    seen.add(value);

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, seen);
    }
    return result;
  }

  return value;
}

function write(service: string, level: LogLevel, message: string, fields?: LogFields): void {
  const context = getRequestContext();

  const record = {
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
    request_id: context?.requestId,
    trace_id: context?.traceId,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };

  process.stdout.write(`${JSON.stringify(record)}\n`);
}

// Un logger por servicio (apps/api, apps/worker) — cada línea es JSON estructurado de una sola
// línea, listo para un colector tipo Loki/CloudWatch (ver ARCHITECTURE.md §2, "Transversal").
export function createLogger(service: string): Logger {
  return {
    debug: (message, fields) => write(service, "debug", message, fields),
    info: (message, fields) => write(service, "info", message, fields),
    warn: (message, fields) => write(service, "warn", message, fields),
    error: (message, fields) => write(service, "error", message, fields),
  };
}
