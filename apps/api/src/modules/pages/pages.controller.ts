import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { PERMISSIONS, type User } from "@impulza/database";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
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

@Controller("organizations/:organizationId/sites/:siteId/pages")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class PagesController {
  constructor(private readonly pagesService: PagesService) {}

  // Leer no exige permiso: basta con ser miembro activo (mismo criterio que los sitios, F2.2).
  @Get()
  async list(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.pagesService.listPages(organizationId, siteId);
  }

  @Get(":pageId")
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
  async restore(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @CurrentUser() user: User,
  ) {
    return this.pagesService.restorePage(organizationId, user.id, siteId, pageId);
  }
}
