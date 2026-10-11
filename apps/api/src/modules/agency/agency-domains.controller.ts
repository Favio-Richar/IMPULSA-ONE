import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { agencyPortalDomainResponse, publicPortalResolution } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { createSiteDomainSchema, customDomainSchema, type CreateSiteDomainInput } from "@impulza/validation";
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
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { AgencyDomainsService, PORTAL_DOMAIN_NOT_FOUND, PORTAL_DOMAIN_TAKEN } from "./agency-domains.service.js";

/** Dominio propio del portal de una agencia (F9.7d, ADR-028 §5). */
@ApiTags("agency")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/agency/portal-domains")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class AgencyPortalDomainsController {
  constructor(private readonly domains: AgencyDomainsService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @ApiOperation({ summary: "Dominios del portal de la agencia", description: "Del más antiguo al más reciente, con el TXT que hay que crear. Requiere `agency.manage`." })
  @ApiZodArrayResponse(200, agencyPortalDomainResponse, "Dominios del portal.")
  list(@Param("organizationId") organizationId: string) {
    return this.domains.list(organizationId);
  }

  @Post()
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 3600, keyPrefix: "portal-domain-create" })
  @ApiOperation({
    summary: "Agregar un dominio para el portal",
    description:
      "Solo nombres de host públicos; el dominio de la plataforma no se puede reclamar. Queda `PENDING` hasta verificar el TXT `_impulza.<dominio>`: un dominio sin verificar nunca sirve el portal. Requiere `agency.manage`.",
  })
  @ApiZodBody(createSiteDomainSchema)
  @ApiZodResponse(201, agencyPortalDomainResponse, "Dominio agregado, pendiente de verificación.")
  @ApiRateLimited(20, 3600)
  @ApiResponse({ status: 409, description: PORTAL_DOMAIN_TAKEN })
  @ApiResponse({ status: 422, description: "Dominio de la plataforma, o tope de dominios alcanzado." })
  create(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createSiteDomainSchema)) body: CreateSiteDomainInput,
  ) {
    return this.domains.create(organizationId, user.id, body);
  }

  @Post(":domainId/verify")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 30, windowSeconds: 3600, keyPrefix: "portal-domain-verify" })
  @ApiOperation({ summary: "Verificar un dominio del portal", description: "Consulta el TXT por DNS (nunca una petición HTTP al dominio). Requiere `agency.manage`." })
  @ApiUuidParam("domainId", "Dominio de portal de esta agencia.")
  @ApiZodResponse(200, agencyPortalDomainResponse, "Estado tras verificar (`VERIFIED` o `FAILED` con su código).")
  @ApiRateLimited(30, 3600)
  @ApiResponse({ status: 404, description: PORTAL_DOMAIN_NOT_FOUND })
  @ApiResponse({ status: 409, description: PORTAL_DOMAIN_TAKEN })
  verify(@Param("organizationId") organizationId: string, @Param("domainId", new ParseUUIDPipe()) domainId: string, @CurrentUser() user: User) {
    return this.domains.verify(organizationId, user.id, domainId);
  }

  @Delete(":domainId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @ApiOperation({ summary: "Quitar un dominio del portal", description: "El portal deja de servirse en él. Requiere `agency.manage`." })
  @ApiUuidParam("domainId", "Dominio de portal de esta agencia.")
  @ApiResponse({ status: 204, description: "Dominio quitado." })
  @ApiResponse({ status: 404, description: PORTAL_DOMAIN_NOT_FOUND })
  async remove(@Param("organizationId") organizationId: string, @Param("domainId", new ParseUUIDPipe()) domainId: string, @CurrentUser() user: User): Promise<void> {
    await this.domains.remove(organizationId, user.id, domainId);
  }
}

/**
 * Resolución pública de un dominio de portal (F9.7d). La usará el portal del cliente (F9.7e) en cada visita a un host que no es de la
 * plataforma: devuelve solo la marca pública de la agencia. Mismo 404 para un dominio inexistente, pendiente, fallido o de una agencia
 * bloqueada o sin marca: sin pistas.
 */
@ApiTags("public-domains")
@Controller("public/portal")
@UseGuards(RateLimitGuard)
export class PublicPortalController {
  constructor(private readonly domains: AgencyDomainsService) {}

  @Get(":hostname")
  @RateLimit({ limit: 600, windowSeconds: 60, keyPrefix: "public-portal" })
  @ApiOperation({ summary: "Resolver el dominio de un portal de agencia verificado" })
  @ApiZodResponse(200, publicPortalResolution, "La marca pública de la agencia que sirve ese dominio.")
  @ApiResponse({ status: 404, description: "Dominio no encontrado." })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (600 por minuto y origen)." })
  async resolve(@Param("hostname") hostname: string) {
    const parsed = customDomainSchema.safeParse(hostname);
    if (!parsed.success) throw new NotFoundException("Dominio no encontrado.");
    const resolution = await this.domains.resolvePublic(parsed.data);
    if (!resolution) throw new NotFoundException("Dominio no encontrado.");
    return resolution;
  }
}
