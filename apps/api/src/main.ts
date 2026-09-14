import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Contrato de API oficial: REST versionada /api/v1 (ver 02_STACK §4.3).
  app.setGlobalPrefix("api/v1");

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
}

void bootstrap();
