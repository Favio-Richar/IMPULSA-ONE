import { FeatureFlagGuard, RequireFeature } from "../feature-flags/feature-flag.guard.js";
import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { aiInsightsResponse } from "@impulza/contracts";
import type { User } from "@impulza/database";
import { aiInsightsRequestSchema, type AiInsightsRequest } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiUuidParam, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { SiteInsightsService } from "./site-insights.service.js";

// Leer la analítica no exige permiso (basta ser miembro activo, F3.7): la lectura con IA sigue el
// mismo criterio — el rol ANALYST existe justamente para esto. La cuota del plan y el límite por
// usuario de `AiService` acotan el gasto.
@ApiTags("ai")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/ai")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, FeatureFlagGuard)
@RequireFeature("ia_generativa")
export class SiteInsightsController {
  constructor(private readonly insights: SiteInsightsService) {}

  @Post("insights")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Lectura comercial del sitio con IA",
    description:
      "Explica las métricas agregadas del sitio en el período (7, 30 o 90 días) y propone hasta 3 acciones con su razón, apoyándose en la salud de la página de inicio (F6.4). Sin datos personales. Si no hay muestra suficiente, `sample.enough` es falso y no se compara con el período anterior. No guarda nada.",
  })
  @ApiUuidParam("siteId", "Sitio a analizar.")
  @ApiZodBody(aiInsightsRequestSchema)
  @ApiZodResponse(200, aiInsightsResponse, "Lectura y acciones recomendadas.")
  @ApiResponse({ status: 402, description: "`PLAN_LIMIT_REACHED`: cuota mensual de IA agotada, o el período supera el historial de analítica del plan." })
  @ApiResponse({ status: 404, description: "Sitio no encontrado, o de otra organización (ADR-002)." })
  @ApiResponse({ status: 429, description: "Demasiadas solicitudes al asistente en el último minuto." })
  @ApiResponse({ status: 503, description: "`AI_UNAVAILABLE`: no hay modelos configurados para el análisis o ninguno respondió." })
  async analyze(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(aiInsightsRequestSchema)) body: AiInsightsRequest,
  ) {
    return this.insights.analyze(organizationId, user.id, siteId, body);
  }
}
