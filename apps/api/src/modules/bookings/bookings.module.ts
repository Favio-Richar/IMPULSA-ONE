import { Module } from "@nestjs/common";
import { BookingSetupController } from "./booking-setup.controller.js";
import { BookingSetupService } from "./booking-setup.service.js";

@Module({
  controllers: [BookingSetupController],
  providers: [BookingSetupService],
  exports: [BookingSetupService],
})
export class BookingsModule {}
