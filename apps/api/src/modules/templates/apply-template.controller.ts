import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { applyTemplateResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { applyTemplateSchema, type ApplyTemplateInput } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiUuidParam,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import type { RequestWithMembership } from "../organizations/request-with-membership.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { ApplyTemplateService } from "./apply-template.service.js";
import { TEMPLATE_NOT_FOUND } from "./templates.service.js";

// Aplicar una plantilla es trabajo de contenido sobre una página (`page.manage`, igual que los
// bloques); aplicar además su tema y fondo pide `site.update`, que verifica el servicio.
@ApiTags("templates")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/pages/:pageId/apply-template")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class ApplyTemplateController {
  constructor(private readonly applyTemplateService: ApplyTemplateService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({
    summary: "Aplicar una plantilla a la página",
    description:
      "Reemplaza los bloques de la página por los de la plantilla, personalizados con `personalization`, y con `applyAppearance` aplica al sitio su tema y fondo (en vivo). Los bloques nuevos no se publican solos. Los anteriores se recuperan restaurando una versión publicada; si hay cambios que ninguna versión guarda, responde 409 `UNPUBLISHED_CHANGES` salvo que `discardUnpublishedChanges` sea `true`. La respuesta trae el tema y fondo anteriores para deshacer la apariencia.",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("pageId", "Página del sitio cuyos bloques se reemplazan.")
  @ApiZodBody(applyTemplateSchema)
  @ApiZodResponse(200, applyTemplateResponse, "Plantilla aplicada: los bloques nuevos y la apariencia anterior.")
  @ApiResponse({ status: 403, description: "Sin `page.manage`, o con `applyAppearance` sin `site.update`." })
  @ApiResponse({ status: 404, description: `Sitio o página de otra organización, o inexistente. ${TEMPLATE_NOT_FOUND}` })
  @ApiResponse({
    status: 409,
    description: "`code: UNPUBLISHED_CHANGES`: la página tiene cambios sin publicar y no se confirmó descartarlos.",
  })
  @ApiResponse({ status: 422, description: "La personalización deja un bloque inválido. `issues` indica el campo." })
  async apply(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @CurrentUser() user: User,
    @Req() request: RequestWithMembership,
    @Body(new ZodValidationPipe(applyTemplateSchema)) body: ApplyTemplateInput,
  ) {
    return this.applyTemplateService.applyTemplate(organizationId, user.id, request.membership.roleId, siteId, pageId, body, request.membership);
  }
}
