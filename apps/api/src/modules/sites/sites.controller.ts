import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { siteResponse, siteThemeResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiUuidParam,
  ApiZodArrayResponse,
  ApiZodBody,
  ApiZodResponse,
  ApiPlanLimited,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { assignThemeSchema, type AssignThemeDto } from "../themes/dto/theme.dto.js";
import { createSiteSchema, type CreateSiteDto } from "./dto/create-site.dto.js";
import { updateSiteSchema, type UpdateSiteDto } from "./dto/update-site.dto.js";
import { SitesService } from "./sites.service.js";

const SITE_NOT_FOUND = "Sitio no encontrado, o pertenece a otra organización (ADR-002).";
// Un slug reservado por la plataforma (`www`, `api`, …) no llega hasta acá: lo rechaza
// `publicSlugSchema` como 400. El 409 es solo colisión con algo que ya ocupa ese espacio público.
const SLUG_TAKEN = "Ese slug ya lo usa otro sitio, o lo ocupa una redirección viva de otro sitio.";

// Los sitios cuelgan de la organización en la propia ruta: así OrganizationMembershipGuard resuelve
// el tenant desde la membresía real del usuario (ADR-002) antes de que el servicio vea nada.
@ApiTags("sites")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Post()
  @ApiPlanLimited("sites")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_CREATE)
  @ApiOperation({
    summary: "Crear un sitio",
    description:
      "Requiere el permiso `site.create`. El slug es la identidad pública del sitio (`slug.dominio`) y es único en toda la plataforma, no solo dentro de la organización.",
  })
  @ApiZodBody(createSiteSchema)
  @ApiZodResponse(201, siteResponse, "Sitio creado en estado `DRAFT`.")
  @ApiResponse({ status: 409, description: SLUG_TAKEN })
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
  @ApiOperation({
    summary: "Listar los sitios de la organización",
    description: "Solo pide membresía activa: ANALYST y SUPPORT necesitan verlos para hacer su trabajo.",
  })
  @ApiZodArrayResponse(200, siteResponse, "Sitios de la organización, archivados incluidos.")
  async list(@Param("organizationId") organizationId: string) {
    return this.sitesService.listSites(organizationId);
  }

  @Get(":siteId")
  @ApiOperation({ summary: "Leer un sitio" })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodResponse(200, siteResponse, "El sitio solicitado.")
  @ApiResponse({ status: 404, description: SITE_NOT_FOUND })
  async getOne(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.sitesService.getSite(organizationId, siteId);
  }

  @Patch(":siteId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({
    summary: "Editar un sitio",
    description:
      "Requiere el permiso `site.update`. Cambiarle el slug a un sitio **publicado** deja una redirección desde el anterior, para no romper en silencio los enlaces ya compartidos; un sitio en borrador nunca fue alcanzable, así que no genera redirección. Un cuerpo vacío es 400, no un 200 que no hace nada.",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodBody(updateSiteSchema)
  @ApiZodResponse(200, siteResponse, "Sitio actualizado.")
  @ApiResponse({ status: 404, description: SITE_NOT_FOUND })
  @ApiResponse({ status: 409, description: SLUG_TAKEN })
  async update(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateSiteSchema)) body: UpdateSiteDto,
  ) {
    return this.sitesService.updateSite(organizationId, user.id, siteId, body);
  }

  // El tema efectivo del sitio: leerlo solo pide membresía, porque es lo que necesitan tanto el
  // constructor como cualquier vista de solo lectura del panel.
  @Get(":siteId/theme")
  @ApiOperation({
    summary: "Leer el tema efectivo del sitio",
    description:
      "Nunca responde «sin tema»: si el sitio no eligió ninguno, devuelve el del catálogo por defecto con `isDefault: true`. Una página pública siempre tiene apariencia.",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodResponse(200, siteThemeResponse, "Tema con el que se muestra el sitio.")
  @ApiResponse({ status: 404, description: SITE_NOT_FOUND })
  async getTheme(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.sitesService.getSiteTheme(organizationId, siteId);
  }

  // PUT y no PATCH: el cuerpo reemplaza por completo la elección de tema del sitio, y `null` es un
  // valor con significado propio (volver al tema por defecto), no un campo omitido.
  @Put(":siteId/theme")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({
    summary: "Aplicar un tema al sitio",
    description:
      "Requiere `site.update` y no `theme.manage`: aplicar apariencia es configurar el sitio, no crear temas — un EDITOR puede cambiar de tema sin poder inventar paletas. `themeId: null` devuelve el sitio al tema por defecto. PUT y no PATCH porque `null` es un valor con significado, no un campo omitido.",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodBody(assignThemeSchema)
  @ApiZodResponse(200, siteResponse, "Sitio con el tema aplicado.")
  @ApiResponse({
    status: 404,
    description: `${SITE_NOT_FOUND} El tema tampoco se confirma si es de otra organización.`,
  })
  async setTheme(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(assignThemeSchema)) body: AssignThemeDto,
  ) {
    return this.sitesService.setSiteTheme(organizationId, user.id, siteId, body.themeId);
  }

  // Archivar y no borrar: el contenido del usuario no se destruye desde un endpoint de CRUD
  // (CLAUDE.md, "no borrar trabajo existente"). Por eso es POST a una acción y no DELETE.
  @Post(":siteId/archive")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_ARCHIVE)
  @ApiOperation({
    summary: "Archivar un sitio",
    description:
      "Requiere el permiso `site.archive`. Acción y no DELETE: el contenido del usuario no se destruye desde un CRUD. Es idempotente — archivar dos veces no falla ni duplica la entrada de auditoría.",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodResponse(201, siteResponse, "Sitio en estado `ARCHIVED`.")
  @ApiResponse({ status: 404, description: SITE_NOT_FOUND })
  async archive(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
  ) {
    return this.sitesService.archiveSite(organizationId, user.id, siteId);
  }
}
