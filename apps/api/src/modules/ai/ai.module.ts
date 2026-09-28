import { Module } from "@nestjs/common";
import { createProvider } from "@impulza/ai";
import { AdminAiController } from "./admin-ai.controller.js";
import { AdminAiService } from "./admin-ai.service.js";
import { AiController } from "./ai.controller.js";
import { AI_PROVIDER_FACTORY, AiService } from "./ai.service.js";

@Module({
  controllers: [AiController, AdminAiController],
  // La fábrica de adaptadores es un proveedor inyectable para que las pruebas usen `FakeProvider`
  // (sin red ni claves), igual que `EMAIL_ADAPTER` con el correo.
  providers: [AiService, AdminAiService, { provide: AI_PROVIDER_FACTORY, useValue: createProvider }],
  exports: [AiService],
})
export class AiModule {}
