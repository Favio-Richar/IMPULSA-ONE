import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { mediaAssetResponse, mediaLibraryResponse, mediaUploadResponse } from "@impulza/contracts";
import { PERMISSIONS } from "@impulza/database";
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
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { uuidParamSchema } from "../admin/dto/admin-queries.dto.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import type { RequestWithMembership } from "../organizations/request-with-membership.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { requestMediaUploadSchema, type RequestMediaUploadInput } from "./dto/media.dto.js";
import { MediaService } from "./media.service.js";

/**
 * Biblioteca de medios (PP1, ADR-006). Subir es un proceso en tres pasos: pedir la URL (reserva
 * cuota), subir el archivo **directo al bucket** desde el navegador, y confirmar (la API verifica
 * el tamaño y el tipo real antes de procesarlo).
 */
@ApiTags("media")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/media")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  @ApiOperation({ summary: "Biblioteca de medios", description: "Archivos de la organización, uso de almacenamiento y si el proveedor está configurado." })
  @ApiZodResponse(200, mediaLibraryResponse, "Archivos (más nuevos primero) y uso de la cuota.")
  library(@Param("organizationId") organizationId: string) {
    return this.mediaService.library(organizationId);
  }

  @Post("uploads")
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.MEDIA_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 3600, keyPrefix: "media-upload" })
  @ApiOperation({
    summary: "Pedir una URL de subida",
    description:
      "Requiere `media.manage`. Imágenes JPG, PNG, WebP o AVIF de hasta 8 MB (nunca SVG) y, si la instalación tiene ffmpeg (PP6, ADR-007), videos MP4, WebM o MOV de hasta 30 MB y 15 s. Reserva la cuota de almacenamiento del plan y devuelve una URL prefirmada de 10 minutos con el tipo y el tamaño firmados.",
  })
  @ApiZodBody(requestMediaUploadSchema)
  @ApiZodResponse(201, mediaUploadResponse, "El archivo reservado y cómo subirlo.")
  @ApiResponse({ status: 400, description: "Formato, tamaño o nombre inválido (detalle en `issues`)." })
  @ApiResponse({
    status: 503,
    description:
      "`STORAGE_NOT_CONFIGURED`: la instalación todavía no tiene proveedor de almacenamiento. `VIDEO_NOT_CONFIGURED`: se pidió subir un video y no hay ffmpeg configurado.",
  })
  @ApiPlanLimited("storageMb")
  @ApiRateLimited(60, 3600)
  requestUpload(
    @Param("organizationId") organizationId: string,
    @Req() req: RequestWithMembership,
    @Body(new ZodValidationPipe(requestMediaUploadSchema)) body: RequestMediaUploadInput,
  ) {
    return this.mediaService.requestUpload(organizationId, req.user, body);
  }

  @Post(":assetId/confirm")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.MEDIA_MANAGE)
  @ApiOperation({
    summary: "Confirmar una subida",
    description: "Verifica en el bucket el tamaño exacto y el tipo real (bytes mágicos) y encola el procesamiento. Confirmar dos veces devuelve el estado actual.",
  })
  @ApiUuidParam("assetId", "Archivo a confirmar.")
  @ApiZodResponse(200, mediaAssetResponse, "El archivo, ahora en proceso.")
  @ApiResponse({ status: 404, description: "Archivo no encontrado." })
  @ApiResponse({ status: 409, description: "El archivo todavía no terminó de subirse." })
  @ApiResponse({ status: 422, description: "Lo subido no es lo declarado (tamaño o tipo). Se borra y queda `FAILED`." })
  confirm(@Param("organizationId") organizationId: string, @Param("assetId", new ZodValidationPipe(uuidParamSchema)) assetId: string) {
    return this.mediaService.confirm(organizationId, assetId);
  }

  @Get(":assetId")
  @ApiOperation({ summary: "Ver un archivo", description: "Útil para seguir el procesamiento hasta `READY`." })
  @ApiUuidParam("assetId", "Archivo a leer.")
  @ApiZodResponse(200, mediaAssetResponse, "El archivo.")
  @ApiResponse({ status: 404, description: "Archivo no encontrado." })
  get(@Param("organizationId") organizationId: string, @Param("assetId", new ZodValidationPipe(uuidParamSchema)) assetId: string) {
    return this.mediaService.get(organizationId, assetId);
  }

  @Delete(":assetId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.MEDIA_MANAGE)
  @ApiOperation({ summary: "Borrar un archivo", description: "Se rechaza si una página lo usa (en su borrador o en lo publicado). Queda auditado." })
  @ApiUuidParam("assetId", "Archivo a borrar.")
  @ApiResponse({ status: 204, description: "Borrado, con todas sus variantes." })
  @ApiResponse({ status: 404, description: "Archivo no encontrado." })
  @ApiResponse({ status: 409, description: "`MEDIA_IN_USE`: `usages` lista dónde se usa: páginas (`kind: page`) o fondos de sitio (`kind: background`)." })
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("assetId", new ZodValidationPipe(uuidParamSchema)) assetId: string,
    @Req() req: RequestWithMembership,
  ): Promise<void> {
    await this.mediaService.remove(organizationId, req.user, assetId);
  }
}
