import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { pageResponse } from "@impulza/contracts";
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
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import {
  createPageSchema,
  reorderPagesSchema,
  updatePageSchema,
  type CreatePageDto,
  type ReorderPagesDto,
  type UpdatePageDto,
} from "./dto/page.dto.js";
import { PagesService } from "./pages.service.js";

const PAGE_NOT_FOUND =
  "Página no encontrada: no existe, está en la papelera, o el sitio pertenece a otra organización (ADR-002).";
const SLUG_TAKEN = "Ya existe una página con ese slug en este sitio.";

@ApiTags("pages")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/pages")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class PagesController {
  constructor(private readonly pagesService: PagesService) {}

  // Leer no exige permiso: basta con ser miembro activo (mismo criterio que los sitios, F2.2).
  @Get()
  @ApiOperation({
    summary: "Listar las páginas del sitio",
    description:
      "En el orden del sitio (`position`, siempre 0..n-1 sin huecos). Las de la papelera no aparecen. Solo pide membresía activa.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de las páginas.")
  @ApiZodArrayResponse(200, pageResponse, "Páginas vivas del sitio, ordenadas.")
  @ApiResponse({ status: 404, description: "Sitio no encontrado, o de otra organización (ADR-002)." })
  async list(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.pagesService.listPages(organizationId, siteId);
  }

  @Get(":pageId")
  @ApiOperation({ summary: "Leer una página" })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página del sitio.")
  @ApiZodResponse(200, pageResponse, "La página solicitada.")
  @ApiResponse({ status: 404, description: PAGE_NOT_FOUND })
  async getOne(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
  ) {
    return this.pagesService.getPage(organizationId, siteId, pageId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({
    summary: "Crear una página",
    description:
      "Requiere el permiso `page.manage`. Se agrega al final del orden. `visibility` por defecto es `PUBLIC`; ocultarla la saca del menú pero sigue alcanzable por enlace directo.",
  })
  @ApiUuidParam("siteId", "Sitio donde se crea la página.")
  @ApiZodBody(createPageSchema)
  @ApiZodResponse(201, pageResponse, "Página creada en estado `DRAFT`, al final del orden.")
  @ApiResponse({ status: 404, description: "Sitio no encontrado, o de otra organización (ADR-002)." })
  @ApiResponse({ status: 409, description: SLUG_TAKEN })
  async create(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createPageSchema)) body: CreatePageDto,
  ) {
    return this.pagesService.createPage(organizationId, user.id, siteId, body.slug, body.visibility);
  }

  // Antes que `:pageId` para que "reorder" no se interprete como el id de una página.
  @Put("reorder")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({
    summary: "Reordenar las páginas del sitio",
    description:
      "Requiere `page.manage`. Se manda el orden **completo**, no «mové esta a la posición 3»: así el resultado no depende del orden en que lleguen varias peticiones ni deja huecos. La lista debe traer exactamente todas las páginas vivas del sitio, sin repetidos.",
  })
  @ApiUuidParam("siteId", "Sitio cuyas páginas se reordenan.")
  @ApiZodBody(reorderPagesSchema)
  @ApiZodArrayResponse(200, pageResponse, "Páginas en el nuevo orden.")
  @ApiResponse({
    status: 400,
    description:
      "La lista tiene identificadores repetidos, o no incluye exactamente todas las páginas vivas del sitio.",
  })
  @ApiResponse({ status: 404, description: "Sitio no encontrado, o de otra organización (ADR-002)." })
  async reorder(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(reorderPagesSchema)) body: ReorderPagesDto,
  ) {
    return this.pagesService.reorderPages(organizationId, user.id, siteId, body.pageIds);
  }

  @Patch(":pageId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({
    summary: "Editar una página",
    description:
      "Requiere `page.manage`. La página de inicio no se puede renombrar: se sirve en la raíz del sitio. Un cuerpo vacío es 400.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página a editar.")
  @ApiZodBody(updatePageSchema)
  @ApiZodResponse(200, pageResponse, "Página actualizada.")
  @ApiResponse({
    status: 400,
    description: "Cuerpo vacío, o intento de renombrar la página de inicio.",
  })
  @ApiResponse({ status: 404, description: PAGE_NOT_FOUND })
  @ApiResponse({ status: 409, description: SLUG_TAKEN })
  async update(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updatePageSchema)) body: UpdatePageDto,
  ) {
    return this.pagesService.updatePage(organizationId, user.id, siteId, pageId, body);
  }

  // DELETE, pero el borrado es lógico: la página y su historial siguen en la base (F2.3).
  @Delete(":pageId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_DELETE)
  @ApiOperation({
    summary: "Mandar una página a la papelera",
    description:
      "Requiere el permiso `page.delete`. El borrado es **lógico**: la página y su historial de versiones siguen en la base y se pueden restaurar. Devuelve la página con `deletedAt`, por eso 200 y no 204. La página de inicio no se elimina.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página a mandar a la papelera.")
  @ApiZodResponse(200, pageResponse, "Página en la papelera, con `deletedAt` puesto.")
  @ApiResponse({ status: 400, description: "La página de inicio no se puede eliminar." })
  @ApiResponse({ status: 404, description: PAGE_NOT_FOUND })
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @CurrentUser() user: User,
  ) {
    return this.pagesService.deletePage(organizationId, user.id, siteId, pageId);
  }

  @Post(":pageId/restore")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_DELETE)
  @ApiOperation({
    summary: "Restaurar una página de la papelera",
    description:
      "Requiere `page.delete`. Idempotente: restaurar una página que ya está viva la devuelve sin cambios.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página a restaurar; se busca incluyendo las de la papelera.")
  @ApiZodResponse(201, pageResponse, "Página restaurada, con `deletedAt` en `null`.")
  @ApiResponse({ status: 404, description: "Página no encontrada, ni siquiera en la papelera." })
  @ApiResponse({
    status: 409,
    description: "Otra página del sitio tomó ese slug mientras tanto. Renómbrala antes de restaurar esta.",
  })
  async restore(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @CurrentUser() user: User,
  ) {
    return this.pagesService.restorePage(organizationId, user.id, siteId, pageId);
  }
}
