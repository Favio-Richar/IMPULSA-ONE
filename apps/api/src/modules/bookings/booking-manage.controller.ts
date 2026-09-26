import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { publicManagedBookingResponse } from "@impulza/contracts";
import { rescheduleBookingSchema, type RescheduleBookingInput } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { BookingManageService, MANAGE_NOT_FOUND, NEW_SLOT_TAKEN, TOO_LATE } from "./booking-manage.service.js";

/**
 * "Gestiona tu reserva" (F5.4): sin sesión; el enlace firmado del correo es la credencial. Mismo
 * 404 para un enlace inválido, de otra reserva o de un sitio archivado: sin pistas. La página de
 * `apps/web` (`/reserva/:token`) es quien llama; el navegador nunca habla directo con la API.
 */
@ApiTags("public-bookings")
@Controller("public/bookings/:token")
@UseGuards(CsrfGuard, RateLimitGuard)
export class BookingManageController {
  constructor(private readonly manageService: BookingManageService) {}

  @Get()
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "public-booking-manage" })
  @ApiOperation({ summary: "Ver una reserva con su enlace de gestión" })
  @ApiZodResponse(200, publicManagedBookingResponse, "La reserva, y si todavía se puede cambiar.")
  @ApiResponse({ status: 404, description: MANAGE_NOT_FOUND })
  view(@Param("token") token: string) {
    return this.manageService.view(token);
  }

  @Post("cancel")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "public-booking-cancel" })
  @ApiOperation({ summary: "Cancelar la reserva", description: "Hasta la anticipación mínima del negocio. Avisa al cliente y a los dueños." })
  @ApiZodResponse(200, publicManagedBookingResponse, "Reserva cancelada.")
  @ApiResponse({ status: 404, description: MANAGE_NOT_FOUND })
  @ApiResponse({ status: 409, description: TOO_LATE })
  cancel(@Param("token") token: string) {
    return this.manageService.cancel(token);
  }

  @Post("reschedule")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "public-booking-reschedule" })
  @ApiOperation({
    summary: "Cambiar la hora",
    description: "Hasta la anticipación mínima del negocio; la nueva hora con el mismo cálculo de horarios libres. Avisa al cliente y a los dueños y reinicia el recordatorio.",
  })
  @ApiZodBody(rescheduleBookingSchema)
  @ApiZodResponse(200, publicManagedBookingResponse, "Reserva con su hora nueva.")
  @ApiResponse({ status: 404, description: MANAGE_NOT_FOUND })
  @ApiResponse({ status: 409, description: `${TOO_LATE} / ${NEW_SLOT_TAKEN}` })
  reschedule(@Param("token") token: string, @Body(new ZodValidationPipe(rescheduleBookingSchema)) body: RescheduleBookingInput) {
    return this.manageService.reschedule(token, body);
  }
}
