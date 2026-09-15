import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { PrismaModule } from "./database/prisma.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { RedisModule } from "./redis/redis.module.js";

// Módulo raíz — los módulos de dominio (organizations, sites, ...) se agregan a partir de
// Fase 1, uno por historia del backlog. Ver docs/BACKLOG_FASE_0_1.md.
@Module({
  imports: [PrismaModule, RedisModule, AuthModule],
  controllers: [AppController],
})
export class AppModule {}
