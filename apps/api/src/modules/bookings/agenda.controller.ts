import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { bookingResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  BOOKING_STATUSES,
  listBookingsQuerySchema,
  manualBookingSchema,
  refundRequestSchema,
  updateBookingStatusSchema,
  type ListBookingsQuery,
  type ManualBookingInput,
  type RefundRequest,
  type UpdateBookingStatusInput,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiRateLimited, ApiUuidParam, ApiZodArrayResponse, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { REFUND_IN_PROGRESS, REFUND_UNAVAILABLE } from "../payment-accounts/checkout-refunds.service.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { AgendaService, BOOKING_NOT_FOUND, BOOKING_OVERLAP, DEPOSIT_REFUND_TOO_HIGH, NO_DEPOSIT_TO_REFUND } from "./agenda.service.js";

@ApiTags("bookings")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/bookings")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class AgendaController {
  constructor(private readonly agendaService: AgendaService) {}

  @Get()
  @ApiOperation({ summary: "Agenda: reservas en un rango", description: "Cualquier miembro activo la ve. Hasta 62 días por consulta; opcionalmente de un sitio y un estado." })
  @ApiQuery({ name: "from", required: true, description: "Inicio del rango (ISO 8601)." })
  @ApiQuery({ name: "to", required: true, description: "Fin del rango (ISO 8601)." })
  @ApiQuery({ name: "siteId", required: false, type: String })
  @ApiQuery({ name: "status", required: false, enum: BOOKING_STATUSES })
  @ApiZodArrayResponse(200, bookingResponse, "Reservas que se cruzan con el rango, por hora de inicio.")
  @ApiResponse({ status: 400, description: "Parámetros inválidos (detalle en `issues`)." })
  list(@Param("organizationId") organizationId: string, @Query(new ZodValidationPipe(listBookingsQuerySchema)) query: ListBookingsQuery) {
    return this.agendaService.list(organizationId, query);
  }

  @Get(":bookingId")
  @ApiOperation({ summary: "Leer una reserva" })
  @ApiUuidParam("bookingId", "Reserva a leer.")
  @ApiZodResponse(200, bookingResponse, "La reserva.")
  @ApiResponse({ status: 404, description: BOOKING_NOT_FOUND })
  get(@Param("organizationId") organizationId: string, @Param("bookingId") bookingId: string) {
    return this.agendaService.get(organizationId, bookingId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.BOOKING_MANAGE)
  @ApiOperation({
    summary: "Anotar una reserva",
    description: "Requiere `booking.manage`. Para reservas tomadas por teléfono o en el local: puede quedar fuera del horario publicado, pero nunca encima de otra confirmada.",
  })
  @ApiZodBody(manualBookingSchema)
  @ApiZodResponse(201, bookingResponse, "Reserva anotada.")
  @ApiResponse({ status: 404, description: "Servicio o sitio de otra organización, o inexistente." })
  @ApiResponse({ status: 409, description: BOOKING_OVERLAP })
  create(@Param("organizationId") organizationId: string, @CurrentUser() user: User, @Body(new ZodValidationPipe(manualBookingSchema)) body: ManualBookingInput) {
    return this.agendaService.createManual(organizationId, user.id, body);
  }

  @Patch(":bookingId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.BOOKING_MANAGE)
  @ApiOperation({ summary: "Cambiar el estado de una reserva", description: "Requiere `booking.manage`. Atendida, no llegó, cancelada o de vuelta a confirmada (si su hora sigue libre)." })
  @ApiUuidParam("bookingId", "Reserva a cambiar.")
  @ApiZodBody(updateBookingStatusSchema)
  @ApiZodResponse(200, bookingResponse, "Reserva actualizada.")
  @ApiResponse({ status: 404, description: BOOKING_NOT_FOUND })
  @ApiResponse({ status: 409, description: BOOKING_OVERLAP })
  updateStatus(
    @Param("organizationId") organizationId: string,
    @Param("bookingId") bookingId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateBookingStatusSchema)) body: UpdateBookingStatusInput,
  ) {
    return this.agendaService.updateStatus(organizationId, user.id, bookingId, body);
  }

  @Post(":bookingId/refund-deposit")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.PAYMENTS_REFUND)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "booking-refund" })
  @ApiOperation({
    summary: "Devolver la seña de una reserva",
    description:
      "Requiere `payments.refund` (solo el dueño). Total (sin `amount`) o parcial, con el token de la cuenta de Mercado Pago del negocio y clave de idempotencia; lo devuelto se lee de Mercado Pago. Avisa al cliente y queda auditado (F5.11a).",
  })
  @ApiUuidParam("bookingId", "Reserva cuya seña se devuelve.")
  @ApiZodBody(refundRequestSchema)
  @ApiZodResponse(200, bookingResponse, "Reserva con lo devuelto.")
  @ApiResponse({ status: 404, description: BOOKING_NOT_FOUND })
  @ApiResponse({ status: 409, description: REFUND_IN_PROGRESS })
  @ApiResponse({ status: 422, description: `${NO_DEPOSIT_TO_REFUND} O: ${DEPOSIT_REFUND_TOO_HIGH} O: \`PAYMENTS_UNAVAILABLE\` (${REFUND_UNAVAILABLE}) O: \`REFUND_REJECTED\`.` })
  @ApiResponse({ status: 503, description: "Mercado Pago no respondió; reintentar no devuelve dos veces." })
  @ApiRateLimited(10, 600)
  refundDeposit(
    @Param("organizationId") organizationId: string,
    @Param("bookingId") bookingId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(refundRequestSchema)) body: RefundRequest,
  ) {
    return this.agendaService.refundDeposit(organizationId, user.id, bookingId, body);
  }
}
