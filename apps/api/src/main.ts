import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { env } from "./env.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Contrato de API oficial: REST versionada /api/v1 (ver 02_STACK §4.3).
  app.setGlobalPrefix("api/v1");

  await app.listen(env.PORT);
}

void bootstrap();
