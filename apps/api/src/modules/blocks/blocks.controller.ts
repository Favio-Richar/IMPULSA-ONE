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
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { blockResponse } from "@impulza/contracts";
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
import { BlocksService } from "./blocks.service.js";
import {
  createBlockSchema,
  reorderBlocksSchema,
  setPrimaryBlockSchema,
  updateBlockSchema,
  type CreateBlockDto,
  type ReorderBlocksDto,
  type SetPrimaryBlockDto,
  type UpdateBlockDto,
} from "./dto/block.dto.js";

const BLOCK_NOT_FOUND =
  "Bloque no encontrado: no existe en esa página, o la página es de otra organización (ADR-002).";
const PAGE_NOT_FOUND = "Página no encontrada, o de otra organización (ADR-002).";
const INVALID_CONFIG =
  "La configuración no cumple el esquema de ese tipo de bloque. `issues` indica el campo exacto.";

// Los bloques son contenido de una página: usan el mismo permiso que gestionar páginas
// (page.manage), porque es exactamente el mismo trabajo editorial.
@ApiTags("blocks")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/pages/:pageId/blocks")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  @Get()
  @ApiOperation({
    summary: "Listar los bloques de la página",
    description:
      "En orden de `position`, con la configuración de su versión vigente. Un bloque que no se puede renderizar viene con `degraded` en vez de romper la respuesta: el render lo omite y el constructor puede avisar. Solo pide membresía activa.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página dueña de los bloques.")
  @ApiZodArrayResponse(200, blockResponse, "Bloques de la página, ordenados.")
  @ApiResponse({ status: 404, description: PAGE_NOT_FOUND })
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
  @ApiOperation({
    summary: "Agregar un bloque a la página",
    description:
      "Requiere `page.manage`. `type` sale del catálogo cerrado y `config` se valida contra el esquema **de ese tipo** y se sanitiza en el servidor — es el único camino por el que una configuración llega a la base, que es lo que convierte «bloques tipados, no HTML arbitrario» en una garantía y no en una intención.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página donde se agrega el bloque.")
  @ApiZodBody(createBlockSchema)
  @ApiZodResponse(201, blockResponse, "Bloque creado, al final de la página.")
  @ApiResponse({
    status: 400,
    description:
      "Tipo de bloque fuera del catálogo, o `scheduledStart` posterior o igual a `scheduledEnd`.",
  })
  @ApiResponse({ status: 404, description: PAGE_NOT_FOUND })
  @ApiResponse({ status: 422, description: INVALID_CONFIG })
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
  @ApiOperation({
    summary: "Reordenar los bloques de la página",
    description:
      "Requiere `page.manage`. Mismo criterio que las páginas: se manda el orden completo, con exactamente todos los bloques de la página y sin repetidos.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página cuyos bloques se reordenan.")
  @ApiZodBody(reorderBlocksSchema)
  @ApiZodArrayResponse(200, blockResponse, "Bloques en el nuevo orden.")
  @ApiResponse({
    status: 400,
    description:
      "La lista tiene identificadores repetidos, o no incluye exactamente todos los bloques de la página.",
  })
  @ApiResponse({ status: 404, description: PAGE_NOT_FOUND })
  async reorder(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(reorderBlocksSchema)) body: ReorderBlocksDto,
  ) {
    return this.blocksService.reorderBlocks(organizationId, user.id, siteId, pageId, body.blockIds);
  }

  // Antes que `:blockId`, por la misma razón que "reorder".
  @Put("primary")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({
    summary: "Elegir la acción principal de la página",
    description:
      "Requiere `page.manage`. PP5: el bloque elegido (WhatsApp, enlace o formulario) se destaca y, en el teléfono, queda fijo abajo. A lo sumo uno por página: marcar otro desmarca el anterior, y `blockId: null` la quita. Es un cambio del borrador: se ve al publicar.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página cuya acción principal se elige.")
  @ApiZodBody(setPrimaryBlockSchema)
  @ApiZodArrayResponse(200, blockResponse, "Bloques de la página, con la acción principal ya marcada.")
  @ApiResponse({ status: 404, description: "La página o el bloque no existen en esta organización." })
  @ApiResponse({ status: 409, description: "Otra petición cambió la acción principal al mismo tiempo." })
  @ApiResponse({ status: 422, description: "El bloque no es de un tipo de acción (WhatsApp, enlace o formulario)." })
  async setPrimary(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(setPrimaryBlockSchema)) body: SetPrimaryBlockDto,
  ) {
    return this.blocksService.setPrimaryBlock(organizationId, user.id, siteId, pageId, body.blockId);
  }

  @Patch(":blockId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({
    summary: "Editar un bloque",
    description:
      "Requiere `page.manage`. Enviar `config` la reemplaza entera y crea una versión nueva: se vuelve a validar y sanitizar desde cero, no se parchea lo guardado. Un cuerpo vacío es 400.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página dueña del bloque.")
  @ApiUuidParam("blockId", "Bloque a editar.")
  @ApiZodBody(updateBlockSchema)
  @ApiZodResponse(200, blockResponse, "Bloque actualizado, con su versión vigente.")
  @ApiResponse({
    status: 400,
    description: "Cuerpo vacío, o `scheduledStart` posterior o igual a `scheduledEnd`.",
  })
  @ApiResponse({ status: 404, description: BLOCK_NOT_FOUND })
  @ApiResponse({ status: 422, description: INVALID_CONFIG })
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
  @ApiOperation({
    summary: "Duplicar un bloque",
    description:
      "Requiere `page.manage`. La copia queda justo debajo del original y los siguientes se corren una posición.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página dueña del bloque.")
  @ApiUuidParam("blockId", "Bloque a copiar.")
  @ApiZodResponse(201, blockResponse, "Copia creada, en la posición siguiente al original.")
  @ApiResponse({ status: 404, description: BLOCK_NOT_FOUND })
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
  @ApiOperation({
    summary: "Eliminar un bloque",
    description:
      "Requiere `page.manage`. A diferencia de una página, el borrado es real: un bloque suelto no es una unidad de contenido que el usuario espere recuperar, y su historial de versiones se va con él. Las posiciones siguientes se cierran para que el orden siga siendo 0..n-1.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página dueña del bloque.")
  @ApiUuidParam("blockId", "Bloque a eliminar.")
  @ApiResponse({ status: 204, description: "Bloque eliminado." })
  @ApiResponse({ status: 404, description: BLOCK_NOT_FOUND })
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
