import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { privateTemplateResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { createPrivateTemplateSchema, type CreatePrivateTemplateDto } from "@impulza/validation";
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
import type { RequestWithMembership } from "../organizations/request-with-membership.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { PrivateTemplatesService } from "./private-templates.service.js";

/** Plantillas privadas de una organización (F9.7c, ADR-028): visibles solo para ella y, para una agencia, para quien trabaja en sus clientes. */
@ApiTags("templates")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/private-templates")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class PrivateTemplatesController {
  constructor(private readonly privateTemplates: PrivateTemplatesService) {}

  @Get()
  @ApiOperation({
    summary: "Plantillas privadas disponibles en esta organización",
    description:
      "Las propias y, si quien consulta trabaja aquí con acceso delegado de una agencia, las de esa agencia (`fromAgency`). Nunca las de otra organización ni las del catálogo público. Basta ser miembro activo.",
  })
  @ApiZodArrayResponse(200, privateTemplateResponse, "Plantillas privadas, de la más reciente a la más antigua.")
  list(@Param("organizationId") organizationId: string, @Req() req: RequestWithMembership) {
    return this.privateTemplates.list(organizationId, req.membership);
  }

  @Post()
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "private-template-create" })
  @ApiOperation({
    summary: "Guardar una página como plantilla privada",
    description:
      "Copia los bloques visibles de una página de esta organización (sin referencias a sus formularios, servicios ni productos) y, si se pide, su tema y fondo del catálogo. Hasta 50 por organización. Requiere `page.manage`.",
  })
  @ApiZodBody(createPrivateTemplateSchema)
  @ApiZodResponse(201, privateTemplateResponse, "Plantilla guardada.")
  @ApiRateLimited(20, 60)
  @ApiResponse({ status: 404, description: "Sitio o página no encontrados, o de otra organización (ADR-002)." })
  @ApiResponse({ status: 409, description: "Página vacía (`EMPTY_PAGE`) o tope alcanzado (`TEMPLATE_LIMIT`)." })
  @ApiResponse({ status: 422, description: "Un bloque de la página no cumple el esquema de plantillas." })
  create(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createPrivateTemplateSchema)) body: CreatePrivateTemplateDto,
  ) {
    return this.privateTemplates.create(organizationId, user.id, body);
  }

  @Delete(":templateId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({
    summary: "Borrar una plantilla privada propia",
    description: "Solo las de esta organización; las de una agencia las borra la agencia. Los sitios que ya la usaron no cambian. Requiere `page.manage`.",
  })
  @ApiUuidParam("templateId", "Plantilla privada de esta organización.")
  @ApiResponse({ status: 204, description: "Plantilla borrada." })
  @ApiResponse({ status: 404, description: "No existe, o es de otra organización (ADR-002)." })
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("templateId", new ParseUUIDPipe()) templateId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.privateTemplates.remove(organizationId, user.id, templateId);
  }
}
