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

async function bootstrap(): Promise<void> {
  // Antes que cualquier otra cosa: si algo revienta durante el bootstrap mismo, ya queremos
  // poder reportarlo. Sin SENTRY_DSN esto es un no-op (ver env.ts).
  initSentry({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    service: "impulza-api",
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new NestJsonLogger(),
  });

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

  app.use(cookieParser());

  // Contrato de API oficial: REST versionada /api/v1 (ver 02_STACK §4.3). /health queda fuera
  // del prefijo a propósito — es un endpoint de infraestructura, no de negocio (F1.10).
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });

  await app.listen(env.PORT);
}

void bootstrap();
