import { Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { publicDigitalCardResponse, walletGoogleResponse } from "@impulza/contracts";
import type { Response } from "express";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ApiRateLimited, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { DigitalCardService } from "./digital-card.service.js";

/** Tarjeta digital pública (F10.4, ADR-029). Sin sesión. Mientras la tarjeta no esté activa, todo responde 404. */
@ApiTags("public-digital-card")
@Controller("public/sites/:siteSlug/card")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicDigitalCardController {
  constructor(private readonly cards: DigitalCardService) {}

  @Get()
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-card" })
  @ApiOperation({ summary: "Tarjeta digital del sitio" })
  @ApiZodResponse(200, publicDigitalCardResponse, "La tarjeta y qué pases de wallet se ofrecen.")
  @ApiResponse({ status: 404, description: "El sitio no existe o su tarjeta no está activa." })
  @ApiRateLimited(120, 60)
  card(@Param("siteSlug") siteSlug: string) {
    return this.cards.publicView(siteSlug);
  }

  @Get("vcard")
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "public-card-vcard" })
  @ApiOperation({ summary: "Descargar la tarjeta como vCard", description: "Archivo `text/vcard` (vCard 3.0), con los campos escapados." })
  @ApiResponse({ status: 200, description: "Archivo vCard." })
  @ApiResponse({ status: 404, description: "El sitio no existe o su tarjeta no está activa." })
  @ApiRateLimited(60, 60)
  async vcard(@Param("siteSlug") siteSlug: string, @Res({ passthrough: true }) res: Response): Promise<string> {
    const { fileName, content } = await this.cards.vcard(siteSlug);
    res.setHeader("Content-Type", "text/vcard; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    return content;
  }

  @Post("wallet/google")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "public-card-google" })
  @ApiOperation({ summary: "Pase de Google Wallet", description: "Devuelve la dirección «Guardar en Google Wallet». Sin credenciales de la plataforma, 503 `WALLET_UNAVAILABLE`." })
  @ApiZodResponse(200, walletGoogleResponse, "Dirección para guardar el pase.")
  @ApiResponse({ status: 404, description: "El sitio no existe o su tarjeta no está activa." })
  @ApiResponse({ status: 503, description: "Google Wallet no está disponible." })
  @ApiRateLimited(20, 60)
  async google(@Param("siteSlug") siteSlug: string) {
    const result = await this.cards.wallet(siteSlug, "google");
    return { saveUrl: result.kind === "redirect" ? result.url : "" };
  }

  @Get("wallet/apple")
  @Header("Cache-Control", "no-store")
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "public-card-apple" })
  @ApiOperation({ summary: "Pase de Apple Wallet", description: "Archivo `.pkpass` firmado. Sin credenciales de la plataforma, 503 `WALLET_UNAVAILABLE`." })
  @ApiResponse({ status: 200, description: "Archivo .pkpass." })
  @ApiResponse({ status: 404, description: "El sitio no existe o su tarjeta no está activa." })
  @ApiResponse({ status: 503, description: "Apple Wallet no está disponible." })
  @ApiRateLimited(20, 60)
  async apple(@Param("siteSlug") siteSlug: string, @Res() res: Response): Promise<void> {
    const result = await this.cards.wallet(siteSlug, "apple");
    if (result.kind !== "file") {
      res.status(502).end();
      return;
    }
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    res.send(result.body);
  }
}
