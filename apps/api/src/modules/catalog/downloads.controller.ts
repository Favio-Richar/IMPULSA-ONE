import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { productFileUploadResponse, productResponse, publicDownloadResponse, publicDownloadUrlResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { requestProductFileUploadSchema, type RequestProductFileUploadInput } from "@impulza/validation";
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
import { PRODUCT_NOT_FOUND } from "./catalog-setup.service.js";
import { DOWNLOAD_NOT_FOUND, DownloadsService } from "./downloads.service.js";
import { FILE_NOT_FOUND, ONLY_DIGITAL, ProductFilesService } from "./product-files.service.js";

/** Archivo en venta de un producto digital (F5.11b, ADR-015): subir, confirmar y quitar. */
@ApiTags("catalog")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/catalog/products/:productId/file")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, PermissionGuard)
export class ProductFilesController {
  constructor(private readonly files: ProductFilesService) {}

  @Post()
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: "Pedir la subida del archivo en venta",
    description: "Requiere `catalog.manage`. Solo productos digitales. Reserva cuota del plan y devuelve una URL prefirmada al bucket privado (10 min, tipo y tamaño firmados).",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("productId", "Producto digital.")
  @ApiZodBody(requestProductFileUploadSchema)
  @ApiZodResponse(201, productFileUploadResponse, "URL de subida.")
  @ApiResponse({ status: 404, description: PRODUCT_NOT_FOUND })
  @ApiResponse({ status: 422, description: `${ONLY_DIGITAL} O: cuota de almacenamiento del plan superada.` })
  @ApiResponse({ status: 503, description: "`DOWNLOADS_NOT_CONFIGURED`: no hay bucket privado configurado." })
  requestUpload(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("productId") productId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(requestProductFileUploadSchema)) body: RequestProductFileUploadInput,
  ) {
    return this.files.requestUpload(organizationId, user.id, siteId, productId, body);
  }

  @Post(":fileId/confirm")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Confirmar el archivo subido",
    description: "Verifica en el bucket el tamaño exacto y el tipo real por bytes mágicos; reemplaza el archivo anterior del producto.",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("productId", "Producto digital.")
  @ApiUuidParam("fileId", "Archivo subido.")
  @ApiZodResponse(200, productResponse, "Producto con su archivo.")
  @ApiResponse({ status: 404, description: `${PRODUCT_NOT_FOUND} O: ${FILE_NOT_FOUND}` })
  @ApiResponse({ status: 409, description: "El archivo todavía no terminó de subirse." })
  @ApiResponse({ status: 422, description: "El archivo no coincide con el tamaño o el formato declarados (se borra)." })
  confirm(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("productId") productId: string,
    @Param("fileId") fileId: string,
    @CurrentUser() user: User,
  ) {
    return this.files.confirm(organizationId, user.id, siteId, productId, fileId);
  }

  @Delete()
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Quitar el archivo en venta", description: "Los compradores dejan de poder descargarlo." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("productId", "Producto digital.")
  @ApiZodResponse(200, productResponse, "Producto sin archivo.")
  @ApiResponse({ status: 404, description: `${PRODUCT_NOT_FOUND} O: ${FILE_NOT_FOUND}` })
  remove(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string, @Param("productId") productId: string, @CurrentUser() user: User) {
    return this.files.remove(organizationId, user.id, siteId, productId);
  }
}

/**
 * Descarga del archivo comprado (F5.11b, ADR-015): sin sesión; el enlace firmado del correo es la
 * credencial y el pago se verifica en cada uso. La página de `apps/web` (`/pedido/descarga/:token`)
 * es quien llama; el navegador nunca habla directo con la API.
 */
@ApiTags("public-catalog")
@Controller("public/downloads/:token")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicDownloadsController {
  constructor(private readonly downloads: DownloadsService) {}

  @Get()
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "public-download-view" })
  @ApiOperation({ summary: "Estado de la descarga de un pedido", description: "Producto, archivo y si se puede descargar. No cuenta como descarga." })
  @ApiZodResponse(200, publicDownloadResponse, "Estado de la descarga.")
  @ApiResponse({ status: 404, description: DOWNLOAD_NOT_FOUND })
  view(@Param("token") token: string) {
    return this.downloads.view(token);
  }

  @Post("url")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "public-download-url" })
  @ApiOperation({
    summary: "URL firmada para descargar",
    description: "Cuenta una descarga (tope por pedido) y devuelve una URL del bucket privado que vence en 5 minutos. Solo pedidos pagados o entregados, sin devolución total ni contracargo.",
  })
  @ApiZodResponse(200, publicDownloadUrlResponse, "URL de descarga.")
  @ApiResponse({ status: 404, description: DOWNLOAD_NOT_FOUND })
  @ApiResponse({ status: 409, description: "El pedido no entrega el archivo ahora (`awaiting_payment`, `revoked`, `limit_reached`, `unavailable`)." })
  @ApiRateLimited(10, 600)
  issueUrl(@Param("token") token: string) {
    return this.downloads.issueUrl(token);
  }
}
