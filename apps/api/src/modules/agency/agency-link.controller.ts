import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Res, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { acceptOwnerInvitationResponse, agencyBillingResponse, agencyLinkResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { acceptOwnerInvitationSchema, changeBillingSchema, type AcceptOwnerInvitationDto, type ChangeBillingDto } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiRateLimited,
  ApiSessionScopedErrors,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { AgencyBillingService } from "./agency-billing.service.js";
import { AgencyService } from "./agency.service.js";

/**
 * Lado del negocio (F9.3, ADR-028 §2): el propietario decide qué agencia entra y puede revocarla en cualquier
 * momento. Aceptar, rechazar y revocar piden `agency.link.manage`, que solo tiene el OWNER: ni la propia agencia
 * (rol delegado) ni los demás roles pueden decidir por el negocio.
 */
@ApiTags("agency")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/agency-link")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class AgencyLinkController {
  constructor(
    private readonly agencyService: AgencyService,
    private readonly billingService: AgencyBillingService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "La agencia vinculada a este negocio",
    description: "La relación abierta (solicitud pendiente, activa, en pausa o archivada) con las personas de la agencia que tienen acceso hoy, o `null`.",
  })
  @ApiZodResponse(200, agencyLinkResponse, "Relación con la agencia, o null.")
  async get(@Param("organizationId") organizationId: string, @Res() res: Response) {
    // Nest responde con cuerpo vacío cuando un controlador devuelve `null`, y el panel no puede leer un cuerpo vacío
    // como JSON: el contrato dice `null`, así que se serializa de forma explícita.
    res.status(HttpStatus.OK).json(await this.agencyService.getLink(organizationId));
  }

  @Post("accept")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_LINK_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "agency-link-accept" })
  @ApiOperation({ summary: "Aceptar la solicitud de una agencia", description: "Desde aquí la agencia entra con acceso delegado (con los límites del ADR-028 §2). Solo el propietario." })
  @ApiZodResponse(200, agencyLinkResponse, "Relación activa.")
  @ApiRateLimited(20, 60)
  @ApiResponse({ status: 409, description: "No hay una solicitud pendiente." })
  @ApiResponse({ status: 410, description: "La solicitud venció." })
  async accept(@Param("organizationId") organizationId: string, @CurrentUser() user: User) {
    return this.agencyService.acceptLink(organizationId, user.id);
  }

  @Post("reject")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_LINK_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "agency-link-reject" })
  @ApiOperation({ summary: "Rechazar la solicitud de una agencia", description: "Termina la solicitud sin dar ningún acceso. Solo el propietario." })
  @ApiResponse({ status: 204, description: "Solicitud rechazada." })
  @ApiRateLimited(20, 60)
  @ApiResponse({ status: 409, description: "No hay una solicitud pendiente." })
  async reject(@Param("organizationId") organizationId: string, @CurrentUser() user: User): Promise<void> {
    await this.agencyService.rejectLink(organizationId, user.id);
  }

  @Get("billing")
  @ApiOperation({ summary: "Quién paga el plan de este negocio: modo vigente, propuesta pendiente e historial", description: "Lo ve cualquier miembro del negocio. Nada de la suscripción ni de los medios de pago viaja acá." })
  @ApiZodResponse(200, agencyBillingResponse, "Modo, propuesta pendiente (si hay) e historial.")
  @ApiResponse({ status: 404, description: "Este negocio no tiene una agencia vinculada." })
  async billing(@Param("organizationId") organizationId: string) {
    return this.billingService.getForClient(organizationId);
  }

  @Post("billing/confirm")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_LINK_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "agency-billing-confirm" })
  @ApiOperation({ summary: "Confirmar la propuesta de facturación de la agencia", description: "Desde aquí rige el nuevo modo. Solo el propietario." })
  @ApiZodResponse(200, agencyBillingResponse, "Estado de la facturación tras confirmar.")
  @ApiRateLimited(20, 60)
  @ApiResponse({ status: 409, description: "No hay una propuesta pendiente." })
  async confirmBilling(@Param("organizationId") organizationId: string, @CurrentUser() user: User) {
    return this.billingService.confirm(organizationId, user.id);
  }

  @Post("billing/reject")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_LINK_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "agency-billing-reject" })
  @ApiOperation({ summary: "Rechazar la propuesta de facturación de la agencia", description: "Nada cambia. Solo el propietario." })
  @ApiZodResponse(200, agencyBillingResponse, "Estado de la facturación tras rechazar.")
  @ApiRateLimited(20, 60)
  @ApiResponse({ status: 409, description: "No hay una propuesta pendiente." })
  async rejectBilling(@Param("organizationId") organizationId: string, @CurrentUser() user: User) {
    return this.billingService.reject(organizationId, user.id);
  }

  @Post("billing")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_LINK_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "agency-billing-owner" })
  @ApiOperation({
    summary: "Volver a pagar el plan por tu cuenta",
    description: "El propietario solo puede pedir `CLIENT_PAYS` (pagar él) y se aplica al instante; que la agencia pague lo ofrece la agencia. Cierra cualquier propuesta pendiente. Solo el propietario.",
  })
  @ApiZodBody(changeBillingSchema)
  @ApiZodResponse(200, agencyBillingResponse, "Estado de la facturación tras el cambio.")
  @ApiRateLimited(20, 60)
  @ApiResponse({ status: 403, description: "El propietario no puede pedir que la agencia pague." })
  @ApiResponse({ status: 409, description: "Ya está en ese modo." })
  async ownerBilling(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(changeBillingSchema)) body: ChangeBillingDto,
  ) {
    return this.billingService.ownerChange(organizationId, user.id, body.billingMode);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_LINK_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "agency-link-revoke" })
  @ApiOperation({
    summary: "Revocar a la agencia",
    description: "Inmediato: la agencia pierde el acceso en la siguiente petición. Los datos del negocio no se tocan. Solo el propietario.",
  })
  @ApiResponse({ status: 204, description: "Acceso revocado." })
  @ApiRateLimited(20, 60)
  @ApiResponse({ status: 404, description: "Este negocio no tiene una agencia vinculada." })
  async revoke(@Param("organizationId") organizationId: string, @CurrentUser() user: User): Promise<void> {
    await this.agencyService.revokeLink(organizationId, user.id);
  }
}

/** Aceptar la invitación a ser propietario de un negocio que creó una agencia. No es de una organización: es de la persona. */
@ApiTags("agency")
@ApiCookieAuth(SESSION_AUTH)
@ApiSessionScopedErrors()
@Controller("agency-invitations")
@UseGuards(CsrfGuard, SessionAuthGuard)
export class AgencyInvitationsController {
  constructor(private readonly agencyService: AgencyService) {}

  @Post("accept")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "agency-invitation-accept" })
  @ApiOperation({
    summary: "Aceptar la invitación a ser propietario",
    description:
      "El token es de un solo uso, vence a los 7 días y solo sirve para la cuenta cuyo correo es el invitado. Convierte a la persona en OWNER del negocio.",
  })
  @ApiZodBody(acceptOwnerInvitationSchema)
  @ApiZodResponse(200, acceptOwnerInvitationResponse, "Invitación aceptada.")
  @ApiRateLimited(10, 60)
  @ApiResponse({ status: 404, description: "La invitación no existe o no es para esta cuenta." })
  @ApiResponse({ status: 410, description: "La invitación venció." })
  async accept(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(acceptOwnerInvitationSchema)) body: AcceptOwnerInvitationDto,
  ) {
    return this.agencyService.acceptOwnerInvitation(user, body.token);
  }
}
