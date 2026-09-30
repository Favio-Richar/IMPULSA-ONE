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
import { ContactsModule } from "../contacts/contacts.module.js";
import { PaymentAccountsModule } from "../payment-accounts/payment-accounts.module.js";
import { BookingSetupController } from "./booking-setup.controller.js";
import { BookingSetupService } from "./booking-setup.service.js";
import { PublicBookingsController } from "./public-bookings.controller.js";
import { PublicBookingsService } from "./public-bookings.service.js";

@Module({
  imports: [ContactsModule, AnalyticsModule, AuthModule, AutomationsModule, PaymentAccountsModule],
  controllers: [BookingSetupController, PublicBookingsController, AgendaController, BookingManageController, BookingDepositWebhookController],
  providers: [BookingSetupService, PublicBookingsService, AgendaService, BookingManageService, BookingNotifier, BookingDepositService],
  exports: [BookingSetupService],
})
export class BookingsModule {}
