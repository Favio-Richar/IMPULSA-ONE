import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { adminAbuseReportDetailResponse, adminAbuseReportListResponse } from "@impulza/contracts";
import {
  listAbuseReportsQuerySchema,
  moderationActionSchema,
  type ListAbuseReportsQueryDto,
  type ModerationAction,
  type ModerationActionDto,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import type { RequestWithUser } from "../../common/request-with-user.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ADMIN_SESSION_AUTH } from "../../openapi/document.js";
import { ApiUuidParam, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { uuidParamSchema } from "../admin/dto/admin-queries.dto.js";
import { AdminSessionGuard } from "../admin/guards/admin-session.guard.js";
import { ModerationAdminService } from "./moderation-admin.service.js";

const uuidParam = new ZodValidationPipe(uuidParamSchema);

/** Cola de moderación de la plataforma (F9.9b). Solo superadministración: misma puerta que el resto de `/admin`. */
@ApiTags("admin")
@ApiCookieAuth(ADMIN_SESSION_AUTH)
@ApiResponse({ status: 401, description: "Sin sesión de administración válida." })
@ApiResponse({ status: 403, description: "Petición que modifica estado sin la cabecera anti-CSRF." })
@Controller("admin/abuse-reports")
@UseGuards(CsrfGuard, AdminSessionGuard)
export class AdminAbuseReportsController {
  constructor(private readonly moderation: ModerationAdminService) {}

  @Get()
  @ApiOperation({
    summary: "Cola de moderación",
    description:
      "Por defecto, lo que espera decisión (abiertos y apelados). `sort=priority` pone primero los sitios con más reportes abiertos y, dentro de cada uno, el más antiguo. Incluye el correo del denunciante: solo lo ve superadministración.",
  })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "reason", required: false })
  @ApiQuery({ name: "siteId", required: false })
  @ApiQuery({ name: "organizationId", required: false })
  @ApiQuery({ name: "sort", required: false, enum: ["priority", "oldest", "newest"] })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiZodResponse(200, adminAbuseReportListResponse, "Una página de reportes y el tamaño de la cola.")
  @ApiResponse({ status: 400, description: "Parámetros inválidos (detalle en `issues`)." })
  list(@Query(new ZodValidationPipe(listAbuseReportsQuerySchema)) query: ListAbuseReportsQueryDto) {
    return this.moderation.list(query);
  }

  @Get(":reportId")
  @ApiOperation({ summary: "Detalle de un reporte", description: "Con su historial de decisiones. **Queda auditado** (`admin.abuse_report_viewed`): muestra el correo del denunciante." })
  @ApiUuidParam("reportId", "Reporte a ver.")
  @ApiZodResponse(200, adminAbuseReportDetailResponse, "El reporte con su historial.")
  @ApiResponse({ status: 404, description: "Reporte no encontrado." })
  get(@Req() req: RequestWithUser, @Param("reportId", uuidParam) reportId: string) {
    return this.moderation.get(req.user.id, reportId);
  }

  private act(req: RequestWithUser, reportId: string, action: ModerationAction, body: ModerationActionDto) {
    return this.moderation.apply(req.user.id, reportId, action, body.reason);
  }

  @Post(":reportId/dismiss")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Descartar el reporte", description: "No procede ninguna medida. Motivo obligatorio y auditado." })
  @ApiUuidParam("reportId", "Reporte a resolver.")
  @ApiZodBody(moderationActionSchema)
  @ApiZodResponse(200, adminAbuseReportDetailResponse, "El reporte actualizado.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: "Reporte no encontrado." })
  @ApiResponse({ status: 409, description: "La acción no corresponde al estado actual." })
  dismiss(@Req() req: RequestWithUser, @Param("reportId", uuidParam) reportId: string, @Body(new ZodValidationPipe(moderationActionSchema)) body: ModerationActionDto) {
    return this.act(req, reportId, "dismiss", body);
  }

  @Post(":reportId/warn")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Advertir al propietario", description: "El sitio sigue publicado. El propietario recibe el motivo y una vía de apelación." })
  @ApiUuidParam("reportId", "Reporte a resolver.")
  @ApiZodBody(moderationActionSchema)
  @ApiZodResponse(200, adminAbuseReportDetailResponse, "El reporte actualizado.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: "Reporte no encontrado." })
  @ApiResponse({ status: 409, description: "La acción no corresponde al estado actual." })
  warn(@Req() req: RequestWithUser, @Param("reportId", uuidParam) reportId: string, @Body(new ZodValidationPipe(moderationActionSchema)) body: ModerationActionDto) {
    return this.act(req, reportId, "warn", body);
  }

  @Post(":reportId/unpublish")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Despublicar el sitio", description: "El sitio responde 404 al público; no se borra nada y es reversible con `restore`." })
  @ApiUuidParam("reportId", "Reporte a resolver.")
  @ApiZodBody(moderationActionSchema)
  @ApiZodResponse(200, adminAbuseReportDetailResponse, "El reporte actualizado.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: "Reporte no encontrado." })
  @ApiResponse({ status: 409, description: "La acción no corresponde al estado actual." })
  unpublish(@Req() req: RequestWithUser, @Param("reportId", uuidParam) reportId: string, @Body(new ZodValidationPipe(moderationActionSchema)) body: ModerationActionDto) {
    return this.act(req, reportId, "unpublish", body);
  }

  @Post(":reportId/suspend")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Suspender la organización", description: "Bloquea la organización (superficies públicas en 404, panel en solo lectura). Reversible con `restore`." })
  @ApiUuidParam("reportId", "Reporte a resolver.")
  @ApiZodBody(moderationActionSchema)
  @ApiZodResponse(200, adminAbuseReportDetailResponse, "El reporte actualizado.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: "Reporte no encontrado." })
  @ApiResponse({ status: 409, description: "La acción no corresponde al estado actual, o la organización ya estaba bloqueada." })
  suspend(@Req() req: RequestWithUser, @Param("reportId", uuidParam) reportId: string, @Body(new ZodValidationPipe(moderationActionSchema)) body: ModerationActionDto) {
    return this.act(req, reportId, "suspend", body);
  }

  @Post(":reportId/restore")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Restaurar", description: "Deshace la advertencia, la despublicación o la suspensión de este caso, salvo que otro reporte vigente siga necesitándola. El caso queda cerrado." })
  @ApiUuidParam("reportId", "Reporte a restaurar.")
  @ApiZodBody(moderationActionSchema)
  @ApiZodResponse(200, adminAbuseReportDetailResponse, "El reporte actualizado.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: "Reporte no encontrado." })
  @ApiResponse({ status: 409, description: "La acción no corresponde al estado actual." })
  restore(@Req() req: RequestWithUser, @Param("reportId", uuidParam) reportId: string, @Body(new ZodValidationPipe(moderationActionSchema)) body: ModerationActionDto) {
    return this.act(req, reportId, "restore", body);
  }
}
