import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { createdReportShareLinkResponse, publicReportResponse, reportShareLinkResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { createReportShareSchema, type CreateReportShareDto } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiPlanLimited,
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
import { ReportShareService } from "./report-share.service.js";

const CSV_RESPONSE = { status: 200, description: "Un CSV (UTF-8 con BOM, separado por punto y coma).", content: { "text/csv": { schema: { type: "string" as const } } } };
const GONE = "El enlace fue revocado (`LINK_REVOKED`) o venció (`LINK_EXPIRED`).";

/** Gestión de los enlaces compartidos de un informe (F9.8b). */
@ApiTags("reports")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/reports/share-links")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, PermissionGuard, RateLimitGuard)
export class ReportShareLinksController {
  constructor(private readonly shares: ReportShareService) {}

  @Get()
  @RequirePermission(PERMISSIONS.REPORT_SHARE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "report-share-list" })
  @ApiOperation({ summary: "Enlaces compartidos del informe", description: "Sin el token (no se guarda). Requiere `report.share`." })
  @ApiZodArrayResponse(200, reportShareLinkResponse, "Enlaces, del más reciente al más antiguo.")
  @ApiRateLimited(60, 60)
  list(@Param("organizationId") organizationId: string) {
    return this.shares.list(organizationId);
  }

  @Post()
  @RequirePermission(PERMISSIONS.REPORT_SHARE)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "report-share-create" })
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Crear un enlace compartido de solo lectura",
    description:
      "Periodo fijo y vencimiento obligatorio (1 a 90 días, 14 por defecto). El token viaja **solo en esta respuesta**: no se puede recuperar después. Sirve únicamente cifras agregadas de esta organización. Requiere `report.share`.",
  })
  @ApiZodBody(createReportShareSchema)
  @ApiZodResponse(201, createdReportShareLinkResponse, "Enlace creado, con su token.")
  @ApiRateLimited(30, 60)
  @ApiResponse({ status: 409, description: "Hay demasiados enlaces vigentes (`SHARE_LINK_LIMIT`)." })
  @ApiPlanLimited("analyticsHistoryDays")
  create(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createReportShareSchema)) body: CreateReportShareDto,
  ) {
    return this.shares.create(organizationId, user.id, body);
  }

  @Delete(":linkId")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.REPORT_SHARE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "report-share-revoke" })
  @ApiOperation({ summary: "Revocar un enlace", description: "Deja de servir de inmediato; es idempotente. Requiere `report.share`." })
  @ApiUuidParam("linkId", "Enlace de esta organización.")
  @ApiZodResponse(200, reportShareLinkResponse, "El enlace, ya revocado.")
  @ApiRateLimited(60, 60)
  @ApiResponse({ status: 404, description: "El enlace no existe o es de otra organización (ADR-002)." })
  revoke(@Param("organizationId") organizationId: string, @Param("linkId", new ParseUUIDPipe()) linkId: string, @CurrentUser() user: User) {
    return this.shares.revoke(organizationId, user.id, linkId);
  }
}

/**
 * Lectura pública de un informe compartido (F9.8b). Sin sesión: el token es la credencial. 404 si no existe o está mal formado, 410 si
 * fue revocado o venció. Solo cifras agregadas; con límite de peticiones; el token se redacta en los registros.
 */
@ApiTags("public-reports")
@Controller("public/reports")
@UseGuards(RateLimitGuard)
export class PublicReportsController {
  constructor(private readonly shares: ReportShareService) {}

  @Get(":token")
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "public-report" })
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @Header("X-Robots-Tag", "noindex, nofollow")
  @ApiOperation({ summary: "Leer un informe compartido" })
  @ApiZodResponse(200, publicReportResponse, "El informe del periodo fijado en el enlace, con la marca de quien lo comparte.")
  @ApiResponse({ status: 404, description: "Enlace desconocido o mal formado." })
  @ApiResponse({ status: 410, description: GONE })
  @ApiRateLimited(60, 60)
  read(@Param("token") token: string) {
    return this.shares.resolve(token);
  }

  @Get(":token/csv")
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "public-report-csv" })
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="informe.csv"')
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @ApiOperation({ summary: "Descargar un informe compartido en CSV" })
  @ApiResponse(CSV_RESPONSE)
  @ApiResponse({ status: 404, description: "Enlace desconocido o mal formado." })
  @ApiResponse({ status: 410, description: GONE })
  @ApiRateLimited(20, 60)
  csv(@Param("token") token: string): Promise<string> {
    return this.shares.resolveCsv(token);
  }
}
