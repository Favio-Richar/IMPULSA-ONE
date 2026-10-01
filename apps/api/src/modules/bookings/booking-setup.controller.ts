import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  bookableServiceResponse,
  bookingAvailabilityResponse,
  bookingBlackoutResponse,
  bookingBranchResponse,
  bookingSettingsResponse,
  bookingStaffResponse,
} from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  assignStaffToServiceSchema,
  bookableServiceSchema,
  bookingAvailabilityQuerySchema,
  bookingBlackoutSchema,
  bookingBranchSchema,
  bookingSettingsSchema,
  bookingStaffSchema,
  updateBookableServiceSchema,
  updateBookingBranchSchema,
  updateBookingStaffSchema,
  type AssignStaffToServiceInput,
  type BookableServiceInput,
  type BookingAvailabilityQuery,
  type BookingBlackoutInput,
  type BookingBranchInput,
  type BookingSettingsInput,
  type BookingStaffInput,
  type UpdateBookableServiceInput,
  type UpdateBookingBranchInput,
  type UpdateBookingStaffInput,
} from "@impulza/validation";
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
  BLACKOUT_NOT_FOUND,
  BRANCH_NOT_FOUND,
  BookingSetupService,
  SERVICE_NOT_FOUND,
  STAFF_NOT_FOUND,
} from "./booking-setup.service.js";

@ApiTags("bookings")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/booking")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class BookingSetupController {
  constructor(private readonly bookingSetupService: BookingSetupService) {}

  @Get("settings")
  @ApiOperation({ summary: "Leer la configuración de reservas del sitio", description: "Sin configuración guardada, devuelve los valores por defecto con `configured: false`." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodResponse(200, bookingSettingsResponse, "Configuración de reservas.")
  getSettings(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.bookingSetupService.getSettings(organizationId, siteId);
  }

  @Put("settings")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Guardar la configuración de reservas", description: "Requiere `site.update`. Horario semanal en la zona horaria IANA del sitio." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodBody(bookingSettingsSchema)
  @ApiZodResponse(200, bookingSettingsResponse, "Configuración guardada.")
  saveSettings(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(bookingSettingsSchema)) body: BookingSettingsInput,
  ) {
    return this.bookingSetupService.saveSettings(organizationId, user.id, siteId, body);
  }

  @Get("services")
  @ApiOperation({ summary: "Listar los servicios reservables del sitio" })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodArrayResponse(200, bookableServiceResponse, "Servicios, en su orden.")
  listServices(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.bookingSetupService.listServices(organizationId, siteId);
  }

  @Post("services")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({
    summary: "Crear un servicio reservable",
    description: "Requiere `site.update`. El enlace de pago es del propio negocio: Impulza no cobra (decisión #6).",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodBody(bookableServiceSchema)
  @ApiZodResponse(201, bookableServiceResponse, "Servicio creado.")
  @ApiResponse({ status: 422, description: "El sitio ya tiene el máximo de servicios." })
  createService(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(bookableServiceSchema)) body: BookableServiceInput,
  ) {
    return this.bookingSetupService.createService(organizationId, user.id, siteId, body);
  }

  @Patch("services/:serviceId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Editar un servicio reservable", description: "Requiere `site.update`. `null` borra un campo opcional." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("serviceId", "Servicio a editar.")
  @ApiZodBody(updateBookableServiceSchema)
  @ApiZodResponse(200, bookableServiceResponse, "Servicio actualizado.")
  @ApiResponse({ status: 404, description: SERVICE_NOT_FOUND })
  @ApiResponse({ status: 422, description: "El resultado no es un servicio válido (p. ej. precio sin moneda)." })
  updateService(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("serviceId") serviceId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateBookableServiceSchema)) body: UpdateBookableServiceInput,
  ) {
    return this.bookingSetupService.updateService(organizationId, user.id, siteId, serviceId, body);
  }

  @Delete("services/:serviceId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Borrar un servicio reservable", description: "Requiere `site.update`." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("serviceId", "Servicio a borrar.")
  @ApiResponse({ status: 204, description: "Servicio borrado." })
  @ApiResponse({ status: 404, description: SERVICE_NOT_FOUND })
  async deleteService(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("serviceId") serviceId: string,
    @CurrentUser() user: User,
  ) {
    await this.bookingSetupService.deleteService(organizationId, user.id, siteId, serviceId);
  }

  @Get("blackouts")
  @ApiOperation({ summary: "Listar los bloqueos de agenda", description: "Vigentes y futuros, más los de los últimos 30 días." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodArrayResponse(200, bookingBlackoutResponse, "Bloqueos, del más próximo al más lejano.")
  listBlackouts(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.bookingSetupService.listBlackouts(organizationId, siteId);
  }

  @Post("blackouts")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Bloquear un rango de la agenda", description: "Requiere `site.update`. Feriados, vacaciones: en ese rango no se ofrece ninguna hora." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodBody(bookingBlackoutSchema)
  @ApiZodResponse(201, bookingBlackoutResponse, "Bloqueo creado.")
  createBlackout(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(bookingBlackoutSchema)) body: BookingBlackoutInput,
  ) {
    return this.bookingSetupService.createBlackout(organizationId, user.id, siteId, body);
  }

  @Delete("blackouts/:blackoutId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Quitar un bloqueo de agenda", description: "Requiere `site.update`." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("blackoutId", "Bloqueo a quitar.")
  @ApiResponse({ status: 204, description: "Bloqueo quitado." })
  @ApiResponse({ status: 404, description: BLACKOUT_NOT_FOUND })
  async deleteBlackout(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("blackoutId") blackoutId: string,
    @CurrentUser() user: User,
  ) {
    await this.bookingSetupService.deleteBlackout(organizationId, user.id, siteId, blackoutId);
  }

  @Get("availability")
  @ApiOperation({
    summary: "Horarios libres de un servicio",
    description: "Calculados en el servidor, en la zona horaria del sitio (incluye cambios de horario), descontando bloqueos, anticipación mínima y margen.",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiQuery({ name: "serviceId", required: true, type: String })
  @ApiQuery({ name: "from", required: true, description: "Primer día local, YYYY-MM-DD." })
  @ApiQuery({ name: "days", required: false, type: Number, description: "1 a 31 (por defecto 7)." })
  @ApiZodResponse(200, bookingAvailabilityResponse, "Horas de inicio libres por día.")
  @ApiResponse({ status: 400, description: "Parámetros inválidos (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: SERVICE_NOT_FOUND })
  availability(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Query(new ZodValidationPipe(bookingAvailabilityQuerySchema)) query: BookingAvailabilityQuery,
  ) {
    return this.bookingSetupService.availability(organizationId, siteId, query);
  }

  // --- Sucursales (F7.9a) ---

  @Get("branches")
  @ApiOperation({ summary: "Listar sucursales de atención del sitio" })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodArrayResponse(200, bookingBranchResponse, "Sucursales del sitio.")
  listBranches(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.bookingSetupService.listBranches(organizationId, siteId);
  }

  @Post("branches")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Crear una sucursal de atención", description: "Requiere `site.update`. Hasta 20 por sitio." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodBody(bookingBranchSchema)
  @ApiZodResponse(201, bookingBranchResponse, "Sucursal creada.")
  createBranch(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(bookingBranchSchema)) body: BookingBranchInput,
  ) {
    return this.bookingSetupService.createBranch(organizationId, user.id, siteId, body);
  }

  @Patch("branches/:branchId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Editar una sucursal", description: "Requiere `site.update`." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("branchId", "Sucursal a editar.")
  @ApiZodBody(updateBookingBranchSchema)
  @ApiZodResponse(200, bookingBranchResponse, "Sucursal actualizada.")
  @ApiResponse({ status: 404, description: BRANCH_NOT_FOUND })
  updateBranch(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("branchId") branchId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateBookingBranchSchema)) body: UpdateBookingBranchInput,
  ) {
    return this.bookingSetupService.updateBranch(organizationId, user.id, siteId, branchId, body);
  }

  @Delete("branches/:branchId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Borrar una sucursal", description: "Requiere `site.update`." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("branchId", "Sucursal a borrar.")
  @ApiResponse({ status: 204, description: "Sucursal borrada." })
  @ApiResponse({ status: 404, description: BRANCH_NOT_FOUND })
  async deleteBranch(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("branchId") branchId: string,
    @CurrentUser() user: User,
  ) {
    await this.bookingSetupService.deleteBranch(organizationId, user.id, siteId, branchId);
  }

  // --- Profesionales (F7.9a) ---

  @Get("staff")
  @ApiOperation({ summary: "Listar profesionales de atención del sitio" })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodArrayResponse(200, bookingStaffResponse, "Profesionales del sitio.")
  listStaff(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.bookingSetupService.listStaff(organizationId, siteId);
  }

  @Post("staff")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Crear un profesional de atención", description: "Requiere `site.update`. Hasta 50 por sitio." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodBody(bookingStaffSchema)
  @ApiZodResponse(201, bookingStaffResponse, "Profesional creado.")
  createStaff(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(bookingStaffSchema)) body: BookingStaffInput,
  ) {
    return this.bookingSetupService.createStaff(organizationId, user.id, siteId, body);
  }

  @Patch("staff/:staffId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Editar un profesional", description: "Requiere `site.update`." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("staffId", "Profesional a editar.")
  @ApiZodBody(updateBookingStaffSchema)
  @ApiZodResponse(200, bookingStaffResponse, "Profesional actualizado.")
  @ApiResponse({ status: 404, description: STAFF_NOT_FOUND })
  updateStaff(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("staffId") staffId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateBookingStaffSchema)) body: UpdateBookingStaffInput,
  ) {
    return this.bookingSetupService.updateStaff(organizationId, user.id, siteId, staffId, body);
  }

  @Delete("staff/:staffId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Borrar un profesional", description: "Requiere `site.update`." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("staffId", "Profesional a borrar.")
  @ApiResponse({ status: 204, description: "Profesional borrado." })
  @ApiResponse({ status: 404, description: STAFF_NOT_FOUND })
  async deleteStaff(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("staffId") staffId: string,
    @CurrentUser() user: User,
  ) {
    await this.bookingSetupService.deleteStaff(organizationId, user.id, siteId, staffId);
  }

  @Put("services/:serviceId/staff")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Asignar profesionales a un servicio", description: "Requiere `site.update`." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("serviceId", "Servicio a asignar.")
  @ApiZodBody(assignStaffToServiceSchema)
  @ApiResponse({ status: 204, description: "Profesionales asignados." })
  @ApiResponse({ status: 404, description: SERVICE_NOT_FOUND })
  @HttpCode(HttpStatus.NO_CONTENT)
  async assignStaff(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("serviceId") serviceId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(assignStaffToServiceSchema)) body: AssignStaffToServiceInput,
  ) {
    await this.bookingSetupService.assignStaffToService(organizationId, user.id, siteId, serviceId, body.staffIds);
  }
}
