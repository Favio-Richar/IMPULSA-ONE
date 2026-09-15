import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { PERMISSIONS, type User } from "@impulza/database";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { createSiteSchema, type CreateSiteDto } from "./dto/create-site.dto.js";
import { updateSiteSchema, type UpdateSiteDto } from "./dto/update-site.dto.js";
import { SitesService } from "./sites.service.js";

// Los sitios cuelgan de la organización en la propia ruta: así OrganizationMembershipGuard resuelve
// el tenant desde la membresía real del usuario (ADR-002) antes de que el servicio vea nada.
@Controller("organizations/:organizationId/sites")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_CREATE)
  async create(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createSiteSchema)) body: CreateSiteDto,
  ) {
    return this.sitesService.createSite(organizationId, user.id, body.name, body.slug);
  }

  // Leer no exige permiso: basta con ser miembro activo de la organización (ANALYST y SUPPORT
  // necesitan ver los sitios para hacer su trabajo).
  @Get()
  async list(@Param("organizationId") organizationId: string) {
    return this.sitesService.listSites(organizationId);
  }

  @Get(":siteId")
  async getOne(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.sitesService.getSite(organizationId, siteId);
  }

  @Patch(":siteId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  async update(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateSiteSchema)) body: UpdateSiteDto,
  ) {
    return this.sitesService.updateSite(organizationId, user.id, siteId, body);
  }

  // Archivar y no borrar: el contenido del usuario no se destruye desde un endpoint de CRUD
  // (CLAUDE.md, "no borrar trabajo existente"). Por eso es POST a una acción y no DELETE.
  @Post(":siteId/archive")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_ARCHIVE)
  async archive(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
  ) {
    return this.sitesService.archiveSite(organizationId, user.id, siteId);
  }
}
