import { Controller, Get } from "@nestjs/common";

// Controlador placeholder de la fundación del monorepo (F0.2).
// El endpoint de salud real (/health) llega en F1.10 (observabilidad mínima).
@Controller()
export class AppController {
  @Get()
  getStatus(): { service: string; status: string } {
    return {
      service: "impulza-one-api",
      status: "en construcción (Fase 0) — ver docs/BACKLOG_FASE_0_1.md",
    };
  }
}
