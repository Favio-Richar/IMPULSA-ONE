import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { templateResponse } from "@impulza/contracts";
import { TEMPLATE_INDUSTRIES, TEMPLATE_OBJECTIVES, THEME_FAMILIES } from "@impulza/validation";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ApiRateLimited, ApiZodArrayResponse, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { listTemplatesQuerySchema, type ListTemplatesQueryDto } from "./dto/list-templates-query.dto.js";
import { TEMPLATE_NOT_FOUND, TemplatesService } from "./templates.service.js";

const LIST_LIMIT = 60;
const DETAIL_LIMIT = 120;
const WINDOW_SECONDS = 60;

/**
 * Catálogo de plantillas (PL1, PM §7.4). Sin sesión, igual que el catálogo de planes: la galería
 * pública del sitio comercial y el paso de plantilla del onboarding (antes de tener organización)
 * lo leen. Solo GET y contenido de la plataforma, nunca datos de un tenant. Con límite de tasa por
 * IP porque es una ruta sin autenticación.
 */
@ApiTags("templates")
@Controller("templates")
@UseGuards(RateLimitGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  @RateLimit({ limit: LIST_LIMIT, windowSeconds: WINDOW_SECONDS, keyPrefix: "templates-list" })
  @ApiOperation({
    summary: "Catálogo de plantillas",
    description:
      "Plantillas en orden de galería, con su tema (tokens incluidos), fondo y bloques de ejemplo. Filtros opcionales y combinables por industria, objetivo y línea de estilo.",
  })
  @ApiQuery({ name: "industry", required: false, enum: TEMPLATE_INDUSTRIES })
  @ApiQuery({ name: "objective", required: false, enum: TEMPLATE_OBJECTIVES })
  @ApiQuery({ name: "family", required: false, enum: THEME_FAMILIES })
  @ApiZodArrayResponse(200, templateResponse, "Plantillas que cumplen los filtros (puede ser una lista vacía).")
  @ApiResponse({ status: 400, description: "Un filtro con un valor fuera del catálogo." })
  @ApiRateLimited(LIST_LIMIT, WINDOW_SECONDS)
  async list(@Query(new ZodValidationPipe(listTemplatesQuerySchema)) query: ListTemplatesQueryDto) {
    return this.templatesService.listTemplates(query);
  }

  @Get(":code")
  @RateLimit({ limit: DETAIL_LIMIT, windowSeconds: WINDOW_SECONDS, keyPrefix: "templates-detail" })
  @ApiOperation({ summary: "Leer una plantilla por código" })
  @ApiParam({ name: "code", description: "Código estable de la plantilla (`profesional-servicios`, …)." })
  @ApiZodResponse(200, templateResponse, "La plantilla solicitada.")
  @ApiResponse({ status: 404, description: TEMPLATE_NOT_FOUND })
  @ApiRateLimited(DETAIL_LIMIT, WINDOW_SECONDS)
  async getOne(@Param("code") code: string) {
    return this.templatesService.getTemplate(code);
  }
}
