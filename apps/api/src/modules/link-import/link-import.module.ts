import { Module } from "@nestjs/common";
import { LinkImportController } from "./link-import.controller.js";
import { LinkImportService } from "./link-import.service.js";

@Module({ controllers: [LinkImportController], providers: [LinkImportService] })
export class LinkImportModule {}
