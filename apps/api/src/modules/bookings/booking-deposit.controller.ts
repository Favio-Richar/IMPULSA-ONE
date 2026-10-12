import { Body, Controller, Get, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
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

/**
 * Regreso del cliente desde Webpay Plus tras pagar la seña (F10.2e, ADR-030). Sin sesión ni CSRF (lo dispara el navegador
 * desde Transbank): el servidor confirma la transacción con las credenciales del negocio y siempre redirige a «Tu reserva».
 */
@ApiTags("public-bookings")
@Controller("payments/webpay/bookings/:token")
export class BookingWebpayReturnController {
  constructor(private readonly deposit: BookingDepositService) {}

  private async finish(token: string, source: Record<string, unknown>, res: Response): Promise<void> {
    const text = (value: unknown) => (typeof value === "string" && value.length <= 200 ? value : undefined);
    const target = await this.deposit.handleWebpayReturn({ token, tokenWs: text(source.token_ws), tbkToken: text(source.TBK_TOKEN) });
    if (!target) throw new NotFoundException();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.redirect(HttpStatus.SEE_OTHER, target);
  }

  @Get("return")
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "bookings-webpay-return" })
  @ApiExcludeEndpoint()
  async returnGet(@Param("token") token: string, @Query() query: Record<string, unknown>, @Res() res: Response) {
    await this.finish(token, query, res);
  }

  @Post("return")
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "bookings-webpay-return" })
  @ApiExcludeEndpoint()
  async returnPost(@Param("token") token: string, @Body() body: Record<string, unknown> | undefined, @Res() res: Response) {
    await this.finish(token, body ?? {}, res);
  }
}
