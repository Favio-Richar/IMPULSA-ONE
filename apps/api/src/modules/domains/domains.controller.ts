import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { siteDomainResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { createSiteDomainSchema, type CreateSiteDomainInput } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiUuidParam,
  ApiZodArrayResponse,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { DOMAIN_NOT_FOUND, DOMAIN_TAKEN, DomainsService } from "./domains.service.js";

@ApiTags("domains")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/domains")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class DomainsController {
  constructor(private readonly domainsService: DomainsService) {}

  @Get()
  @ApiOperation({ summary: "Listar los dominios propios de un sitio" })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodArrayResponse(200, siteDomainResponse, "Dominios del sitio, del más antiguo al más reciente.")
  async list(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.domainsService.list(organizationId, siteId);
  }

  @Post()
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @RateLimit({ limit: 20, windowSeconds: 3600, keyPrefix: "domain-create" })
  @ApiOperation({
    summary: "Agregar un dominio propio",
    description:
      "Requiere `site.update`. Solo nombres de host públicos (sin IPs, puertos, rutas ni redes internas); el dominio de la plataforma no se puede reclamar. Queda `PENDING` hasta verificar el TXT `_impulza.<dominio>`.",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodBody(createSiteDomainSchema)
  @ApiZodResponse(201, siteDomainResponse, "Dominio agregado, con el registro TXT a crear.")
  @ApiResponse({ status: 409, description: `${DOMAIN_TAKEN} O ya está agregado a este sitio.` })
  @ApiResponse({ status: 422, description: "Dominio de la plataforma, o el sitio ya tiene el máximo de dominios." })
  async create(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createSiteDomainSchema)) body: CreateSiteDomainInput,
  ) {
    return this.domainsService.create(organizationId, user.id, siteId, body);
  }

  @Post(":domainId/verify")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @RateLimit({ limit: 30, windowSeconds: 600, keyPrefix: "domain-verify" })
  @ApiOperation({
    summary: "Verificar un dominio propio",
    description:
      "Requiere `site.update`. Consulta el TXT `_impulza.<dominio>` (solo DNS, con tiempo acotado; nunca una petición HTTP al dominio). Sin el valor esperado queda `FAILED`, con un código estable en `lastCheckError`, y se puede reintentar.",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("domainId", "Dominio a verificar.")
  @ApiZodResponse(200, siteDomainResponse, "Resultado de la verificación.")
  @ApiResponse({ status: 404, description: DOMAIN_NOT_FOUND })
  @ApiResponse({ status: 409, description: DOMAIN_TAKEN })
  async verify(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("domainId") domainId: string,
    @CurrentUser() user: User,
  ) {
    return this.domainsService.verify(organizationId, user.id, siteId, domainId);
  }

  @Delete(":domainId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Quitar un dominio propio", description: "Requiere `site.update`. El sitio deja de responder en ese dominio." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("domainId", "Dominio a quitar.")
  @ApiResponse({ status: 204, description: "Dominio quitado." })
  @ApiResponse({ status: 404, description: DOMAIN_NOT_FOUND })
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("domainId") domainId: string,
    @CurrentUser() user: User,
  ) {
    await this.domainsService.remove(organizationId, user.id, siteId, domainId);
  }
}
