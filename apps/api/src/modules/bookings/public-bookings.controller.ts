import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { bookingAvailabilityResponse, publicBookingConfirmationResponse, publicBookingInfoResponse } from "@impulza/contracts";
import { bookingAvailabilityQuerySchema, publicBookingRequestSchema, type BookingAvailabilityQuery } from "@impulza/validation";
import type { Request } from "express";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { PublicBookingsService, SLOT_TAKEN } from "./public-bookings.service.js";

const NOT_AVAILABLE = "El sitio no existe, está archivado o no recibe reservas; o el servicio no está disponible.";

/**
 * Reservas desde la página pública (F5.2): sin sesión, mismo criterio que los formularios
 * públicos (F3.2). `CsrfGuard` bloquea un `<form>` HTML entre sitios; el límite de tasa cuenta por
 * visitante real (cabeceras que reenvía `apps/web` con el secreto compartido).
 */
@ApiTags("public-bookings")
@Controller("public/sites/:siteSlug/booking")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicBookingsController {
  constructor(private readonly publicBookingsService: PublicBookingsService) {}

  @Get()
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-booking-info" })
  @ApiOperation({ summary: "Servicios reservables de un sitio", description: "Solo servicios activos; nunca el enlace de pago antes de reservar." })
  @ApiZodResponse(200, publicBookingInfoResponse, "Zona horaria, horizonte y servicios.")
  @ApiResponse({ status: 404, description: NOT_AVAILABLE })
  info(@Param("siteSlug") siteSlug: string) {
    return this.publicBookingsService.info(siteSlug);
  }

  @Get("availability")
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-booking-availability" })
  @ApiOperation({ summary: "Horarios libres de un servicio", description: "Descuenta reservas confirmadas, bloqueos, anticipación mínima y margen." })
  @ApiQuery({ name: "serviceId", required: true, type: String })
  @ApiQuery({ name: "from", required: true, description: "Primer día local, YYYY-MM-DD." })
  @ApiQuery({ name: "days", required: false, type: Number, description: "1 a 31 (por defecto 7)." })
  @ApiZodResponse(200, bookingAvailabilityResponse, "Horas de inicio libres por día.")
  @ApiResponse({ status: 400, description: "Parámetros inválidos." })
  @ApiResponse({ status: 404, description: NOT_AVAILABLE })
  availability(@Param("siteSlug") siteSlug: string, @Query(new ZodValidationPipe(bookingAvailabilityQuerySchema)) query: BookingAvailabilityQuery) {
    return this.publicBookingsService.availability(siteSlug, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "public-booking-create" })
  @ApiOperation({
    summary: "Reservar",
    description:
      "Valida en el servidor el servicio, la hora (con el mismo cálculo de horarios libres, bajo bloqueo por sitio) y los datos. Crea o actualiza el contacto con su consentimiento (ADR-004) y registra `booking_created`. Nunca cobra: si el servicio tiene enlace de pago del negocio, la confirmación lo trae.",
  })
  @ApiZodBody(publicBookingRequestSchema)
  @ApiZodResponse(201, publicBookingConfirmationResponse, "Reserva confirmada.")
  @ApiResponse({ status: 400, description: "Datos inválidos (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: NOT_AVAILABLE })
  @ApiResponse({ status: 409, description: SLOT_TAKEN })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (10 cada 10 minutos por visitante)." })
  create(@Param("siteSlug") siteSlug: string, @Body() body: unknown, @Req() request: Request) {
    return this.publicBookingsService.create(siteSlug, body, request);
  }
}
