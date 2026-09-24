import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { analyticsOverviewResponse } from "@impulza/contracts";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { AnalyticsReportsService } from "./analytics-reports.service.js";
import {
  analyticsOverviewQuerySchema,
  MAX_RANGE_DAYS,
  type AnalyticsOverviewQuery,
} from "./dto/analytics-overview.dto.js";

/**
 * Lectura del dashboard de conversión (F3.7). Solo lectura: basta ser miembro activo de la
 * organización, igual que listar contactos o enlaces — ningún rol de la organización tiene
 * vedado ver cómo le va a su propio negocio.
 */
@ApiTags("analytics")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/analytics")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class AnalyticsReportsController {
  constructor(private readonly reportsService: AnalyticsReportsService) {}

  @Get("overview")
  @ApiOperation({
    summary: "Resumen de conversión de la organización (o de uno de sus sitios)",
    description:
      "Totales, serie diaria, embudo, dispositivo, país, campañas (UTM) y rankings de páginas, bloques, formularios, enlaces cortos y QR, leídos de los agregados diarios (F3.6) — nunca del evento crudo. Fechas en UTC. Los enlaces cortos y QR son de nivel organización y se incluyen también al filtrar por sitio.",
  })
  @ApiQuery({ name: "from", required: true, description: "Día inicial, `YYYY-MM-DD` (UTC).", example: "2026-09-01" })
  @ApiQuery({ name: "to", required: true, description: `Día final, incluido. Rango máximo ${MAX_RANGE_DAYS} días.`, example: "2026-09-30" })
  @ApiQuery({ name: "siteId", required: false, description: "Limitar a un sitio de la organización." })
  @ApiZodResponse(200, analyticsOverviewResponse, "El resumen del rango pedido.")
  @ApiResponse({ status: 400, description: "Fechas inválidas, invertidas o rango mayor al máximo." })
  @ApiResponse({ status: 404, description: "El sitio no existe o pertenece a otra organización (ADR-002)." })
  async overview(
    @Param("organizationId") organizationId: string,
    @Query(new ZodValidationPipe(analyticsOverviewQuerySchema)) query: AnalyticsOverviewQuery,
  ) {
    return this.reportsService.overview(organizationId, query);
  }
}
