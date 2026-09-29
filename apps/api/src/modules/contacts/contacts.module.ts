import { Module } from "@nestjs/common";
import { AutomationsModule } from "../automations/automations.module.js";
import { ContactsController } from "./contacts.controller.js";
import { ContactsService } from "./contacts.service.js";

@Module({
  // Un contacto nuevo dispara automatizaciones (F6.7).
  imports: [AutomationsModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
