import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { smartCtaResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { smartCtaSchema, type SmartCta } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiUuidParam, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { SmartCtaService } from "./smart-cta.service.js";

const NOT_FOUND = "Página no encontrada, o de otra organización (ADR-002).";

@ApiTags("smart-cta")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/pages/:pageId/smart-cta")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class SmartCtaController {
  constructor(private readonly smartCta: SmartCtaService) {}

  @Get()
  @ApiOperation({ summary: "Reglas de Smart CTA de la página", description: "Qué acción pasa a ser la principal según horario, dispositivo, campaña o disponibilidad de reservas (F6.6)." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("pageId", "Página.")
  @ApiZodResponse(200, smartCtaResponse, "Reglas en orden (gana la primera que se cumple).")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async get(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string, @Param("pageId") pageId: string) {
    return this.smartCta.get(organizationId, siteId, pageId);
  }

  @Put()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({
    summary: "Guardar las reglas de Smart CTA",
    description: "Reemplaza la lista entera (hasta 5, de un catálogo cerrado). Cada regla apunta a un bloque de acción de esta página. Rige en vivo, sin publicar.",
  })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("pageId", "Página.")
  @ApiZodBody(smartCtaSchema)
  @ApiZodResponse(200, smartCtaResponse, "Reglas guardadas.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 422, description: "`SMART_CTA_BLOCK_INVALID`: una regla apunta a un bloque que no es de acción o no es de esta página." })
  async update(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(smartCtaSchema)) body: SmartCta,
  ) {
    return this.smartCta.update(organizationId, user.id, siteId, pageId, body);
  }
}
