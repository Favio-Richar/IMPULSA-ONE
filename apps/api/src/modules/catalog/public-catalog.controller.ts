import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { publicCatalogResponse, publicOrderConfirmationResponse } from "@impulza/contracts";
import { publicOrderRequestSchema } from "@impulza/validation";
import type { Request } from "express";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { OUT_OF_STOCK, PRODUCT_UNAVAILABLE, PublicCatalogService } from "./public-catalog.service.js";

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

  @Post("orders")
  @HttpCode(HttpStatus.CREATED)
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
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (10 cada 10 minutos por visitante)." })
  createOrder(@Param("siteSlug") siteSlug: string, @Body() body: unknown, @Req() request: Request) {
    return this.publicCatalogService.createOrder(siteSlug, body, request);
  }
}
