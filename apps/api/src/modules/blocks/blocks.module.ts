import { Module } from "@nestjs/common";
import { BlocksController } from "./blocks.controller.js";
import { BlocksService } from "./blocks.service.js";

@Module({
  controllers: [BlocksController],
  providers: [BlocksService],
  exports: [BlocksService],
})
export class BlocksModule {}
