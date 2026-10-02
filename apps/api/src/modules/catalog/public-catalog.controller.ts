import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { publicCatalogResponse, publicCouponCheckResponse, publicOrderConfirmationResponse } from "@impulza/contracts";
import { COUPON_INVALID_MESSAGE, publicCartCouponCheckSchema, publicCartOrderRequestSchema, publicCouponCheckSchema, publicOrderRequestSchema } from "@impulza/validation";
import type { Request } from "express";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { FeatureFlagGuard, RequireFeature } from "../feature-flags/feature-flag.guard.js";
import { ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CART_DIGITAL_ALONE, CART_MIXED_CURRENCY, OUT_OF_STOCK, PRODUCT_UNAVAILABLE, PublicCatalogService } from "./public-catalog.service.js";

const NOT_AVAILABLE = "El sitio no existe, está archivado o su organización no está activa.";

/**
 * Catálogo y pedidos desde la página pública (F5.5): sin sesión, mismo criterio que formularios y
 * reservas (CSRF por origen, límite de tasa por visitante real).
 */
@ApiTags("public-catalog")
@Controller("public/sites/:siteSlug/catalog")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicCatalogController {
  constructor(private readonly publicCatalogService: PublicCatalogService) {}

  @Get()
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-catalog" })
  @ApiOperation({ summary: "Catálogo de un sitio", description: "Solo productos activos; nunca el enlace de pago ni el stock exacto." })
  @ApiZodResponse(200, publicCatalogResponse, "Categorías y productos.")
  @ApiResponse({ status: 404, description: NOT_AVAILABLE })
  catalog(@Param("siteSlug") siteSlug: string) {
    return this.publicCatalogService.catalog(siteSlug);
  }

  @Post("coupons/check")
  @HttpCode(HttpStatus.OK)
  // Tope estricto por visitante: probar códigos a ciegas no debe ser barato (F7.8b).
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "public-coupon-check" })
  @ApiOperation({
    summary: "Probar un código de descuento",
    description:
      "Calcula el descuento con lo que se pediría (producto, variante y cantidad). Cualquier código que no aplica — inexistente, vencido, agotado, pausado, de otra moneda o bajo el mínimo — recibe el mismo 422. No cuenta un uso: eso ocurre al hacer el pedido.",
  })
  @ApiZodBody(publicCouponCheckSchema)
  @ApiZodResponse(200, publicCouponCheckResponse, "Descuento calculado por el servidor.")
  @ApiResponse({ status: 404, description: `${NOT_AVAILABLE} O: ${PRODUCT_UNAVAILABLE}` })
  @ApiResponse({ status: 422, description: COUPON_INVALID_MESSAGE })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (10 cada 10 minutos por visitante)." })
  checkCoupon(@Param("siteSlug") siteSlug: string, @Body() body: unknown) {
    return this.publicCatalogService.checkCoupon(siteSlug, body);
  }

  @Post("orders")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(FeatureFlagGuard)
  @RequireFeature("pagos_en_linea")
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "public-order-create" })
  @ApiOperation({
    summary: "Hacer un pedido",
    description:
      "Precio y enlace de pago salen del producto guardado. Descuenta stock de forma atómica, crea o actualiza el contacto con su consentimiento (ADR-004) y registra `order_created`. Nunca cobra: si el producto tiene enlace de pago del negocio, la confirmación lo trae.",
  })
  @ApiZodBody(publicOrderRequestSchema)
  @ApiZodResponse(201, publicOrderConfirmationResponse, "Pedido recibido.")
  @ApiResponse({ status: 400, description: "Datos inválidos (detalle en `issues`); un producto físico exige dirección." })
  @ApiResponse({ status: 404, description: `${NOT_AVAILABLE} O: ${PRODUCT_UNAVAILABLE}` })
  @ApiResponse({ status: 409, description: OUT_OF_STOCK })
  @ApiResponse({ status: 422, description: `Cupón que no aplica: ${COUPON_INVALID_MESSAGE}` })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (10 cada 10 minutos por visitante)." })
  createOrder(@Param("siteSlug") siteSlug: string, @Body() body: unknown, @Req() request: Request) {
    return this.publicCatalogService.createOrder(siteSlug, body, request);
  }

  @Post("cart/coupons/check")
  @HttpCode(HttpStatus.OK)
  // Mismo cupo que probar un código en un producto: probar códigos a ciegas no debe ser barato.
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "public-coupon-check" })
  @ApiOperation({
    summary: "Probar un código de descuento con el carrito",
    description: "Como `coupons/check`, pero el descuento va sobre el subtotal de todas las líneas (F7.8c). Misma respuesta uniforme para cualquier código que no aplica.",
  })
  @ApiZodBody(publicCartCouponCheckSchema)
  @ApiZodResponse(200, publicCouponCheckResponse, "Descuento calculado por el servidor.")
  @ApiResponse({ status: 400, description: `Líneas inválidas, o: ${CART_MIXED_CURRENCY} O: ${CART_DIGITAL_ALONE}` })
  @ApiResponse({ status: 404, description: `${NOT_AVAILABLE} O: ${PRODUCT_UNAVAILABLE}` })
  @ApiResponse({ status: 422, description: COUPON_INVALID_MESSAGE })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (10 cada 10 minutos por visitante)." })
  checkCartCoupon(@Param("siteSlug") siteSlug: string, @Body() body: unknown) {
    return this.publicCatalogService.checkCartCoupon(siteSlug, body);
  }

  @Post("cart/orders")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(FeatureFlagGuard)
  @RequireFeature("pagos_en_linea")
  // Comparte el cupo con el pedido suelto: un carrito no abre una vía más rápida para pedir.
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "public-order-create" })
  @ApiOperation({
    summary: "Hacer un pedido desde el carrito",
    description:
      "Hasta 20 líneas (producto y variante, sin repetir) en un solo pedido (F7.8c, ADR-023). Precios, stock y moneda salen de la base; una sola moneda por pedido y un producto digital se compra solo. El stock de todas las líneas y el uso del cupón se reservan en una transacción: todo o nada.",
  })
  @ApiZodBody(publicCartOrderRequestSchema)
  @ApiZodResponse(201, publicOrderConfirmationResponse, "Pedido recibido (el nombre es un resumen de las líneas).")
  @ApiResponse({ status: 400, description: `Datos inválidos (detalle en \`issues\`): ${CART_MIXED_CURRENCY} O: ${CART_DIGITAL_ALONE} O: dirección faltante.` })
  @ApiResponse({ status: 404, description: `${NOT_AVAILABLE} O: ${PRODUCT_UNAVAILABLE}` })
  @ApiResponse({ status: 409, description: "No quedan suficientes unidades de una línea (el mensaje la nombra); no se reserva nada." })
  @ApiResponse({ status: 422, description: `Cupón que no aplica: ${COUPON_INVALID_MESSAGE}` })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (10 cada 10 minutos por visitante)." })
  createCartOrder(@Param("siteSlug") siteSlug: string, @Body() body: unknown, @Req() request: Request) {
    return this.publicCatalogService.createCartOrder(siteSlug, body, request);
  }
}
