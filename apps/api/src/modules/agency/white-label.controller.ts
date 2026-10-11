import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { panelBrandResponse, setClientWhiteLabelResponse, uploadBrandProfileAssetResponse, whiteLabelSettingsResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  setClientWhiteLabelSchema,
  updateWhiteLabelSchema,
  uploadBrandingAssetSchema,
  type SetClientWhiteLabelDto,
  type UpdateWhiteLabelDto,
  type UploadBrandingAssetDto,
} from "@impulza/validation";
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
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { WhiteLabelService } from "./white-label.service.js";

/** La marca blanca de una agencia y su activación por cliente. */
@ApiTags("agency")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/agency/white-label")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class AgencyWhiteLabelController {
  constructor(private readonly whiteLabel: WhiteLabelService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @ApiOperation({ summary: "Marca blanca de la agencia", description: "Lo que la agencia configuró y en cuántos clientes está activa. Requiere `agency.manage`." })
  @ApiZodResponse(200, whiteLabelSettingsResponse, "Marca blanca actual (vacía si aún no se configuró).")
  @ApiResponse({ status: 403, description: "Falta el permiso, o la organización no es una agencia (`NOT_AN_AGENCY`)." })
  get(@Param("organizationId") organizationId: string) {
    return this.whiteLabel.get(organizationId);
  }

  @Put()
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "white-label-update" })
  @ApiOperation({
    summary: "Configurar la marca blanca",
    description:
      "Nombre, logos subidos desde esta pantalla, colores con contraste WCAG 2.2 AA, correo de soporte y pie. El nombre no puede ser el de la plataforma, el de otra marca blanca ni el de un negocio ajeno (`BRAND_NAME_TAKEN`). No se puede quitar el nombre mientras esté activa en algún cliente (`WHITE_LABEL_IN_USE`). Requiere `agency.manage`.",
  })
  @ApiZodBody(updateWhiteLabelSchema)
  @ApiZodResponse(200, whiteLabelSettingsResponse, "Marca blanca guardada.")
  @ApiRateLimited(30, 60)
  @ApiResponse({ status: 400, description: "Validación fallida (contraste, enlaces externos, formato)." })
  @ApiResponse({ status: 409, description: "Nombre ajeno (`BRAND_NAME_TAKEN`) o marca en uso (`WHITE_LABEL_IN_USE`)." })
  update(@Param("organizationId") organizationId: string, @CurrentUser() user: User, @Body(new ZodValidationPipe(updateWhiteLabelSchema)) body: UpdateWhiteLabelDto) {
    return this.whiteLabel.update(organizationId, user.id, body);
  }

  @Post("upload")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "white-label-upload" })
  @ApiOperation({ summary: "Subir un logo o favicon de la marca blanca", description: "PNG, JPG, WebP o SVG saneado, con las mismas reglas que la marca de la plataforma. Requiere `agency.manage`." })
  @ApiZodBody(uploadBrandingAssetSchema)
  @ApiZodResponse(200, uploadBrandProfileAssetResponse, "URL pública del archivo subido.")
  @ApiRateLimited(30, 60)
  @ApiResponse({ status: 400, description: "Formato inválido, SVG con scripts o tamaño excedido." })
  upload(@Param("organizationId") organizationId: string, @Body(new ZodValidationPipe(uploadBrandingAssetSchema)) body: UploadBrandingAssetDto) {
    return this.whiteLabel.upload(organizationId, body);
  }

  @Put("clients/:relationId")
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "white-label-client" })
  @ApiOperation({
    summary: "Activar o desactivar la marca blanca para un cliente",
    description:
      "Solo con la relación activa y con la marca configurada (`CLIENT_NOT_ACTIVE`, `WHITE_LABEL_NOT_CONFIGURED`). Queda en la auditoría de la agencia y en la del cliente. Requiere `agency.manage`.",
  })
  @ApiUuidParam("relationId", "Relación con el cliente (`AgencyClient`).")
  @ApiZodBody(setClientWhiteLabelSchema)
  @ApiZodResponse(200, setClientWhiteLabelResponse, "Estado de la marca blanca en ese cliente.")
  @ApiRateLimited(60, 60)
  @ApiResponse({ status: 404, description: "El cliente no existe o es de otra agencia." })
  @ApiResponse({ status: 409, description: "Relación no activa o marca sin configurar." })
  setForClient(
    @Param("organizationId") organizationId: string,
    @Param("relationId", new ParseUUIDPipe()) relationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(setClientWhiteLabelSchema)) body: SetClientWhiteLabelDto,
  ) {
    return this.whiteLabel.setForClient(organizationId, user.id, relationId, body.enabled);
  }
}

/** La marca con que debe vestirse el panel de una organización (la de su agencia, si la tiene activa). Basta ser miembro. */
@ApiTags("organizations")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/panel-brand")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class PanelBrandController {
  constructor(private readonly whiteLabel: WhiteLabelService) {}

  @Get()
  @ApiOperation({
    summary: "Marca del panel de la organización",
    description:
      "Si la organización es cliente de una agencia con la marca blanca activa y la relación vigente, la marca de esa agencia (con el nombre de la agencia y el pie); si no, `brand: null` y el panel usa la de la plataforma. Basta ser miembro activo.",
  })
  @ApiZodResponse(200, panelBrandResponse, "Marca del panel, o `null`.")
  get(@Param("organizationId") organizationId: string) {
    return this.whiteLabel.panelBrand(organizationId);
  }
}
