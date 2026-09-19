import { Module } from "@nestjs/common";
import { PageVersionsService } from "./page-versions.service.js";
import { PagesController } from "./pages.controller.js";
import { PagesService } from "./pages.service.js";

@Module({
  controllers: [PagesController],
  providers: [PagesService, PageVersionsService],
  exports: [PagesService, PageVersionsService],
})
export class PagesModule {}
