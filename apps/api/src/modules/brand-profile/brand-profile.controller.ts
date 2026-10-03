import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { brandProfileResponse, resolvedBrandResponse, uploadBrandProfileAssetResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  updateBrandProfileSchema,
  uploadBrandingAssetSchema,
  type UpdateBrandProfileDto,
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
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { BrandProfileService } from "./brand-profile.service.js";

@ApiTags("brand-profile")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/brand-profile")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class BrandProfileController {
  constructor(private readonly brandProfileService: BrandProfileService) {}

  @Get()
  @ApiOperation({
    summary: "Consultar perfil de marca de la organización",
    description:
      "Devuelve el perfil de marca de la organización indicada. Solo accesible para miembros activos de la organización (ADR-002).",
  })
  @ApiZodResponse(200, brandProfileResponse, "Perfil de marca de la organización.")
  @ApiResponse({ status: 401, description: "No autenticado." })
  @ApiResponse({ status: 404, description: "Organización no encontrada o sin membresía activa." })
  async getBrandProfile(@Param("organizationId") organizationId: string) {
    return this.brandProfileService.getByOrg(organizationId);
  }

  @Get("resolved")
  @ApiOperation({
    summary: "Marca efectiva de la organización (con la cascada aplicada)",
    description:
      "Lo que realmente se muestra: la marca de la organización y, donde no configuró algo, la de la plataforma (ADR-028 §4). Solo para miembros activos (ADR-002).",
  })
  @ApiZodResponse(200, resolvedBrandResponse, "Marca efectiva de la organización.")
  @ApiResponse({ status: 401, description: "No autenticado." })
  @ApiResponse({ status: 404, description: "Organización no encontrada o sin membresía activa." })
  async getResolvedBrand(@Param("organizationId") organizationId: string) {
    return this.brandProfileService.resolveBrand(organizationId);
  }

  @Put()
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.THEME_MANAGE)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "org-brand-profile-update" })
  @ApiOperation({
    summary: "Actualizar perfil de marca de la organización",
    description:
      "Actualiza la identidad del negocio. Requiere el permiso theme.manage (OWNER o ADMIN). Valida contraste WCAG 2.2 AA (>= 4.5:1 sobre fondo blanco) y URL seguras.",
  })
  @ApiZodBody(updateBrandProfileSchema)
  @ApiZodResponse(200, brandProfileResponse, "Perfil de marca actualizado.")
  @ApiRateLimited(30, 60)
  @ApiResponse({ status: 400, description: "Validación fallida (contraste insuficiente o formato inválido)." })
  @ApiResponse({ status: 401, description: "No autenticado." })
  @ApiResponse({ status: 403, description: "No autorizado (permisos insuficientes)." })
  @ApiResponse({ status: 404, description: "Organización no encontrada o sin membresía activa." })
  async updateBrandProfile(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateBrandProfileSchema)) body: UpdateBrandProfileDto,
  ) {
    return this.brandProfileService.update(user.id, organizationId, body);
  }

  @Post("upload")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.THEME_MANAGE)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "org-brand-profile-upload" })
  @ApiOperation({
    summary: "Subir logo o favicon de la organización",
    description:
      "Permite PNG, JPG, WebP o SVG saneado. Requiere el permiso theme.manage (OWNER o ADMIN).",
  })
  @ApiZodBody(uploadBrandingAssetSchema)
  @ApiZodResponse(200, uploadBrandProfileAssetResponse, "URL pública del archivo subido.")
  @ApiRateLimited(30, 60)
  @ApiResponse({ status: 400, description: "Formato inválido, SVG con scripts o tamaño excedido." })
  @ApiResponse({ status: 401, description: "No autenticado." })
  @ApiResponse({ status: 403, description: "No autorizado (permisos insuficientes)." })
  @ApiResponse({ status: 404, description: "Organización no encontrada o sin membresía activa." })
  async uploadAsset(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(uploadBrandingAssetSchema)) body: UploadBrandingAssetDto,
  ) {
    return this.brandProfileService.uploadAsset(user.id, organizationId, body);
  }
}
