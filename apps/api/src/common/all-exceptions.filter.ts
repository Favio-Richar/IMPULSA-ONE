import type { ArgumentsHost } from "@nestjs/common";
import { Catch, HttpException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { captureException } from "@impulza/observability";
import type { Request } from "express";
import { logger } from "../observability/logger.js";

// Filtro catch-all (patrón oficial de Nest para integrar un reporter de errores externo — ver
// docs de "Exception filters"). Solo los 5xx son incidentes reales: un 400/403/404 es un flujo
// esperado de la app (validación, permisos, recurso ajeno) y no debe llenar Sentry de ruido.
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;

    if (status >= 500) {
      logger.error("excepción no controlada", {
        method: request?.method,
        path: request?.originalUrl,
        err: exception,
      });
      captureException(exception, { method: request?.method, path: request?.originalUrl });
    }

    super.catch(exception, host);
  }
}
