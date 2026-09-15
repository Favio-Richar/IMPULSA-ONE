import "reflect-metadata";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { env } from "./env.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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

  // Contrato de API oficial: REST versionada /api/v1 (ver 02_STACK §4.3).
  app.setGlobalPrefix("api/v1");

  await app.listen(env.PORT);
}

void bootstrap();
