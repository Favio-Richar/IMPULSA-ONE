import { Module } from "@nestjs/common";
import { TemplatesController } from "./templates.controller.js";
import { TemplatesService } from "./templates.service.js";

@Module({
  controllers: [TemplatesController],
  providers: [TemplatesService],
  // Lo usa la aplicación de una plantilla a un sitio (PL4).
  exports: [TemplatesService],
})
export class TemplatesModule {}
