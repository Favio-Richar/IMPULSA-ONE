import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AutomationsModule } from "../automations/automations.module.js";
import { ContactsModule } from "../contacts/contacts.module.js";
import { NewsletterController, PublicNewsletterController } from "./newsletter.controller.js";
import { NewsletterService } from "./newsletter.service.js";

// Newsletter con doble confirmación (F7.4, ADR-019). `AuthModule` aporta el adaptador de correo.
@Module({
  imports: [ContactsModule, AuthModule, AutomationsModule],
  controllers: [PublicNewsletterController, NewsletterController],
  providers: [NewsletterService],
})
export class NewsletterModule {}
