import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { ContactsModule } from "../contacts/contacts.module.js";
import { BookingSetupController } from "./booking-setup.controller.js";
import { BookingSetupService } from "./booking-setup.service.js";
import { PublicBookingsController } from "./public-bookings.controller.js";
import { PublicBookingsService } from "./public-bookings.service.js";

@Module({
  imports: [ContactsModule, AnalyticsModule],
  controllers: [BookingSetupController, PublicBookingsController],
  providers: [BookingSetupService, PublicBookingsService],
  exports: [BookingSetupService],
})
export class BookingsModule {}
