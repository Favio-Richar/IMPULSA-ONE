import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  platformBrandingResponse,
  uploadBrandingAssetResponse,
} from "@impulza/contracts";
import {
  updatePlatformBrandingSchema,
  uploadBrandingAssetSchema,
  type UpdatePlatformBrandingDto,
  type UploadBrandingAssetDto,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import type { RequestWithUser } from "../../common/request-with-user.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ADMIN_SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiRateLimited,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { AdminSessionGuard } from "../admin/guards/admin-session.guard.js";
import { PlatformBrandingService } from "./platform-branding.service.js";

@ApiTags("admin")
@ApiCookieAuth(ADMIN_SESSION_AUTH)
@Controller("admin/platform/branding")
@UseGuards(CsrfGuard, AdminSessionGuard)
export class AdminPlatformBrandingController {
  constructor(private readonly brandingService: PlatformBrandingService) {}

  @Get()
  @ApiOperation({
    summary: "Consultar configuración de marca de la plataforma",
    description:
      "Solo superadministración. Devuelve la identidad completa de la plataforma, incluyendo datos del remitente y metadatos de auditoría.",
  })
  @ApiZodResponse(200, platformBrandingResponse, "Configuración completa de la marca de plataforma.")
  @ApiResponse({ status: 401, description: "No autenticado como superadministrador." })
  @ApiResponse({ status: 403, description: "No autorizado (no es superadministrador)." })
  async getAdmin() {
    return this.brandingService.getAdmin();
  }

  @Put()
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "admin-platform-branding-update" })
  @ApiOperation({
    summary: "Actualizar marca de la plataforma",
    description:
      "Solo superadministración. Valida contraste WCAG 2.2 AA (>= 4.5:1 sobre fondo claro) para colores de marca, formato seguro https en enlaces y genera registro de auditoría.",
  })
  @ApiZodBody(updatePlatformBrandingSchema)
  @ApiZodResponse(200, platformBrandingResponse, "Marca actualizada.")
  @ApiRateLimited(30, 60)
  @ApiResponse({ status: 400, description: "Validación fallida (contraste insuficiente, formato o enlaces inválidos)." })
  @ApiResponse({ status: 401, description: "No autenticado como superadministrador." })
  @ApiResponse({ status: 403, description: "No autorizado." })
  async update(
    @Req() req: RequestWithUser,
    @Body(new ZodValidationPipe(updatePlatformBrandingSchema)) body: UpdatePlatformBrandingDto,
  ) {
    return this.brandingService.update(req.user.id, body);
  }

  @Post("reset")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "admin-platform-branding-reset" })
  @ApiOperation({
    summary: "Restablecer marca a valores por defecto",
    description:
      "Solo superadministración. Restablece la identidad a los valores oficiales de Impulza One y genera registro de auditoría.",
  })
  @ApiZodResponse(200, platformBrandingResponse, "Marca restablecida a los valores por defecto.")
  @ApiRateLimited(10, 60)
  @ApiResponse({ status: 401, description: "No autenticado como superadministrador." })
  @ApiResponse({ status: 403, description: "No autorizado." })
  async reset(@Req() req: RequestWithUser) {
    return this.brandingService.reset(req.user.id);
  }

  @Post("upload")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "admin-branding-upload" })
  @ApiOperation({
    summary: "Subir archivo de logotipo o favicon",
    description:
      "Solo superadministración. Permite PNG, JPG, WebP o SVG saneado (sin scripts ni referencias externas).",
  })
  @ApiZodBody(uploadBrandingAssetSchema)
  @ApiZodResponse(200, uploadBrandingAssetResponse, "URL pública del archivo subido.")
  @ApiRateLimited(30, 60)
  @ApiResponse({ status: 400, description: "Formato inválido, SVG con scripts o tamaño excedido." })
  @ApiResponse({ status: 401, description: "No autenticado como superadministrador." })
  @ApiResponse({ status: 403, description: "No autorizado." })
  async upload(
    @Req() req: RequestWithUser,
    @Body(new ZodValidationPipe(uploadBrandingAssetSchema)) body: UploadBrandingAssetDto,
  ) {
    return this.brandingService.uploadAsset(req.user.id, body);
  }
}
