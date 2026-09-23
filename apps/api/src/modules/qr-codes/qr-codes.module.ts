import { Module } from "@nestjs/common";
import { QrCodesController } from "./qr-codes.controller.js";
import { QrCodesService } from "./qr-codes.service.js";

@Module({
  controllers: [QrCodesController],
  providers: [QrCodesService],
  exports: [QrCodesService],
})
export class QrCodesModule {}
