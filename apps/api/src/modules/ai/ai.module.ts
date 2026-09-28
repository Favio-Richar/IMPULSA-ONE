import { Module } from "@nestjs/common";
import { createProvider } from "@impulza/ai";
import { AiController } from "./ai.controller.js";
import { AI_PROVIDER_FACTORY, AiService } from "./ai.service.js";

@Module({
  controllers: [AiController],
  // La fábrica de adaptadores es un proveedor inyectable para que las pruebas usen `FakeProvider`
  // (sin red ni claves), igual que `EMAIL_ADAPTER` con el correo.
  providers: [AiService, { provide: AI_PROVIDER_FACTORY, useValue: createProvider }],
  exports: [AiService],
})
export class AiModule {}
