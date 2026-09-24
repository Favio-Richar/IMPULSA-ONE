import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { ContactsModule } from "../contacts/contacts.module.js";
import { PublicFormsController } from "./public-forms.controller.js";
import { PublicFormsService } from "./public-forms.service.js";

@Module({
  imports: [ContactsModule, AnalyticsModule],
  controllers: [PublicFormsController],
  providers: [PublicFormsService],
})
export class PublicFormsModule {}
