import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { publicPageResponse, publicSiteResponse } from "@impulza/contracts";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ApiZodResponse } from "../../openapi/zod-openapi.js";
import { PublicSitesService } from "./public-sites.service.js";

const SITE_NOT_FOUND =
  "Sitio no encontrado: no existe, o está archivado. Un sitio en borrador sin ninguna página publicada tampoco tiene nada que mostrar, pero eso lo decide cada página, no este endpoint.";
const PAGE_NOT_FOUND =
  "Página no encontrada: no existe, está en la papelera, o nunca se publicó — un borrador nunca es alcanzable acá, ni adivinando el slug exacto.";

/**
 * Render público (F2.7): lo que ve un visitante sin sesión. Sin `CsrfGuard` (solo GET, nada muta)
 * ni guards de organización/membresía — es, a propósito, la única familia de endpoints de esta API
 * que no cuelga de `/organizations/:organizationId`, porque un visitante no tiene una.
 *
 * `apps/web` es el único consumidor esperado y cachea cada respuesta hasta la siguiente
 * publicación (ver `PageVersionsService` y `RevalidateWebService`, F2.6/F2.7) — el límite de tasa
 * de acá es la última línea de defensa contra tráfico que ignora esa caché, no el mecanismo
 * principal de escala.
 */
@ApiTags("public-sites")
@Controller("public/sites")
@UseGuards(RateLimitGuard)
export class PublicSitesController {
  constructor(private readonly publicSitesService: PublicSitesService) {}

  @Get(":siteSlug")
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-site" })
  @ApiOperation({
    summary: "Sitio público por slug",
    description:
      "Identidad del sitio, su tema efectivo y la lista de páginas para el menú (solo las `PUBLIC` y publicadas). Es lo que resuelve la raíz de un sitio en `apps/web`.",
  })
  @ApiZodResponse(200, publicSiteResponse, "El sitio, listo para renderizar.")
  @ApiResponse({ status: 404, description: SITE_NOT_FOUND })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (120 por minuto y IP)." })
  async getSite(@Param("siteSlug") siteSlug: string) {
    return this.publicSitesService.getSite(siteSlug);
  }

  @Get(":siteSlug/pages/:pageSlug")
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-page" })
  @ApiOperation({
    summary: "Página publicada de un sitio, por slug",
    description:
      "El slug de la home es `inicio` (constante compartida, `@impulza/validation`); no tiene ruta propia porque es una página real como cualquier otra, solo que `apps/web` la sirve en la raíz del sitio. Los bloques ya vienen filtrados: sin los ocultos, sin los fuera de su ventana programada y sin los degradados — lo que se devuelve es exactamente lo que hay que pintar, en orden.",
  })
  @ApiZodResponse(200, publicPageResponse, "La página, con sus bloques listos para renderizar.")
  @ApiResponse({ status: 404, description: PAGE_NOT_FOUND })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (120 por minuto y IP)." })
  async getPage(@Param("siteSlug") siteSlug: string, @Param("pageSlug") pageSlug: string) {
    return this.publicSitesService.getPage(siteSlug, pageSlug);
  }
}
