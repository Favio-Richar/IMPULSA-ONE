import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { AgendaController } from "./agenda.controller.js";
import { AgendaService } from "./agenda.service.js";
import { ContactsModule } from "../contacts/contacts.module.js";
import { BookingSetupController } from "./booking-setup.controller.js";
import { BookingSetupService } from "./booking-setup.service.js";
import { PublicBookingsController } from "./public-bookings.controller.js";
import { PublicBookingsService } from "./public-bookings.service.js";

@Module({
  imports: [ContactsModule, AnalyticsModule],
  controllers: [BookingSetupController, PublicBookingsController, AgendaController],
  providers: [BookingSetupService, PublicBookingsService, AgendaService],
  exports: [BookingSetupService],
})
export class BookingsModule {}
