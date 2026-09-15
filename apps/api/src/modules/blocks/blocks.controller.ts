import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { PERMISSIONS, type User } from "@impulza/database";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { BlocksService } from "./blocks.service.js";
import {
  createBlockSchema,
  reorderBlocksSchema,
  updateBlockSchema,
  type CreateBlockDto,
  type ReorderBlocksDto,
  type UpdateBlockDto,
} from "./dto/block.dto.js";

// Los bloques son contenido de una página: usan el mismo permiso que gestionar páginas
// (page.manage), porque es exactamente el mismo trabajo editorial.
@Controller("organizations/:organizationId/sites/:siteId/pages/:pageId/blocks")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  @Get()
  async list(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
  ) {
    return this.blocksService.listBlocks(organizationId, siteId, pageId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  async create(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createBlockSchema)) body: CreateBlockDto,
  ) {
    return this.blocksService.createBlock(organizationId, user.id, siteId, pageId, body);
  }

  // Antes que `:blockId` para que "reorder" no se lea como un identificador.
  @Put("reorder")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  async reorder(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(reorderBlocksSchema)) body: ReorderBlocksDto,
  ) {
    return this.blocksService.reorderBlocks(organizationId, user.id, siteId, pageId, body.blockIds);
  }

  @Patch(":blockId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  async update(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @Param("blockId") blockId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateBlockSchema)) body: UpdateBlockDto,
  ) {
    return this.blocksService.updateBlock(organizationId, user.id, siteId, pageId, blockId, body);
  }

  @Post(":blockId/duplicate")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  async duplicate(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @Param("blockId") blockId: string,
    @CurrentUser() user: User,
  ) {
    return this.blocksService.duplicateBlock(organizationId, user.id, siteId, pageId, blockId);
  }

  @Delete(":blockId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @Param("blockId") blockId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.blocksService.deleteBlock(organizationId, user.id, siteId, pageId, blockId);
  }
}
