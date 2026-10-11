import { Controller, Get, Header, Param, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { reportResponse } from "@impulza/contracts";
import { reportQuerySchema, type ReportQuery } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiPlanLimited, ApiRateLimited, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { ReportsService } from "./reports.service.js";

const CSV_RESPONSE = { status: 200, description: "Un CSV (UTF-8 con BOM, separado por punto y coma).", content: { "text/csv": { schema: { type: "string" as const } } } };

/**
 * Informe por cliente (F9.8). Solo lectura de cifras agregadas de la propia organización: basta ser miembro activo (como el resto de la
 * analítica). Para una agencia con acceso delegado, `reports` cuenta como módulo «Analítica» (F9.6b): si no se lo dieron, la puerta lo niega.
 */
@ApiTags("reports")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/reports")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, RateLimitGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("summary")
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "report-summary" })
  @ApiOperation({
    summary: "Informe del cliente con comparación de periodos",
    description:
      "Visitas, clics, contactos, reservas, pedidos y ventas del periodo, comparados con el periodo anterior (misma duración) y con el mismo periodo del año anterior; conversión, serie diaria y rankings. Una comparación fuera del historial del plan se informa como no disponible. Solo cifras agregadas.",
  })
  @ApiQuery({ name: "from", required: true, example: "2026-09-01" })
  @ApiQuery({ name: "to", required: true, example: "2026-09-30" })
  @ApiZodResponse(200, reportResponse, "El informe del periodo.")
  @ApiRateLimited(60, 60)
  @ApiResponse({ status: 400, description: "Fechas inválidas, invertidas o periodo mayor a 366 días." })
  @ApiPlanLimited("analyticsHistoryDays")
  summary(@Param("organizationId") organizationId: string, @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery) {
    return this.reports.build(organizationId, query);
  }

  @Get("summary.csv")
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "report-csv" })
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="informe.csv"')
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "El informe en CSV",
    description: "Mismas cifras y comparaciones que el informe, con las celdas que una hoja de cálculo ejecutaría como fórmula neutralizadas.",
  })
  @ApiQuery({ name: "from", required: true, example: "2026-09-01" })
  @ApiQuery({ name: "to", required: true, example: "2026-09-30" })
  @ApiResponse(CSV_RESPONSE)
  @ApiRateLimited(20, 60)
  summaryCsv(@Param("organizationId") organizationId: string, @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery): Promise<string> {
    return this.reports.buildCsv(organizationId, query);
  }
}
