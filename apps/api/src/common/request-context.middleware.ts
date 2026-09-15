import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { runWithRequestContext } from "@impulza/observability";
import { logger } from "../observability/logger.js";

// `traceparent` (W3C Trace Context) es el formato estándar que usan proxies/otros servicios para
// propagar un trace entre llamadas; si no viene, aceptamos `x-trace-id` como alternativa simple,
// y si tampoco viene generamos uno nuevo (la request es la raíz del trace).
function resolveTraceId(request: Request): string {
  const traceparent = request.get("traceparent");
  if (traceparent) {
    const traceId = traceparent.split("-")[1];
    if (traceId) {
      return traceId;
    }
  }

  const explicit = request.get("x-trace-id");
  return explicit || randomUUID();
}

export function requestContextMiddleware(request: Request, response: Response, next: NextFunction): void {
  const requestId = randomUUID();
  const traceId = resolveTraceId(request);
  response.setHeader("X-Request-Id", requestId);

  runWithRequestContext({ requestId, traceId }, () => {
    const startedAt = Date.now();

    response.on("finish", () => {
      logger.info("request", {
        method: request.method,
        path: request.originalUrl,
        status: response.statusCode,
        duration_ms: Date.now() - startedAt,
      });
    });

    next();
  });
}
