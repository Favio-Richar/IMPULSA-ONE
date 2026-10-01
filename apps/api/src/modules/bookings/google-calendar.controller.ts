import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  googleCalendarConnectionResponse,
  googleCalendarStatusResponse,
} from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  connectGoogleCalendarSchema,
  disconnectGoogleCalendarSchema,
  googleCalendarAuthUrlQuerySchema,
  type ConnectGoogleCalendarInput,
  type DisconnectGoogleCalendarInput,
  type GoogleCalendarAuthUrlQuery,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiUuidParam,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import {
  GOOGLE_CALENDAR_CONNECTION_NOT_FOUND,
  GOOGLE_CALENDAR_NOT_CONFIGURED,
  GoogleCalendarService,
} from "./google-calendar.service.js";

@ApiTags("bookings")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/booking/google-calendar")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class GoogleCalendarController {
  constructor(private readonly googleCalendarService: GoogleCalendarService) {}

  @Get()
  @ApiOperation({
    summary: "Consultar estado de integración con Google Calendar",
    description: "Devuelve si el servidor tiene credenciales configuradas y las conexiones activas por sitio o profesional.",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodResponse(200, googleCalendarStatusResponse, "Estado de conexión.")
  getStatus(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.googleCalendarService.getStatus(organizationId, siteId);
  }

  @Get("auth-url")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({
    summary: "Obtener URL de autorización OAuth de Google",
    description: "Requiere `site.update`. Si faltan credenciales en el servidor, devuelve 422.",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiQuery({ name: "redirectUri", required: true, description: "URL a la que Google debe redirigir tras autorizar." })
  @ApiQuery({ name: "staffId", required: false, description: "Opcional: ID de profesional a vincular." })
  @ApiResponse({ status: 200, description: "URL de autorización." })
  @ApiResponse({ status: 422, description: GOOGLE_CALENDAR_NOT_CONFIGURED })
  getAuthUrl(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Query(new ZodValidationPipe(googleCalendarAuthUrlQuerySchema)) query: GoogleCalendarAuthUrlQuery,
  ) {
    return this.googleCalendarService.getAuthUrl(organizationId, siteId, query);
  }

  @Post("connect")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({
    summary: "Conectar cuenta de Google Calendar",
    description: "Intercambia el código de autorización y guarda los tokens cifrados con AES-256-GCM.",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodBody(connectGoogleCalendarSchema)
  @ApiZodResponse(200, googleCalendarConnectionResponse, "Conexión establecida.")
  @ApiResponse({ status: 422, description: "Código inválido o Google Calendar no configurado." })
  connect(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(connectGoogleCalendarSchema)) body: ConnectGoogleCalendarInput,
  ) {
    return this.googleCalendarService.connect(organizationId, user.id, siteId, body);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({
    summary: "Desconectar Google Calendar",
    description: "Elimina los tokens y la conexión del sitio o del profesional.",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiQuery({ name: "staffId", required: false, description: "Opcional: ID de profesional a desconectar." })
  @ApiResponse({ status: 204, description: "Desconectado con éxito." })
  @ApiResponse({ status: 404, description: GOOGLE_CALENDAR_CONNECTION_NOT_FOUND })
  disconnect(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(disconnectGoogleCalendarSchema)) query: DisconnectGoogleCalendarInput,
  ) {
    return this.googleCalendarService.disconnect(organizationId, user.id, siteId, query.staffId);
  }
}
