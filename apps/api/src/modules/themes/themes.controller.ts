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
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { themeResponse } from "@impulza/contracts";
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
  createThemeSchema,
  duplicateThemeSchema,
  updateThemeSchema,
  type CreateThemeDto,
  type DuplicateThemeDto,
  type UpdateThemeDto,
} from "./dto/theme.dto.js";
import { ThemesService } from "./themes.service.js";

const THEME_NOT_FOUND = "Tema no encontrado, o pertenece a otra organización (ADR-002).";

// Los temas cuelgan de la organización aunque el catálogo sea global: el listado siempre se
// responde desde el tenant del usuario (catálogo + propios), así que la ruta lo refleja y
// OrganizationMembershipGuard resuelve el tenant antes de que el servicio vea nada (ADR-002).
@ApiTags("themes")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/themes")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class ThemesController {
  constructor(private readonly themesService: ThemesService) {}

  // Leer no exige permiso: basta con ser miembro activo (mismo criterio que sitios y páginas).
  @Get()
  @ApiOperation({
    summary: "Listar temas disponibles",
    description:
      "Devuelve el catálogo global más los temas propios de la organización, en ese orden. Solo pide membresía activa.",
  })
  @ApiZodArrayResponse(200, themeResponse, "Catálogo global seguido de los temas propios.")
  async list(@Param("organizationId") organizationId: string) {
    return this.themesService.listThemes(organizationId);
  }

  @Get(":themeId")
  @ApiOperation({ summary: "Leer un tema" })
  @ApiUuidParam("themeId", "Tema del catálogo global o propio de la organización.")
  @ApiZodResponse(200, themeResponse, "El tema solicitado.")
  @ApiResponse({ status: 404, description: THEME_NOT_FOUND })
  async getOne(
    @Param("organizationId") organizationId: string,
    @Param("themeId") themeId: string,
  ) {
    return this.themesService.getTheme(organizationId, themeId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.THEME_MANAGE)
  @ApiOperation({
    summary: "Crear un tema propio",
    description:
      "Requiere el permiso `theme.manage` (OWNER/ADMIN). Los tokens se validan en el servidor, incluida la comprobación de contraste WCAG 2.2 AA.",
  })
  @ApiZodBody(createThemeSchema)
  @ApiZodResponse(201, themeResponse, "Tema creado.")
  @ApiResponse({
    status: 422,
    description:
      "Los tokens no cumplen el esquema o el contraste exigido. `issues` indica el campo (`palette.mutedForeground`, …).",
  })
  async create(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createThemeSchema)) body: CreateThemeDto,
  ) {
    return this.themesService.createTheme(organizationId, user.id, body);
  }

  @Post(":themeId/duplicate")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.THEME_MANAGE)
  @ApiOperation({
    summary: "Duplicar un tema",
    description:
      "Único camino para personalizar un tema del catálogo, que es de solo lectura. La copia queda como tema propio y editable.",
  })
  @ApiUuidParam("themeId", "Tema a copiar: del catálogo o propio.")
  @ApiZodBody(duplicateThemeSchema)
  @ApiZodResponse(201, themeResponse, "Copia creada, editable.")
  @ApiResponse({ status: 404, description: THEME_NOT_FOUND })
  async duplicate(
    @Param("organizationId") organizationId: string,
    @Param("themeId") themeId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(duplicateThemeSchema)) body: DuplicateThemeDto,
  ) {
    return this.themesService.duplicateTheme(organizationId, user.id, themeId, body.name);
  }

  @Patch(":themeId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.THEME_MANAGE)
  @ApiOperation({
    summary: "Editar un tema propio",
    description: "Los tokens se envían completos, nunca a medias: un parche parcial no se puede verificar contra AA.",
  })
  @ApiUuidParam("themeId", "Tema propio de la organización.")
  @ApiZodBody(updateThemeSchema)
  @ApiZodResponse(200, themeResponse, "Tema actualizado.")
  @ApiResponse({
    status: 403,
    description: "El tema es del catálogo global: no se edita, se duplica.",
  })
  @ApiResponse({ status: 404, description: THEME_NOT_FOUND })
  @ApiResponse({ status: 422, description: "Los tokens no cumplen el esquema o el contraste exigido." })
  async update(
    @Param("organizationId") organizationId: string,
    @Param("themeId") themeId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateThemeSchema)) body: UpdateThemeDto,
  ) {
    return this.themesService.updateTheme(organizationId, user.id, themeId, body);
  }

  // Sí es DELETE de verdad, a diferencia de páginas: un tema sin usar no es contenido del usuario,
  // y el servicio bloquea el borrado mientras algún sitio lo tenga aplicado.
  @Delete(":themeId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.THEME_MANAGE)
  @ApiOperation({
    summary: "Eliminar un tema propio",
    description:
      "Solo si ningún sitio lo tiene aplicado: borrarlo cambiaría la apariencia de esos sitios en silencio.",
  })
  @ApiUuidParam("themeId", "Tema propio de la organización.")
  @ApiResponse({ status: 204, description: "Tema eliminado." })
  @ApiResponse({ status: 403, description: "El tema es del catálogo global: no se elimina." })
  @ApiResponse({ status: 404, description: THEME_NOT_FOUND })
  @ApiResponse({
    status: 409,
    description: "Algún sitio tiene el tema aplicado. Cámbialos de tema antes de eliminarlo.",
  })
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("themeId") themeId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.themesService.deleteTheme(organizationId, user.id, themeId);
  }
}
