import { Controller, Get, Header, Param, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { auditListResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { auditExportQuerySchema, auditQuerySchema, type AuditExportQuery, type AuditQuery } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiRateLimited, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { AuditQueryService } from "./audit-query.service.js";

const CSV_RESPONSE = { status: 200, description: "Un CSV (UTF-8 con BOM, separado por punto y coma).", content: { "text/csv": { schema: { type: "string" as const } } } };

const FILTERS = [
  { name: "actor", required: false, type: String, description: "Fragmento del correo de quien actuó." },
  { name: "action", required: false, type: String, description: "Acción exacta o su prefijo (`publish_request`)." },
  { name: "targetType", required: false, type: String, description: "Tipo de recurso (`Page`, `PublishRequest`…)." },
  { name: "from", required: false, type: String, description: "Desde (AAAA-MM-DD, incluido)." },
  { name: "to", required: false, type: String, description: "Hasta (AAAA-MM-DD, incluido). Rango máximo: 366 días." },
] as const;

function Filters(): MethodDecorator {
  return (target, key, descriptor) => {
    for (const filter of FILTERS) ApiQuery(filter)(target, key, descriptor);
  };
}

/** La auditoría de la propia organización: quién hizo qué y cuándo. */
@ApiTags("audit")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/audit-logs")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, PermissionGuard)
export class OrganizationAuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @RequirePermission(PERMISSIONS.AUDIT_VIEW)
  @Filters()
  @ApiOperation({
    summary: "Auditoría de la organización",
    description:
      "De la más reciente a la más antigua, con filtros por persona, acción, recurso y fechas, y paginación en el servidor. Requiere `audit.view` (propietario y administradores). Las acciones que hizo una agencia llevan `delegatedBy`.",
  })
  @ApiQuery({ name: "limit", required: false, type: Number, description: "1 a 100 (25 por defecto)." })
  @ApiQuery({ name: "offset", required: false, type: Number })
  @ApiZodResponse(200, auditListResponse, "Una página de la auditoría.")
  @ApiResponse({ status: 403, description: "Falta el permiso `audit.view`, o es una agencia con acceso delegado (`AGENCY_LIMIT`)." })
  list(@Param("organizationId") organizationId: string, @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery) {
    return this.audit.listForOrganization(organizationId, query);
  }

  @Get("export")
  @RequirePermission(PERMISSIONS.AUDIT_VIEW)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "audit-export" })
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="auditoria.csv"')
  @Header("Cache-Control", "no-store")
  @Filters()
  @ApiOperation({
    summary: "Exportar la auditoría en CSV",
    description:
      "Los mismos filtros, sin paginar y con un tope de 10 000 filas (el CSV avisa si se cortó). Las celdas que una hoja de cálculo ejecutaría como fórmula salen neutralizadas. Exportar queda registrado (`audit.exported`). Requiere `audit.view`.",
  })
  @ApiResponse(CSV_RESPONSE)
  @ApiRateLimited(10, 60)
  export(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(auditExportQuerySchema)) query: AuditExportQuery,
  ): Promise<string> {
    return this.audit.exportForOrganization(organizationId, user.id, query);
  }
}

/** Lo que el equipo de una agencia hizo en sus clientes (y solo eso). */
@ApiTags("audit")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/agency/audit-logs")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, PermissionGuard)
export class AgencyAuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @RequirePermission(PERMISSIONS.AUDIT_VIEW)
  @Filters()
  @ApiOperation({
    summary: "Auditoría de la agencia sobre sus clientes",
    description:
      "Solo las acciones que personas de esta agencia hicieron con acceso delegado, nunca lo que el cliente hace por su cuenta. Una persona acotada a ciertos clientes (F9.6b) ve solo esos. Filtro extra `client` (organización del cliente). Requiere `audit.view` y que la organización sea una agencia.",
  })
  @ApiQuery({ name: "client", required: false, type: String, description: "Organización del cliente." })
  @ApiQuery({ name: "limit", required: false, type: Number, description: "1 a 100 (25 por defecto)." })
  @ApiQuery({ name: "offset", required: false, type: Number })
  @ApiZodResponse(200, auditListResponse, "Una página de la auditoría delegada.")
  @ApiResponse({ status: 403, description: "Falta el permiso, o la organización no es una agencia (`NOT_AN_AGENCY`)." })
  @ApiResponse({ status: 404, description: "El cliente no existe, no es de esta agencia o está fuera del alcance de esta persona." })
  list(@Param("organizationId") organizationId: string, @CurrentUser() user: User, @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery) {
    return this.audit.listForAgency(organizationId, user.id, query);
  }

  @Get("export")
  @RequirePermission(PERMISSIONS.AUDIT_VIEW)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "audit-export" })
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="auditoria-agencia.csv"')
  @Header("Cache-Control", "no-store")
  @Filters()
  @ApiOperation({
    summary: "Exportar la auditoría de la agencia en CSV",
    description: "Mismos filtros y garantías que la exportación de una organización. Requiere `audit.view`.",
  })
  @ApiQuery({ name: "client", required: false, type: String, description: "Organización del cliente." })
  @ApiResponse(CSV_RESPONSE)
  @ApiRateLimited(10, 60)
  export(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(auditExportQuerySchema)) query: AuditExportQuery,
  ): Promise<string> {
    return this.audit.exportForAgency(organizationId, user.id, query);
  }
}
