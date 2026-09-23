import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import type { Request } from "express";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ApiZodResponse } from "../../openapi/zod-openapi.js";
import { PublicLinksService } from "./public-links.service.js";

const resolvedLinkResponse = z.object({ destinationUrl: z.string() });

/**
 * Resolución pública de enlaces cortos y QR (F3.5) — sin sesión, mismo criterio que
 * `PublicSitesController`. Solo GET: quien llama es la propia ruta de `apps/web`
 * (`app/s/[slug]/route.ts`, `app/qr/[qrCodeId]/route.ts`), que hace el `fetch` server-to-server y
 * emite ella misma el redirect real al visitante — el navegador nunca ve esta URL.
 */
@ApiTags("public-links")
@Controller("public")
@UseGuards(RateLimitGuard)
export class PublicLinksController {
  constructor(private readonly publicLinksService: PublicLinksService) {}

  @Get("short-links/:slug")
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-short-link" })
  @ApiOperation({
    summary: "Resolver un enlace corto",
    description: "Cuenta el clic y registra el evento `short_link_click` antes de devolver el destino.",
  })
  @ApiZodResponse(200, resolvedLinkResponse, "El destino a donde redirigir.")
  @ApiResponse({ status: 404, description: "Enlace no encontrado." })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (120 por minuto y IP)." })
  async resolveShortLink(@Param("slug") slug: string, @Req() request: Request) {
    return this.publicLinksService.resolveShortLink(slug, request);
  }

  @Get("qr/:qrCodeId")
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-qr" })
  @ApiOperation({
    summary: "Resolver un código QR",
    description: "Cuenta el escaneo y registra el evento `qr_visit` antes de devolver el destino.",
  })
  @ApiZodResponse(200, resolvedLinkResponse, "El destino a donde redirigir.")
  @ApiResponse({ status: 404, description: "Código QR no encontrado." })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (120 por minuto y IP)." })
  async resolveQrCode(@Param("qrCodeId") qrCodeId: string, @Req() request: Request) {
    return this.publicLinksService.resolveQrCode(qrCodeId, request);
  }
}
