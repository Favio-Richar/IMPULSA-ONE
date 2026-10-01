import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { AgendaController } from "./agenda.controller.js";
import { AgendaService } from "./agenda.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { AutomationsModule } from "../automations/automations.module.js";
import { BookingDepositWebhookController } from "./booking-deposit.controller.js";
import { BookingDepositService } from "./booking-deposit.service.js";
import { BookingManageController } from "./booking-manage.controller.js";
import { BookingManageService } from "./booking-manage.service.js";
import { BookingNotifier } from "./booking-notifier.js";
import { BookingSetupController } from "./booking-setup.controller.js";
import { BookingSetupService } from "./booking-setup.service.js";
import { CalendarFeedController } from "./calendar-feed.controller.js";
import { CalendarFeedService } from "./calendar-feed.service.js";
import { ContactsModule } from "../contacts/contacts.module.js";
import { GoogleCalendarController } from "./google-calendar.controller.js";
import { GoogleCalendarService } from "./google-calendar.service.js";
import { PaymentAccountsModule } from "../payment-accounts/payment-accounts.module.js";
import { PublicBookingsController } from "./public-bookings.controller.js";
import { PublicBookingsService } from "./public-bookings.service.js";

@Module({
  imports: [ContactsModule, AnalyticsModule, AuthModule, AutomationsModule, PaymentAccountsModule],
  controllers: [
    BookingSetupController,
    PublicBookingsController,
    AgendaController,
    BookingManageController,
    BookingDepositWebhookController,
    CalendarFeedController,
    GoogleCalendarController,
  ],
  providers: [
    BookingSetupService,
    PublicBookingsService,
    AgendaService,
    BookingManageService,
    BookingNotifier,
    BookingDepositService,
    CalendarFeedService,
    GoogleCalendarService,
  ],
  exports: [BookingSetupService, CalendarFeedService, GoogleCalendarService],
})
export class BookingsModule {}
