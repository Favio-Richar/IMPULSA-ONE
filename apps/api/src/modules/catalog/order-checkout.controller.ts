import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { publicOrderStatusResponse } from "@impulza/contracts";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ApiZodResponse } from "../../openapi/zod-openapi.js";
import { ORDER_STATUS_NOT_FOUND, OrderCheckoutService } from "./order-checkout.service.js";

/**
 * Avisos de Mercado Pago sobre los pagos de un pedido (F5.9, ADR-013). Sin sesión ni cabecera
 * anti-CSRF (los manda Mercado Pago): vale solo con la firma `x-signature` de la aplicación de
 * Impulza, y aun así el pago se consulta con el token del negocio antes de aplicar nada.
 */
@ApiTags("public-catalog")
@Controller("payments/mercadopago/orders/:orderId")
export class OrderPaymentWebhookController {
  constructor(private readonly checkout: OrderCheckoutService) {}

  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 600, windowSeconds: 60, keyPrefix: "orders-mp-webhook" })
  @ApiExcludeEndpoint()
  async webhook(
    @Param("orderId") orderId: string,
    @Headers("x-signature") signature: string | undefined,
    @Headers("x-request-id") requestId: string | undefined,
    @Query() query: Record<string, unknown>,
    @Body() body: Record<string, unknown> | undefined,
  ) {
    // Igual que en suscripciones: la firma se calcula sobre el `data.id` de la URL.
    const dataId = typeof query["data.id"] === "string" ? query["data.id"] : undefined;
    const type = typeof query.type === "string" ? query.type : typeof body?.type === "string" ? body.type : undefined;
    return this.checkout.handleWebhook({ orderId, signature, requestId, dataId, type });
  }
}

/**
 * "Tu pedido" (F5.9): sin sesión; el enlace del correo (o el regreso desde Mercado Pago) es la
 * credencial. La página de `apps/web` (`/pedido/:token`) es quien llama.
 */
@ApiTags("public-catalog")
@Controller("public/orders/:token")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicOrderStatusController {
  constructor(private readonly checkout: OrderCheckoutService) {}

  @Get()
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "public-order-status" })
  @ApiOperation({
    summary: "Estado de un pedido con su enlace",
    description:
      "Producto, total y estado del pedido, y dónde pagarlo mientras espera pago. Con `paymentId` (el `payment_id` con que vuelve Mercado Pago) consulta ese pago con el token del negocio antes de responder. Sin datos personales.",
  })
  @ApiQuery({ name: "paymentId", required: false, description: "Id del pago en Mercado Pago, tal como vuelve el comprador." })
  @ApiZodResponse(200, publicOrderStatusResponse, "El pedido y su estado de pago.")
  @ApiResponse({ status: 404, description: ORDER_STATUS_NOT_FOUND })
  status(@Param("token") token: string, @Query("paymentId") paymentId: unknown) {
    return this.checkout.publicStatus(token, typeof paymentId === "string" ? paymentId : undefined);
  }
}
