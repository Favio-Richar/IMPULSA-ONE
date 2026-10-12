import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  adminMarketplaceListResponse,
  adminMarketplaceListingResponse,
  marketplaceInstallResponse,
  marketplaceOrganizationResponse,
  marketplaceSubmissionResponse,
  publicMarketplaceResponse,
} from "@impulza/contracts";
import { PERMISSIONS } from "@impulza/database";
import {
  installListingSchema,
  listMarketplaceQuerySchema,
  marketplaceDecisionSchema,
  submitListingSchema,
  type InstallListingDto,
  type ListMarketplaceQuery,
  type MarketplaceDecisionDto,
  type SubmitListingDto,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import type { RequestWithUser } from "../../common/request-with-user.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ADMIN_SESSION_AUTH, SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiRateLimited, ApiUuidParam, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { uuidParamSchema } from "../admin/dto/admin-queries.dto.js";
import { AdminSessionGuard } from "../admin/guards/admin-session.guard.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import type { RequestWithMembership } from "../organizations/request-with-membership.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { MarketplaceService } from "./marketplace.service.js";

const uuid = new ZodValidationPipe(uuidParamSchema);

/** Directorio público: solo lo aprobado. Sin sesión. */
@ApiTags("public-marketplace")
@Controller("public/marketplace")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicMarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get()
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-marketplace" })
  @ApiOperation({ summary: "Directorio del marketplace", description: "Integraciones y plantillas aprobadas por la plataforma. Lo no aprobado no aparece." })
  @ApiZodResponse(200, publicMarketplaceResponse, "Las publicaciones aprobadas.")
  @ApiRateLimited(120, 60)
  list() {
    return this.marketplace.publicDirectory();
  }
}

/** Marketplace desde el panel de una organización (F10.6). Instalar y publicar tienen permisos distintos. */
@ApiTags("marketplace")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/marketplace")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, PermissionGuard, RateLimitGuard)
export class OrganizationMarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get()
  @RequirePermission(PERMISSIONS.MARKETPLACE_INSTALL)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "marketplace-list" })
  @ApiOperation({ summary: "Directorio con el estado de instalación de esta organización, y sus publicaciones propias" })
  @ApiZodResponse(200, marketplaceOrganizationResponse, "Directorio y publicaciones propias.")
  @ApiRateLimited(120, 60)
  list(@Param("organizationId") organizationId: string) {
    return this.marketplace.organizationView(organizationId);
  }

  @Post("submissions")
  @RequirePermission(PERMISSIONS.MARKETPLACE_SUBMIT)
  @RateLimit({ limit: 20, windowSeconds: 3600, keyPrefix: "marketplace-submit" })
  @ApiOperation({ summary: "Publicar una integración o plantilla propia", description: "Queda en revisión: nadie la ve ni la instala hasta que la plataforma la apruebe." })
  @ApiZodBody(submitListingSchema)
  @ApiZodResponse(201, marketplaceSubmissionResponse, "La publicación, en revisión.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 422, description: "Tope de publicaciones, o una plantilla que no cumple el catálogo de bloques." })
  @ApiRateLimited(20, 3600)
  submit(
    @Param("organizationId") organizationId: string,
    @Body(new ZodValidationPipe(submitListingSchema)) body: SubmitListingDto,
    @Req() req: RequestWithMembership,
  ) {
    return this.marketplace.submit(organizationId, req.user.id, body);
  }

  @Post("submissions/:listingId/withdraw")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.MARKETPLACE_SUBMIT)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "marketplace-withdraw" })
  @ApiOperation({ summary: "Retirar una publicación propia", description: "Deja de verse y se desinstala de las organizaciones que la tenían." })
  @ApiUuidParam("listingId", "Publicación.")
  @ApiZodResponse(200, marketplaceSubmissionResponse, "La publicación retirada.")
  @ApiResponse({ status: 404, description: "No es una publicación de esta organización." })
  @ApiRateLimited(30, 60)
  withdraw(@Param("organizationId") organizationId: string, @Param("listingId", uuid) listingId: string, @Req() req: RequestWithMembership) {
    return this.marketplace.withdrawOwn(organizationId, req.user.id, listingId);
  }

  @Post(":listingId/install")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.MARKETPLACE_INSTALL)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "marketplace-install" })
  @ApiOperation({
    summary: "Instalar una publicación aprobada",
    description: "Plantilla: queda entre las plantillas propias. Integración: crea un destino de webhooks hacia la dirección indicada (la clave de firma se muestra una sola vez).",
  })
  @ApiUuidParam("listingId", "Publicación.")
  @ApiZodBody(installListingSchema)
  @ApiZodResponse(200, marketplaceInstallResponse, "Instalada.")
  @ApiResponse({ status: 404, description: "La publicación no existe o no está aprobada." })
  @ApiResponse({ status: 409, description: "Ya está instalada, o se llegó al tope de plantillas." })
  @ApiResponse({ status: 422, description: "Falta la dirección de destino, o se llegó al tope de instalaciones o destinos." })
  @ApiRateLimited(30, 60)
  install(
    @Param("organizationId") organizationId: string,
    @Param("listingId", uuid) listingId: string,
    @Body(new ZodValidationPipe(installListingSchema)) body: InstallListingDto,
    @Req() req: RequestWithMembership,
  ) {
    return this.marketplace.install(organizationId, req.user.id, listingId, body);
  }

  @Delete(":listingId/install")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PERMISSIONS.MARKETPLACE_INSTALL)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "marketplace-uninstall" })
  @ApiOperation({ summary: "Desinstalar", description: "Quita la plantilla propia o el destino que creó. Lo que ya aplicaste en tus páginas no se toca." })
  @ApiUuidParam("listingId", "Publicación.")
  @ApiResponse({ status: 204, description: "Desinstalada." })
  @ApiResponse({ status: 404, description: "No la tienes instalada." })
  @ApiRateLimited(30, 60)
  async uninstall(@Param("organizationId") organizationId: string, @Param("listingId", uuid) listingId: string, @Req() req: RequestWithMembership): Promise<void> {
    await this.marketplace.uninstall(organizationId, req.user.id, listingId);
  }
}

/** Cola de revisión de la plataforma (F10.6). Solo superadministración: misma puerta que el resto de `/admin`. */
@ApiTags("admin")
@ApiCookieAuth(ADMIN_SESSION_AUTH)
@ApiResponse({ status: 401, description: "Sin sesión de administración válida." })
@ApiResponse({ status: 403, description: "Petición que modifica estado sin la cabecera anti-CSRF." })
@Controller("admin/marketplace")
@UseGuards(CsrfGuard, AdminSessionGuard)
export class AdminMarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get()
  @ApiOperation({ summary: "Publicaciones del marketplace", description: "Por estado y tipo; primero lo que espera revisión." })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "kind", required: false })
  @ApiZodResponse(200, adminMarketplaceListResponse, "Las publicaciones.")
  list(@Query(new ZodValidationPipe(listMarketplaceQuerySchema)) query: ListMarketplaceQuery) {
    return this.marketplace.adminList(query);
  }

  @Post(":listingId/approve")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Aprobar", description: "Pasa al directorio. También reactiva una retirada." })
  @ApiUuidParam("listingId", "Publicación.")
  @ApiZodResponse(200, adminMarketplaceListingResponse, "La publicación aprobada.")
  @ApiResponse({ status: 409, description: "Su estado no permite aprobarla." })
  approve(@Req() req: RequestWithUser, @Param("listingId", uuid) listingId: string) {
    return this.marketplace.approve(req.user.id, listingId);
  }

  @Post(":listingId/reject")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rechazar", description: "Motivo obligatorio: lo ve el socio." })
  @ApiUuidParam("listingId", "Publicación.")
  @ApiZodBody(marketplaceDecisionSchema)
  @ApiZodResponse(200, adminMarketplaceListingResponse, "La publicación rechazada.")
  @ApiResponse({ status: 409, description: "Solo se rechaza lo que está en revisión." })
  reject(@Req() req: RequestWithUser, @Param("listingId", uuid) listingId: string, @Body(new ZodValidationPipe(marketplaceDecisionSchema)) body: MarketplaceDecisionDto) {
    return this.marketplace.reject(req.user.id, listingId, body.reason);
  }

  @Post(":listingId/withdraw")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Retirar", description: "Deja de verse y se desinstala de todas las organizaciones. Motivo obligatorio y auditado." })
  @ApiUuidParam("listingId", "Publicación.")
  @ApiZodBody(marketplaceDecisionSchema)
  @ApiZodResponse(200, adminMarketplaceListingResponse, "La publicación retirada.")
  @ApiResponse({ status: 409, description: "Su estado no permite retirarla." })
  withdraw(@Req() req: RequestWithUser, @Param("listingId", uuid) listingId: string, @Body(new ZodValidationPipe(marketplaceDecisionSchema)) body: MarketplaceDecisionDto) {
    return this.marketplace.withdraw(req.user.id, listingId, body.reason);
  }
}
