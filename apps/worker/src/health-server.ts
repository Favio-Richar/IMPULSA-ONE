import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { runHealthChecks, runWithRequestContext } from "@impulza/observability";
import { logger } from "./observability/logger.js";

// El worker placeholder (F0.2) todavía no tiene BullMQ ni Redis reales (ver env.ts) — por eso el
// chequeo es de liveness pura: "el proceso responde" es todo lo que hay que verificar hoy. Cuando
// se agregue la primera cola real, este arreglo de checks suma un chequeo "redis"/"queue".
async function handleHealth(response: ServerResponse): Promise<void> {
  const report = await runHealthChecks("impulza-worker", []);
  response
    .writeHead(report.status === "ok" ? 200 : 503, { "Content-Type": "application/json" })
    .end(JSON.stringify(report));
}

function handleNotFound(response: ServerResponse): void {
  response.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "No encontrado" }));
}

// Servidor HTTP mínimo únicamente para el probe de salud — el worker no expone ninguna API de
// negocio (esa vive en apps/api). No lleva Helmet/CORS/CSRF porque no hay superficie que proteger
// más allá de este único endpoint de infraestructura.
export function createHealthServer(): Server {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    const requestId = randomUUID();
    const traceId = randomUUID();
    const startedAt = Date.now();

    runWithRequestContext({ requestId, traceId }, () => {
      response.setHeader("X-Request-Id", requestId);
      response.on("finish", () => {
        logger.info("request", {
          method: request.method,
          path: request.url,
          status: response.statusCode,
          duration_ms: Date.now() - startedAt,
        });
      });

      const routed = request.url === "/health" ? handleHealth(response) : Promise.resolve(handleNotFound(response));

      routed.catch((error: unknown) => {
        logger.error("fallo al procesar request de salud", { err: error });
        if (!response.headersSent) {
          response.writeHead(500, { "Content-Type": "application/json" });
        }
        response.end(JSON.stringify({ status: "error" }));
      });
    });
  });
}
