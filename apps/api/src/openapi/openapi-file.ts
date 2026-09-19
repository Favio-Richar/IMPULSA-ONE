import path from "node:path";
import type { INestApplication } from "@nestjs/common";

/**
 * El documento vive versionado en `docs/api/openapi.json` y no solo servido en memoria: así el
 * contrato se revisa en el diff de un PR, se puede generar un cliente sin levantar la API, y la
 * prueba de sincronización tiene contra qué comparar.
 */
export const OPENAPI_FILE = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "docs",
  "api",
  "openapi.json",
);

/**
 * Prefijo global de la API. Vive acá y no suelto en `main.ts` porque el documento OpenAPI tiene
 * que generarse con exactamente el mismo prefijo que sirve el servidor — si se escriben dos veces,
 * un día dejan de coincidir y el contrato apunta a rutas que no existen.
 *
 * `/health` queda fuera a propósito: es un endpoint de infraestructura, no de negocio (F1.10).
 */
export function applyApiPrefix(app: INestApplication): void {
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });
}

/** Serialización única: el archivo en disco y el documento recién generado deben ser comparables. */
export function serializeOpenApi(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
