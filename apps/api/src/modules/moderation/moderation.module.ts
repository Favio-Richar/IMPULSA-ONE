import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AbuseReportsService } from "./abuse-reports.service.js";
import { ModerationCasesController } from "./moderation-cases.controller.js";
import { ModerationCasesService } from "./moderation-cases.service.js";
import { ModerationNotifier } from "./moderation-notifier.js";
import { PublicAbuseReportsController } from "./public-abuse-reports.controller.js";

// `AuthModule` aporta el adaptador de email (EMAIL_ADAPTER). La cola del equipo vive en `AdminModule` (misma puerta que
// el resto de `/admin`) y usa el notificador exportado de acá.
@Module({
  imports: [AuthModule],
  controllers: [PublicAbuseReportsController, ModerationCasesController],
  providers: [AbuseReportsService, ModerationCasesService, ModerationNotifier],
  exports: [AbuseReportsService, ModerationNotifier],
})
export class ModerationModule {}
