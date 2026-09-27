import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { publicUnsubscribeResponse } from "@impulza/contracts";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ApiZodResponse } from "../../openapi/zod-openapi.js";
import { PublicUnsubscribeService, UNSUBSCRIBE_NOT_FOUND } from "./public-unsubscribe.service.js";

/**
 * Baja de campañas (F5.6): la página `/baja/:token` de `apps/web` y el "darse de baja con un clic"
 * de los clientes de correo (RFC 8058, vía la ruta de `apps/web`) llaman acá.
 */
@ApiTags("public-campaigns")
@Controller("public/unsubscribe/:token")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicUnsubscribeController {
  constructor(private readonly unsubscribeService: PublicUnsubscribeService) {}

  @Get()
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "public-unsubscribe-view" })
  @ApiOperation({ summary: "Ver a qué corresponde un enlace de baja" })
  @ApiZodResponse(200, publicUnsubscribeResponse, "Negocio, correo enmascarado y si ya se dio de baja.")
  @ApiResponse({ status: 404, description: UNSUBSCRIBE_NOT_FOUND })
  view(@Param("token") token: string) {
    return this.unsubscribeService.view(token);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowSeconds: 600, keyPrefix: "public-unsubscribe" })
  @ApiOperation({ summary: "Darse de baja", description: "Se respeta de inmediato, también para lo que quedaba en cola. Idempotente." })
  @ApiZodResponse(200, publicUnsubscribeResponse, "Baja registrada.")
  @ApiResponse({ status: 404, description: UNSUBSCRIBE_NOT_FOUND })
  unsubscribe(@Param("token") token: string) {
    return this.unsubscribeService.unsubscribe(token);
  }
}
