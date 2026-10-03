import "./load-dotenv.js";
import "reflect-metadata";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { initSentry } from "@impulza/observability";
import { AppModule } from "./app.module.js";
import { AllExceptionsFilter } from "./common/all-exceptions.filter.js";
import { requestContextMiddleware } from "./common/request-context.middleware.js";
import { env } from "./env.js";
import { NestJsonLogger } from "./observability/nest-logger.js";
import { DOCS_PATH, setupSwaggerUi } from "./openapi/document.js";
import { applyApiPrefix } from "./openapi/openapi-file.js";
import { brandingUploadBody } from "./common/branding-upload-body.js";

async function bootstrap(): Promise<void> {
  // Antes que cualquier otra cosa: si algo revienta durante el bootstrap mismo, ya queremos
  // poder reportarlo. Sin SENTRY_DSN esto es un no-op (ver env.ts).
  initSentry({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    service: "impulza-api",
  });

  const logger = new NestJsonLogger();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });

  // Primer middleware de la cadena: todo lo que ocurra después (guards, controllers, errores)
  // debe poder correlacionarse con este request_id/trace_id (F1.10).
  app.use(requestContextMiddleware);

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));

  // Cabeceras de seguridad + CSP básica (ST §15, no negociable).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  // CORS restrictivo — lista exacta de orígenes, nunca "*"; credentials porque la sesión viaja
  // en cookie HttpOnly.
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
  });

  // Antes del lector de JSON de Nest: amplía el límite solo para la subida de logos (F9.1).
  app.use(brandingUploadBody());

  app.use(cookieParser());

  // Contrato de API oficial: REST versionada /api/v1 (ver 02_STACK §4.3). El prefijo se aplica
  // desde un único lugar compartido con el generador de OpenAPI: si se escribiera dos veces, un
  // día dejarían de coincidir y el contrato apuntaría a rutas que no existen.
  applyApiPrefix(app);

  // Después del helmet global a propósito: la documentación necesita su propia CSP y solo puede
  // sobrescribir la global si se monta después. Devuelve false en producción.
  const docsMounted = setupSwaggerUi(app, env.NODE_ENV);

  await app.listen(env.PORT);

  if (docsMounted) {
    // Por el logger JSON, no por console: es un evento del arranque como cualquier otro (F1.10).
    logger.log(`Documentación de la API en http://localhost:${env.PORT}/${DOCS_PATH}`, "Bootstrap");
  }
}

void bootstrap();
