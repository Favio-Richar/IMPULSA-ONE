import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  adminAiConnectionResponse,
  adminAiConnectionTestResponse,
  adminAiRoutesResponse,
  adminAiUsageResponse,
} from "@impulza/contracts";
import {
  aiRoutesSchema,
  createAiConnectionSchema,
  updateAiConnectionSchema,
  type AiRoutesInput,
  type CreateAiConnectionInput,
  type UpdateAiConnectionInput,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import type { RequestWithUser } from "../../common/request-with-user.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ADMIN_SESSION_AUTH } from "../../openapi/document.js";
import { ApiRateLimited, ApiUuidParam, ApiZodArrayResponse, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { uuidParamSchema } from "../admin/dto/admin-queries.dto.js";
import { AdminSessionGuard } from "../admin/guards/admin-session.guard.js";
import { AdminAiService } from "./admin-ai.service.js";

const NOT_FOUND = "Conexión no encontrada.";

/**
 * Conexiones de IA de la plataforma (F6.2b, ADR-010): las administra solo el propietario desde
 * `apps/admin`. Misma puerta que el resto de `/admin/*` (sesión `ADMIN` con TOTP, ADR-005); cada
 * escritura queda auditada y el token nunca vuelve a salir.
 */
@ApiTags("admin")
@ApiCookieAuth(ADMIN_SESSION_AUTH)
@ApiResponse({ status: 401, description: "Sin sesión de administración válida (cookie `impulza_admin_session`)." })
@ApiResponse({ status: 403, description: "Petición que modifica estado sin la cabecera anti-CSRF." })
@Controller("admin/ai")
@UseGuards(CsrfGuard, AdminSessionGuard)
export class AdminAiController {
  constructor(private readonly adminAiService: AdminAiService) {}

  @Get("connections")
  @ApiOperation({ summary: "Conexiones de IA", description: "Sin tokens: solo si hay uno y sus últimos 4 caracteres." })
  @ApiZodArrayResponse(200, adminAiConnectionResponse, "Conexiones, de la más antigua a la más nueva.")
  listConnections() {
    return this.adminAiService.listConnections();
  }

  @Post("connections")
  @ApiOperation({ summary: "Agregar una conexión de IA", description: "El token se cifra al guardarse. Queda auditado (sin el token)." })
  @ApiZodBody(createAiConnectionSchema)
  @ApiZodResponse(201, adminAiConnectionResponse, "Conexión creada.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 409, description: "Ya existe una conexión con ese nombre." })
  createConnection(@Req() req: RequestWithUser, @Body(new ZodValidationPipe(createAiConnectionSchema)) body: CreateAiConnectionInput) {
    return this.adminAiService.createConnection(req.user.id, body);
  }

  @Patch("connections/:connectionId")
  @ApiOperation({ summary: "Editar una conexión de IA", description: "`apiKey` ausente conserva el token; `null` lo quita. Auditado con el antes y el después." })
  @ApiUuidParam("connectionId", "Conexión a editar.")
  @ApiZodBody(updateAiConnectionSchema)
  @ApiZodResponse(200, adminAiConnectionResponse, "Conexión actualizada.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 409, description: "Ya existe una conexión con ese nombre." })
  updateConnection(
    @Req() req: RequestWithUser,
    @Param("connectionId", new ZodValidationPipe(uuidParamSchema)) connectionId: string,
    @Body(new ZodValidationPipe(updateAiConnectionSchema)) body: UpdateAiConnectionInput,
  ) {
    return this.adminAiService.updateConnection(req.user.id, connectionId, body);
  }

  @Delete("connections/:connectionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Borrar una conexión de IA", description: "La saca de todas las rutas. El historial de uso se conserva." })
  @ApiUuidParam("connectionId", "Conexión a borrar.")
  @ApiResponse({ status: 204, description: "Borrada." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async deleteConnection(@Req() req: RequestWithUser, @Param("connectionId", new ZodValidationPipe(uuidParamSchema)) connectionId: string) {
    await this.adminAiService.deleteConnection(req.user.id, connectionId);
  }

  @Post("connections/:connectionId/test")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "admin-ai-test" })
  @ApiOperation({
    summary: "Probar una conexión de IA",
    description: "Hace una llamada mínima real (sin reintentos ni respaldo) y devuelve el resultado técnico, el modelo que respondió y la latencia. Se registra en el uso.",
  })
  @ApiUuidParam("connectionId", "Conexión a probar.")
  @ApiZodResponse(200, adminAiConnectionTestResponse, "Resultado de la prueba (también cuando falla: `ok: false`).")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiRateLimited(10, 60)
  testConnection(@Req() req: RequestWithUser, @Param("connectionId", new ZodValidationPipe(uuidParamSchema)) connectionId: string) {
    return this.adminAiService.testConnection(req.user.id, connectionId);
  }

  @Get("routes")
  @ApiOperation({ summary: "Rutas de IA por tarea", description: "Conexiones de cada tarea en orden de respaldo; la primera es la principal." })
  @ApiZodResponse(200, adminAiRoutesResponse, "Rutas de las cuatro tareas.")
  getRoutes() {
    return this.adminAiService.getRoutes();
  }

  @Put("routes")
  @ApiOperation({ summary: "Cambiar las rutas de IA", description: "Reemplaza todas las rutas de una vez (transacción). Una tarea sin conexiones queda no disponible. Auditado." })
  @ApiZodBody(aiRoutesSchema)
  @ApiZodResponse(200, adminAiRoutesResponse, "Rutas guardadas.")
  @ApiResponse({ status: 400, description: "Entrada inválida o conexión inexistente." })
  setRoutes(@Req() req: RequestWithUser, @Body(new ZodValidationPipe(aiRoutesSchema)) body: AiRoutesInput) {
    return this.adminAiService.setRoutes(req.user.id, body);
  }

  @Get("usage")
  @ApiOperation({ summary: "Consumo de IA del mes", description: "Solicitudes, intentos, fallas, tokens y costo del mes calendario UTC, por conexión, por tarea y organizaciones con más uso." })
  @ApiZodResponse(200, adminAiUsageResponse, "Consumo del mes.")
  usage() {
    return this.adminAiService.usage();
  }
}
