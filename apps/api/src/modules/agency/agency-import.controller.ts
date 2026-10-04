import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { agencyImportDetailResponse, agencyImportListResponse, agencyImportSummary } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  agencyImportDetailQuerySchema,
  importCsvBodySchema,
  type AgencyImportDetailQuery,
  type ImportCsvBody,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiRateLimited, ApiUuidParam, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { AgencyImportService } from "./agency-import.service.js";

const CSV_RESPONSE = { status: 200, description: "Un CSV (UTF-8 con BOM, separado por punto y coma).", content: { "text/csv": { schema: { type: "string" as const } } } };

/**
 * Importar clientes por CSV (F9.5d, ADR-028 §2). `:organizationId` es la organización **agencia**. Las rutas viven aparte de las de
 * `clients/:clientId/...` para que `import` e `imports` nunca se confundan con el identificador de un cliente.
 */
@ApiTags("agency")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/agency/clients")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class AgencyImportController {
  constructor(private readonly importService: AgencyImportService) {}

  @Get("import/template")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="plantilla-clientes.csv"')
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Plantilla CSV para importar clientes", description: "El encabezado y dos filas de ejemplo. Requiere `agency.manage`." })
  @ApiResponse(CSV_RESPONSE)
  @ApiResponse({ status: 403, description: "La organización no es una agencia (`NOT_AN_AGENCY`) o falta el permiso." })
  template(@Param("organizationId") organizationId: string): Promise<string> {
    return this.importService.template(organizationId);
  }

  @Post("import")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 5, windowSeconds: 60, keyPrefix: "agency-client-import" })
  @ApiOperation({
    summary: "Subir un CSV de clientes para importarlos",
    description:
      "El servidor valida el archivo **entero, fila por fila**: una fila con problemas no frena a las demás y queda en el informe con su motivo. Las filas válidas se encolan y las crea el worker (invitando a cada propietario); aquí no se crea ningún cliente, así que responde al instante y el avance se consulta con `GET imports/:id`. Máximo 200 filas y 45 000 caracteres. Reimportar el mismo archivo no duplica (las filas cuyo cliente ya existe quedan como tales). Respeta el cupo de clientes del plan. Una importación a la vez por agencia. Requiere `agency.manage`.",
  })
  @ApiZodBody(importCsvBodySchema)
  @ApiZodResponse(201, agencyImportSummary, "La importación creada: totales por resultado y avance.")
  @ApiRateLimited(5, 60)
  @ApiResponse({ status: 400, description: "El archivo no sirve: vacío, sin las columnas de la plantilla, con comillas sin cerrar o con más de 200 filas (`INVALID_IMPORT_FILE`)." })
  @ApiResponse({ status: 409, description: "Ya hay una importación en curso (`IMPORT_IN_PROGRESS`)." })
  create(@Param("organizationId") organizationId: string, @CurrentUser() user: User, @Body(new ZodValidationPipe(importCsvBodySchema)) body: ImportCsvBody) {
    return this.importService.create(organizationId, user.id, body);
  }

  @Get("imports")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @ApiOperation({ summary: "Las importaciones recientes de la agencia", description: "Las 20 últimas, de más nueva a más antigua. Requiere `agency.manage`." })
  @ApiZodResponse(200, agencyImportListResponse, "Importaciones recientes.")
  list(@Param("organizationId") organizationId: string) {
    return this.importService.list(organizationId);
  }

  @Get("imports/:importId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @ApiOperation({ summary: "Avance e informe de una importación", description: "Estado, contadores y las filas (paginadas) con el resultado de cada una. Requiere `agency.manage`." })
  @ApiUuidParam("importId", "Identificador de la importación.")
  @ApiQuery({ name: "page", required: false, description: "Página de filas, desde 1." })
  @ApiQuery({ name: "pageSize", required: false, description: "Filas por página, 1 a 100 (50 por defecto)." })
  @ApiQuery({ name: "onlyErrors", required: false, description: "`true` para ver solo las filas con problema." })
  @ApiZodResponse(200, agencyImportDetailResponse, "La importación y una página de sus filas.")
  @ApiResponse({ status: 404, description: "Esa importación no existe (o es de otra agencia)." })
  detail(
    @Param("organizationId") organizationId: string,
    @Param("importId", new ParseUUIDPipe()) importId: string,
    @Query(new ZodValidationPipe(agencyImportDetailQuerySchema)) query: AgencyImportDetailQuery,
  ) {
    return this.importService.detail(organizationId, importId, query);
  }

  @Get("imports/:importId/errors.csv")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="errores-importacion.csv"')
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Informe de errores de una importación, en CSV",
    description: "Las filas con problema con su motivo y la línea del archivo. Las celdas que una hoja de cálculo ejecutaría como fórmula salen neutralizadas. Requiere `agency.manage`.",
  })
  @ApiUuidParam("importId", "Identificador de la importación.")
  @ApiResponse(CSV_RESPONSE)
  @ApiResponse({ status: 404, description: "Esa importación no existe (o es de otra agencia)." })
  errors(@Param("organizationId") organizationId: string, @Param("importId", new ParseUUIDPipe()) importId: string): Promise<string> {
    return this.importService.errorsCsv(organizationId, importId);
  }
}
