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
import { PERMISSIONS, type User } from "@impulza/database";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
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

// Los temas cuelgan de la organización aunque el catálogo sea global: el listado siempre se
// responde desde el tenant del usuario (catálogo + propios), así que la ruta lo refleja y
// OrganizationMembershipGuard resuelve el tenant antes de que el servicio vea nada (ADR-002).
@Controller("organizations/:organizationId/themes")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class ThemesController {
  constructor(private readonly themesService: ThemesService) {}

  // Leer no exige permiso: basta con ser miembro activo (mismo criterio que sitios y páginas).
  @Get()
  async list(@Param("organizationId") organizationId: string) {
    return this.themesService.listThemes(organizationId);
  }

  @Get(":themeId")
  async getOne(
    @Param("organizationId") organizationId: string,
    @Param("themeId") themeId: string,
  ) {
    return this.themesService.getTheme(organizationId, themeId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.THEME_MANAGE)
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
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("themeId") themeId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.themesService.deleteTheme(organizationId, user.id, themeId);
  }
}
