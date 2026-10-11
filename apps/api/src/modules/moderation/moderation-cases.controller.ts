import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { moderationCaseListResponse, moderationCaseResponse } from "@impulza/contracts";
import { PERMISSIONS } from "@impulza/database";
import { createAppealSchema, type CreateAppealDto } from "@impulza/validation";
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
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { uuidParamSchema } from "../admin/dto/admin-queries.dto.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { AllowWhenOrganizationBlocked } from "../organizations/allow-when-blocked.decorator.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import type { RequestWithMembership } from "../organizations/request-with-membership.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { ModerationCasesService } from "./moderation-cases.service.js";

/**
 * Medidas de moderación sobre el negocio y su apelación (F9.9c). Permiso `moderation.appeal` (propietario y administrador).
 * Funciona con la organización bloqueada: apelar es justamente el camino para salir de una suspensión (ADR-005 §6).
 */
@ApiTags("moderation")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/moderation/cases")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, PermissionGuard, RateLimitGuard)
export class ModerationCasesController {
  constructor(private readonly cases: ModerationCasesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.MODERATION_APPEAL)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "moderation-cases-list" })
  @ApiOperation({
    summary: "Medidas de moderación del negocio",
    description:
      "Advertencias, despublicaciones y suspensiones vigentes, apelaciones abiertas y las ya resueltas, con la explicación del equipo. No incluye el texto del reporte ni datos de quien denunció.",
  })
  @ApiZodResponse(200, moderationCaseListResponse, "Casos que afectan al negocio.")
  @ApiRateLimited(60, 60)
  list(@Param("organizationId") organizationId: string) {
    return this.cases.list(organizationId);
  }

  @Post(":caseId/appeal")
  @HttpCode(HttpStatus.OK)
  @AllowWhenOrganizationBlocked()
  @RequirePermission(PERMISSIONS.MODERATION_APPEAL)
  @RateLimit({ limit: 10, windowSeconds: 3600, keyPrefix: "moderation-appeal" })
  @ApiOperation({
    summary: "Apelar una medida",
    description:
      "Una vez por decisión. La medida sigue vigente mientras el equipo revisa, el caso vuelve a la cola y se avisa al equipo. Funciona con la organización bloqueada.",
  })
  @ApiUuidParam("caseId", "Caso a apelar.")
  @ApiZodBody(createAppealSchema)
  @ApiZodResponse(200, moderationCaseResponse, "El caso, ahora en revisión.")
  @ApiResponse({ status: 400, description: "Texto inválido (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: "Caso no encontrado en esta organización." })
  @ApiResponse({ status: 409, description: "El caso no tiene una medida apelable o ya fue apelado." })
  @ApiRateLimited(10, 3600)
  appeal(
    @Param("organizationId") organizationId: string,
    @Param("caseId", new ZodValidationPipe(uuidParamSchema)) caseId: string,
    @Body(new ZodValidationPipe(createAppealSchema)) body: CreateAppealDto,
    @Req() req: RequestWithMembership,
  ) {
    return this.cases.appeal(organizationId, caseId, req.user.id, body.text);
  }
}
