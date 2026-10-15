import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { analyticsOverviewResponse, blockClicksResponse } from "@impulza/contracts";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiPlanLimited, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { AnalyticsReportsService } from "./analytics-reports.service.js";
import {
  analyticsOverviewQuerySchema,
  MAX_RANGE_DAYS,
  type AnalyticsOverviewQuery,
} from "./dto/analytics-overview.dto.js";
import { BLOCK_CLICKS_DEFAULT_DAYS, BLOCK_CLICKS_MAX_DAYS, blockClicksQuerySchema, type BlockClicksQuery } from "./dto/block-clicks.dto.js";

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
  @ApiPlanLimited("analyticsHistoryDays")
  async overview(
    @Param("organizationId") organizationId: string,
    @Query(new ZodValidationPipe(analyticsOverviewQuerySchema)) query: AnalyticsOverviewQuery,
  ) {
    return this.reportsService.overview(organizationId, query);
  }

  @Get("blocks/:blockId/clicks")
  @ApiOperation({
    summary: "Clics de un bloque en los últimos días",
    description:
      "Total y serie diaria de clics de un bloque (incluye los de WhatsApp), leídos de los agregados diarios — los mismos del ranking de bloques. Por defecto 30 días hasta hoy (UTC); el rango se acota al historial del plan en vez de responder 402.",
  })
  @ApiQuery({ name: "days", required: false, description: `Días hacia atrás, incluido hoy (1 a ${BLOCK_CLICKS_MAX_DAYS}). Por defecto ${BLOCK_CLICKS_DEFAULT_DAYS}.`, example: 30 })
  @ApiZodResponse(200, blockClicksResponse, "Clics del bloque en el rango.")
  @ApiResponse({ status: 400, description: "Identificador o cantidad de días inválidos." })
  @ApiResponse({ status: 404, description: "El bloque no existe o pertenece a otra organización (ADR-002)." })
  async blockClicks(
    @Param("organizationId") organizationId: string,
    @Param("blockId", new ParseUUIDPipe()) blockId: string,
    @Query(new ZodValidationPipe(blockClicksQuerySchema)) query: BlockClicksQuery,
  ) {
    return this.reportsService.blockClicks(organizationId, blockId, query.days);
  }
}
