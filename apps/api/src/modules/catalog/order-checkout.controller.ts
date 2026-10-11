import { Body, Controller, Get, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { orderWebpayStartResponse, publicOrderStatusResponse } from "@impulza/contracts";
import type { Response } from "express";
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

  @Post("webpay")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "public-order-webpay" })
  @ApiOperation({
    summary: "Empezar a pagar un pedido con Webpay Plus",
    description:
      "Crea una transacción de Webpay Plus en el comercio del propio negocio por el total guardado del pedido (nunca un monto enviado por el visitante) y devuelve a dónde enviar al comprador por POST con `token_ws`. Cada intento crea una transacción nueva; al volver, el servidor confirma la última.",
  })
  @ApiZodResponse(200, orderWebpayStartResponse, "A dónde enviar al comprador.")
  @ApiResponse({ status: 404, description: ORDER_STATUS_NOT_FOUND })
  @ApiResponse({ status: 409, description: "El pedido ya no se puede pagar en línea." })
  @ApiResponse({ status: 503, description: "Webpay no está disponible ahora." })
  startWebpay(@Param("token") token: string) {
    return this.checkout.startWebpay(token);
  }
}

/**
 * Regreso del comprador desde Webpay Plus (F10.2d, ADR-030). Webpay no manda webhooks: Transbank redirige al comprador acá, con
 * `token_ws` (pagó o lo intentó) o `TBK_TOKEN` (abandonó), por GET o POST. Sin sesión ni CSRF (lo dispara el navegador del comprador
 * desde Transbank): el servidor confirma la transacción con las credenciales del negocio y siempre redirige a «Tu pedido».
 */
@ApiTags("public-catalog")
@Controller("payments/webpay/orders/:orderId")
export class OrderWebpayReturnController {
  constructor(private readonly checkout: OrderCheckoutService) {}

  private async finish(orderId: string, source: Record<string, unknown>, res: Response): Promise<void> {
    const text = (value: unknown) => (typeof value === "string" && value.length <= 200 ? value : undefined);
    const target = await this.checkout.handleWebpayReturn({
      orderId,
      statusToken: text(source.t),
      tokenWs: text(source.token_ws),
      tbkToken: text(source.TBK_TOKEN),
    });
    if (!target) throw new NotFoundException();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.redirect(HttpStatus.SEE_OTHER, target);
  }

  @Get("return")
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "orders-webpay-return" })
  @ApiExcludeEndpoint()
  async returnGet(@Param("orderId") orderId: string, @Query() query: Record<string, unknown>, @Res() res: Response) {
    await this.finish(orderId, query, res);
  }

  @Post("return")
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "orders-webpay-return" })
  @ApiExcludeEndpoint()
  async returnPost(@Param("orderId") orderId: string, @Query() query: Record<string, unknown>, @Body() body: Record<string, unknown> | undefined, @Res() res: Response) {
    // `t` va en la URL que pusimos; `token_ws` / `TBK_TOKEN` llegan en el cuerpo del formulario de Transbank.
    await this.finish(orderId, { ...query, ...(body ?? {}) }, res);
  }
}
