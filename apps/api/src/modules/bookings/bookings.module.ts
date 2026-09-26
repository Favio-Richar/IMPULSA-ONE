import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { AgendaController } from "./agenda.controller.js";
import { AgendaService } from "./agenda.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { BookingManageController } from "./booking-manage.controller.js";
import { BookingManageService } from "./booking-manage.service.js";
import { BookingNotifier } from "./booking-notifier.js";
import { ContactsModule } from "../contacts/contacts.module.js";
import { BookingSetupController } from "./booking-setup.controller.js";
import { BookingSetupService } from "./booking-setup.service.js";
import { PublicBookingsController } from "./public-bookings.controller.js";
import { PublicBookingsService } from "./public-bookings.service.js";

@Module({
  imports: [ContactsModule, AnalyticsModule, AuthModule],
  controllers: [BookingSetupController, PublicBookingsController, AgendaController, BookingManageController],
  providers: [BookingSetupService, PublicBookingsService, AgendaService, BookingManageService, BookingNotifier],
  exports: [BookingSetupService],
})
export class BookingsModule {}
