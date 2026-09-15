import type { LoggerService } from "@nestjs/common";
import { logger } from "./logger.js";

function toFields(optionalParams: unknown[]): Record<string, unknown> | undefined {
  if (optionalParams.length === 0) {
    return undefined;
  }
  return { context: optionalParams.map(String).join(" ") };
}

// Puentea los logs internos de Nest (bootstrap, rutas mapeadas, errores no capturados por un
// filtro) al mismo formato JSON estructurado del resto de la app — sin esto, Nest imprime texto
// plano por consola y F1.10 exige JSON en todos los logs de apps/api.
export class NestJsonLogger implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    logger.info(String(message), toFields(optionalParams));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    logger.error(String(message), toFields(optionalParams));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    logger.warn(String(message), toFields(optionalParams));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    logger.debug(String(message), toFields(optionalParams));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    logger.debug(String(message), toFields(optionalParams));
  }
}
