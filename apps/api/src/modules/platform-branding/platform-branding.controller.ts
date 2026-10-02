import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { publicPlatformBrandingResponse } from "@impulza/contracts";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ApiRateLimited, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { PlatformBrandingService } from "./platform-branding.service.js";

@ApiTags("platform-branding")
@Controller("platform/branding")
export class PlatformBrandingController {
  constructor(private readonly brandingService: PlatformBrandingService) {}

  @Get()
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-platform-branding" })
  @ApiOperation({
    summary: "Marca pública de la plataforma",
    description:
      "Identidad pública de la plataforma (nombre, colores, enlaces legales y logotipos). Usada por el sitio web comercial, pantallas de acceso, onboarding y clientes públicos. Con caché corta e invalidación inmediata al editar. Nunca expone datos internos ni correos.",
  })
  @ApiZodResponse(200, publicPlatformBrandingResponse, "Marca pública activa de la plataforma.")
  @ApiRateLimited(120, 60)
  async getPublic() {
    return this.brandingService.getPublic();
  }
}
