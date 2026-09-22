import { Module } from "@nestjs/common";
import { ContactsService } from "./contacts.service.js";

@Module({
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
