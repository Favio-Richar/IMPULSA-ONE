import { Controller, Get, NotFoundException, Param, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { publicDomainResolution } from "@impulza/contracts";
import { customDomainSchema } from "@impulza/validation";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ApiZodResponse } from "../../openapi/zod-openapi.js";
import { DomainsService } from "./domains.service.js";

const NOT_FOUND = "Dominio no encontrado.";

/**
 * Resolución pública de dominios propios (F4.7). La llama el `proxy` de `apps/web` en cada visita a
 * un host que no es el de la plataforma: devuelve solo el slug del sitio. Mismo 404 para un dominio
 * inexistente, pendiente, de un sitio archivado o de una organización bloqueada: sin pistas.
 */
@ApiTags("public-domains")
@Controller("public/domains")
@UseGuards(RateLimitGuard)
export class PublicDomainsController {
  constructor(private readonly domainsService: DomainsService) {}

  @Get(":hostname")
  @RateLimit({ limit: 600, windowSeconds: 60, keyPrefix: "public-domain" })
  @ApiOperation({ summary: "Resolver un dominio propio verificado" })
  @ApiZodResponse(200, publicDomainResolution, "El slug del sitio que se sirve en ese dominio.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (600 por minuto y origen)." })
  async resolve(@Param("hostname") hostname: string) {
    const parsed = customDomainSchema.safeParse(hostname);
    if (!parsed.success) {
      throw new NotFoundException(NOT_FOUND);
    }
    const resolution = await this.domainsService.resolvePublic(parsed.data);
    if (!resolution) {
      throw new NotFoundException(NOT_FOUND);
    }
    return resolution;
  }
}
