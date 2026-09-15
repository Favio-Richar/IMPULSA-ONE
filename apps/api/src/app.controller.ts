import { Controller, Get } from "@nestjs/common";

// Controlador placeholder de la fundación del monorepo (F0.2) — sanity check de que la API
// responde. El endpoint de salud real vive en HealthController (/health, F1.10).
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
