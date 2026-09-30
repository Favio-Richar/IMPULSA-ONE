import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { BookingDepositService } from "./booking-deposit.service.js";

/**
 * Avisos de Mercado Pago sobre la seña de una reserva (F5.10, ADR-013). Sin sesión ni cabecera
 * anti-CSRF (los manda Mercado Pago): vale solo con la firma `x-signature` de la aplicación de
 * Impulza, y aun así el pago se consulta con el token del negocio antes de aplicar nada.
 */
@ApiTags("public-bookings")
@Controller("payments/mercadopago/bookings/:bookingId")
export class BookingDepositWebhookController {
  constructor(private readonly deposit: BookingDepositService) {}

  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 600, windowSeconds: 60, keyPrefix: "bookings-mp-webhook" })
  @ApiExcludeEndpoint()
  async webhook(
    @Param("bookingId") bookingId: string,
    @Headers("x-signature") signature: string | undefined,
    @Headers("x-request-id") requestId: string | undefined,
    @Query() query: Record<string, unknown>,
    @Body() body: Record<string, unknown> | undefined,
  ) {
    const dataId = typeof query["data.id"] === "string" ? query["data.id"] : undefined;
    const type = typeof query.type === "string" ? query.type : typeof body?.type === "string" ? body.type : undefined;
    return this.deposit.handleWebhook({ bookingId, signature, requestId, dataId, type });
  }
}
