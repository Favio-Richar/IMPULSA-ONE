import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

// Controlador placeholder de la fundación del monorepo (F0.2) — sanity check de que la API
// responde. El endpoint de salud real vive en HealthController (/health, F1.10).
@ApiTags("meta")
@Controller()
export class AppController {
  @Get()
  @ApiOperation({
    summary: "Raíz de la API",
    description:
      "Sanity check de la fundación del monorepo (F0.2). Para monitoreo real usar `GET /health`, que sí comprueba las dependencias.",
  })
  @ApiResponse({
    status: 200,
    description: "La API responde.",
    schema: {
      type: "object",
      required: ["service", "status"],
      properties: { service: { type: "string" }, status: { type: "string" } },
    },
  })
  getStatus(): { service: string; status: string } {
    return {
      service: "impulza-one-api",
      status: "en construcción (Fase 0) — ver docs/BACKLOG_FASE_0_1.md",
    };
  }
}
