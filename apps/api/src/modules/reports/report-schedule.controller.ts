import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { reportRunResponse, reportScheduleResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { createReportScheduleSchema, updateReportScheduleSchema, type CreateReportScheduleDto, type UpdateReportScheduleDto } from "@impulza/validation";
import { z } from "zod";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiRateLimited,
  ApiUuidParam,
  ApiZodArrayResponse,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { ReportScheduleService } from "./report-schedule.service.js";

const deletedResponse = z.object({ deleted: z.literal(true) });

/** Informes programados por correo (F9.8c). Mismo permiso que compartir el informe: `report.share`. */
@ApiTags("reports")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/reports/schedules")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, PermissionGuard, RateLimitGuard)
export class ReportSchedulesController {
  constructor(private readonly schedules: ReportScheduleService) {}

  @Get()
  @RequirePermission(PERMISSIONS.REPORT_SHARE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "report-schedule-list" })
  @ApiOperation({ summary: "Informes programados", description: "Requiere `report.share`." })
  @ApiZodArrayResponse(200, reportScheduleResponse, "Programaciones, de la más reciente a la más antigua.")
  @ApiRateLimited(60, 60)
  list(@Param("organizationId") organizationId: string) {
    return this.schedules.list(organizationId);
  }

  @Get("runs")
  @RequirePermission(PERMISSIONS.REPORT_SHARE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "report-schedule-runs" })
  @ApiOperation({ summary: "Registro de ejecuciones", description: "Las últimas 50 ejecuciones, con su estado, intentos y código de error. Requiere `report.share`." })
  @ApiZodArrayResponse(200, reportRunResponse, "Ejecuciones, de la más reciente a la más antigua.")
  @ApiRateLimited(60, 60)
  runs(@Param("organizationId") organizationId: string) {
    return this.schedules.listRuns(organizationId);
  }

  @Post()
  @RequirePermission(PERMISSIONS.REPORT_SHARE)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "report-schedule-create" })
  @ApiOperation({
    summary: "Programar un informe",
    description: "Semanal (lunes) o mensual (día 1), 08:00 UTC, hasta 5 destinatarios. Nunca envía de inmediato. Requiere `report.share`.",
  })
  @ApiZodBody(createReportScheduleSchema)
  @ApiZodResponse(201, reportScheduleResponse, "Programación creada.")
  @ApiRateLimited(30, 60)
  @ApiResponse({ status: 409, description: "Se alcanzó el máximo de programaciones (`SCHEDULE_LIMIT`)." })
  create(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createReportScheduleSchema)) body: CreateReportScheduleDto,
  ) {
    return this.schedules.create(organizationId, user.id, body);
  }

  @Patch(":scheduleId")
  @RequirePermission(PERMISSIONS.REPORT_SHARE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "report-schedule-update" })
  @ApiOperation({ summary: "Pausar, reanudar o editar una programación", description: "Reanudar retoma desde la próxima ocurrencia. Requiere `report.share`." })
  @ApiUuidParam("scheduleId", "Programación de esta organización.")
  @ApiZodBody(updateReportScheduleSchema)
  @ApiZodResponse(200, reportScheduleResponse, "La programación actualizada.")
  @ApiRateLimited(60, 60)
  @ApiResponse({ status: 404, description: "No existe o es de otra organización (ADR-002)." })
  update(
    @Param("organizationId") organizationId: string,
    @Param("scheduleId", new ParseUUIDPipe()) scheduleId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateReportScheduleSchema)) body: UpdateReportScheduleDto,
  ) {
    return this.schedules.update(organizationId, user.id, scheduleId, body);
  }

  @Delete(":scheduleId")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.REPORT_SHARE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "report-schedule-delete" })
  @ApiOperation({ summary: "Eliminar una programación", description: "Se borra con su registro de ejecuciones. Requiere `report.share`." })
  @ApiUuidParam("scheduleId", "Programación de esta organización.")
  @ApiZodResponse(200, deletedResponse, "Eliminada.")
  @ApiRateLimited(60, 60)
  @ApiResponse({ status: 404, description: "No existe o es de otra organización (ADR-002)." })
  remove(@Param("organizationId") organizationId: string, @Param("scheduleId", new ParseUUIDPipe()) scheduleId: string, @CurrentUser() user: User) {
    return this.schedules.remove(organizationId, user.id, scheduleId);
  }
}
