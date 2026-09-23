import { Module } from "@nestjs/common";
import { ShortLinksController } from "./short-links.controller.js";
import { ShortLinksService } from "./short-links.service.js";

@Module({
  controllers: [ShortLinksController],
  providers: [ShortLinksService],
  exports: [ShortLinksService],
})
export class ShortLinksModule {}
