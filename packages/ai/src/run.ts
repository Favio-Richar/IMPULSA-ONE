import { AiProviderError, type AiConnectionConfig, type AiOutcome, type AiProviderFactory, type AiRequest } from "./types.js";

/** Un intento contra una conexión, tal como se registra en `AiUsage` (sin prompt ni respuesta). */
export interface AiAttempt {
  connectionId: string;
  model: string;
  outcome: AiOutcome;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  durationMs: number;
}

export interface AiRunResult<T> {
  data: T;
  attempts: AiAttempt[];
}

/** Ninguna conexión dio una salida válida (o no hay ninguna configurada para la tarea). */
export class AiUnavailableError extends Error {
  constructor(readonly attempts: AiAttempt[]) {
    super(attempts.length === 0 ? "No hay conexiones de IA para esta tarea." : "Ninguna conexión de IA respondió.");
    this.name = "AiUnavailableError";
  }
}

export interface RunOptions {
  /** Reintentos por conexión ante errores transitorios o salida inválida (además del primer intento). */
  retriesPerConnection?: number;
  /** Retroceso base en ms (se duplica por reintento). */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Costo en micro-dólares: tokens × precio por millón. Redondeado hacia arriba (nunca subestimar). */
export function estimateCostMicroUsd(connection: AiConnectionConfig, inputTokens: number, outputTokens: number): number {
  return Math.ceil((inputTokens * connection.inputMicroUsdPerMTok + outputTokens * connection.outputMicroUsdPerMTok) / 1_000_000);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Ejecuta un pedido contra las conexiones de una tarea, en orden (ADR-010):
 * 1. Cada conexión tiene su timeout; un error transitorio o una salida que no cumple el esquema se
 *    reintenta en la misma conexión, con retroceso.
 * 2. Un error definitivo (credencial, pedido rechazado, negativa del modelo) o agotar los
 *    reintentos pasa a la siguiente conexión.
 * 3. La salida siempre se valida con el esquema Zod del pedido antes de devolverse.
 *
 * Devuelve todos los intentos (también los fallidos) para registrar uso y costo reales.
 */
export async function runWithFallback<T>(
  connections: readonly AiConnectionConfig[],
  request: AiRequest<T>,
  factory: AiProviderFactory,
  options: RunOptions = {},
): Promise<AiRunResult<T>> {
  const retries = options.retriesPerConnection ?? 1;
  const backoffMs = options.backoffMs ?? 400;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const attempts: AiAttempt[] = [];

  for (const connection of connections) {
    const provider = factory(connection);
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        await sleep(backoffMs * 2 ** (attempt - 1));
      }
      const startedAt = now();
      const record = (outcome: AiOutcome, inputTokens = 0, outputTokens = 0) => {
        attempts.push({
          connectionId: connection.id,
          model: connection.model,
          outcome,
          inputTokens,
          outputTokens,
          costMicroUsd: estimateCostMicroUsd(connection, inputTokens, outputTokens),
          durationMs: Math.max(0, now() - startedAt),
        });
      };

      try {
        const result = await provider.generate(request as AiRequest<unknown>, AbortSignal.timeout(connection.timeoutMs));
        const parsed = request.schema.safeParse(result.output);
        if (parsed.success) {
          record("ok", result.inputTokens, result.outputTokens);
          attempts[attempts.length - 1]!.model = result.model;
          return { data: parsed.data, attempts };
        }
        record("invalid_output", result.inputTokens, result.outputTokens);
      } catch (error) {
        if (!(error instanceof AiProviderError)) {
          record("provider_error");
          break;
        }
        record(error.outcome, error.usage?.inputTokens, error.usage?.outputTokens);
        if (!error.transient) {
          break;
        }
      }
    }
  }

  throw new AiUnavailableError(attempts);
}
