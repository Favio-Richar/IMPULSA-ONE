import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { shortLinkResponse } from "@impulza/contracts";
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
  createShortLinkSchema,
  updateShortLinkSchema,
  type CreateShortLinkDto,
  type UpdateShortLinkDto,
} from "./dto/short-link.dto.js";
import { ShortLinksService } from "./short-links.service.js";

const NOT_FOUND = "Enlace corto no encontrado: no existe, o pertenece a otra organización (ADR-002).";

@ApiTags("short-links")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/short-links")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class ShortLinksController {
  constructor(private readonly shortLinksService: ShortLinksService) {}

  @Get()
  @ApiOperation({ summary: "Listar los enlaces cortos de la organización" })
  @ApiZodArrayResponse(200, shortLinkResponse, "Enlaces cortos, del más reciente al más antiguo.")
  async list(@Param("organizationId") organizationId: string) {
    return this.shortLinksService.list(organizationId);
  }

  @Get(":shortLinkId")
  @ApiOperation({ summary: "Leer un enlace corto" })
  @ApiUuidParam("shortLinkId", "Enlace corto a leer.")
  @ApiZodResponse(200, shortLinkResponse, "El enlace corto solicitado.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async getOne(@Param("organizationId") organizationId: string, @Param("shortLinkId") shortLinkId: string) {
    return this.shortLinksService.get(organizationId, shortLinkId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SHORTLINK_MANAGE)
  @ApiOperation({
    summary: "Crear un enlace corto",
    description:
      "Requiere `shortlink.manage`. El slug vive en su propio espacio de rutas públicas (`/s/:slug`), con las mismas reglas de formato y reservados que el slug de un sitio (F2.2).",
  })
  @ApiZodBody(createShortLinkSchema)
  @ApiZodResponse(201, shortLinkResponse, "Enlace corto creado.")
  @ApiResponse({ status: 409, description: "Ese slug ya está tomado." })
  async create(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createShortLinkSchema)) body: CreateShortLinkDto,
  ) {
    return this.shortLinksService.create(organizationId, user.id, body);
  }

  @Patch(":shortLinkId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SHORTLINK_MANAGE)
  @ApiOperation({ summary: "Editar un enlace corto", description: "Requiere `shortlink.manage`. El slug no se puede cambiar (sería un enlace distinto); solo el destino y los UTM." })
  @ApiUuidParam("shortLinkId", "Enlace corto a editar.")
  @ApiZodBody(updateShortLinkSchema)
  @ApiZodResponse(200, shortLinkResponse, "Enlace corto actualizado.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async update(
    @Param("organizationId") organizationId: string,
    @Param("shortLinkId") shortLinkId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateShortLinkSchema)) body: UpdateShortLinkDto,
  ) {
    return this.shortLinksService.update(organizationId, user.id, shortLinkId, body);
  }

  @Delete(":shortLinkId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SHORTLINK_MANAGE)
  @ApiOperation({
    summary: "Borrar un enlace corto",
    description: "Requiere `shortlink.manage`. Bloqueado si tiene un QR propio que depende solo de él (F3.1).",
  })
  @ApiUuidParam("shortLinkId", "Enlace corto a borrar.")
  @ApiResponse({ status: 204, description: "Enlace corto borrado." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 409, description: "Tiene un QR propio — bórralo o reasígnalo primero." })
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("shortLinkId") shortLinkId: string,
    @CurrentUser() user: User,
  ) {
    await this.shortLinksService.delete(organizationId, user.id, shortLinkId);
  }
}
