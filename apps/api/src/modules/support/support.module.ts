import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SupportNotifier } from "./support-notifier.js";
import { SupportController } from "./support.controller.js";
import { SupportService } from "./support.service.js";

// `AuthModule` aporta el adaptador de email (EMAIL_ADAPTER). `SupportService` se exporta para las
// rutas del equipo, que viven en `AdminModule` detrás de su propia puerta (ADR-005).
@Module({
  imports: [AuthModule],
  controllers: [SupportController],
  providers: [SupportService, SupportNotifier],
  exports: [SupportService],
})
export class SupportModule {}
