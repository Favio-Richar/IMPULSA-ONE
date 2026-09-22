import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module.js";
import { PublicFormsController } from "./public-forms.controller.js";
import { PublicFormsService } from "./public-forms.service.js";

@Module({
  imports: [ContactsModule],
  controllers: [PublicFormsController],
  providers: [PublicFormsService],
})
export class PublicFormsModule {}
