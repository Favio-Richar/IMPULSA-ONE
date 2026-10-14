import { Controller, Get, Inject, Param, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { PrismaClient } from "@impulza/database";
import { slugAvailabilityResponse, type SlugAvailabilityResponse } from "@impulza/contracts";
import { isReservedSlug, slugSchema } from "@impulza/validation";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { PRISMA } from "../../database/prisma.module.js";
import { ApiZodResponse } from "../../openapi/zod-openapi.js";

/**
 * Disponibilidad en vivo de la dirección pública de un sitio (paso 5 del onboarding). Solo lectura y sin sesión: una
 * dirección ya es pública por definición (resuelve una URL), así que saber si está tomada no revela nada nuevo. La regla
 * es la misma de `SitesService.assertSlugAvailable` (otro sitio o una redirección viva la ocupan), y la creación real
 * sigue validándola en el servidor: esta comprobación es una ayuda de interfaz, nunca la garantía.
 */
@ApiTags("public-sites")
@Controller("public/site-slugs")
@UseGuards(RateLimitGuard)
export class SlugAvailabilityController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get(":slug/availability")
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "slug-availability" })
  @ApiOperation({
    summary: "¿Está libre esta dirección pública?",
    description: "Responde `free`, `taken`, `reserved` o `invalid` para el slug dado. No requiere sesión.",
  })
  @ApiZodResponse(200, slugAvailabilityResponse, "Estado de la dirección.")
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (60 por minuto y IP)." })
  async check(@Param("slug") rawSlug: string): Promise<SlugAvailabilityResponse> {
    const slug = rawSlug.trim().toLowerCase();
    if (!slugSchema.safeParse(slug).success) {
      return { slug, available: false, reason: "invalid" };
    }
    if (isReservedSlug(slug)) {
      return { slug, available: false, reason: "reserved" };
    }
    const [site, redirect] = await Promise.all([
      this.prisma.site.findUnique({ where: { slug }, select: { id: true } }),
      this.prisma.siteSlugRedirect.findUnique({ where: { fromSlug: slug }, select: { id: true } }),
    ]);
    return site || redirect ? { slug, available: false, reason: "taken" } : { slug, available: true, reason: "free" };
  }
}
