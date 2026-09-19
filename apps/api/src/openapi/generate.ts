import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import "../load-dotenv.js";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { buildOpenApiDocument } from "./document.js";
import { applyApiPrefix, OPENAPI_FILE, serializeOpenApi } from "./openapi-file.js";

// Escribe docs/api/openapi.json desde la aplicación real. No se escribe a mano: un documento
// mantenido a mano describe la API que alguien recuerda, no la que está desplegada.
//
// Levanta la aplicación pero nunca la pone a escuchar; necesita Postgres y Redis arriba porque
// inicializar los módulos abre sus conexiones.
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  applyApiPrefix(app);
  await app.init();

  const document = buildOpenApiDocument(app);

  await mkdir(path.dirname(OPENAPI_FILE), { recursive: true });
  await writeFile(OPENAPI_FILE, serializeOpenApi(document), "utf8");

  await app.close();

  const operations = Object.values(document.paths).reduce(
    (total, item) => total + Object.keys(item).length,
    0,
  );
  console.log(`OpenAPI OK: ${Object.keys(document.paths).length} rutas, ${operations} operaciones.`);

  // `app.close()` no cierra la conexión de ioredis: el cliente se provee con una factoría suelta
  // y no tiene gancho de apagado, así que su socket mantiene vivo el bucle de eventos y el script
  // nunca terminaría. Salida explícita — el trabajo ya está escrito en disco.
  // TODO: darle a RedisModule un apagado ordenado (onApplicationShutdown) y quitar esta línea;
  // el mismo socket colgado afecta al apagado del servidor real.
  process.exit(0);
}

void main();
