import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";

// Módulo raíz — los módulos de dominio (auth, organizations, sites, ...) se agregan a partir de
// Fase 1, uno por historia del backlog. Ver docs/BACKLOG_FASE_0_1.md.
@Module({
  controllers: [AppController],
})
export class AppModule {}
