import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { abuseReportAckResponse } from "@impulza/contracts";
import { createAbuseReportSchema, type CreateAbuseReportDto } from "@impulza/validation";
import type { Request } from "express";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ApiRateLimited, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { AbuseReportsService } from "./abuse-reports.service.js";

/**
 * Reporte de abuso de una página pública (F9.9a). Sin sesión ni datos personales obligatorios, mismo criterio que
 * `PublicFormsController`: `CsrfGuard` bloquea un `<form action>` de otro origen y el límite de tasa es por IP.
 */
@ApiTags("public-moderation")
@Controller("public/sites/:siteSlug/abuse-reports")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicAbuseReportsController {
  constructor(private readonly abuseReportsService: AbuseReportsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: 5, windowSeconds: 600, keyPrefix: "abuse-report" })
  @ApiOperation({
    summary: "Reportar una página pública",
    description:
      "Motivo de un catálogo cerrado, texto opcional (hasta 500 caracteres, texto plano) y correo opcional que nunca se muestra al propietario. No exige cuenta. Responde igual si el visitante ya reportó el sitio hoy. Un reporte nunca despublica nada por sí solo: lo revisa una persona del equipo.",
  })
  @ApiZodBody(createAbuseReportSchema)
  @ApiZodResponse(201, abuseReportAckResponse, "Reporte recibido.")
  @ApiResponse({ status: 400, description: "Motivo inválido o texto fuera de límites (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: "El sitio no existe o no está publicado." })
  @ApiRateLimited(5, 600)
  async create(
    @Param("siteSlug") siteSlug: string,
    @Body(new ZodValidationPipe(createAbuseReportSchema)) body: CreateAbuseReportDto,
    @Req() request: Request,
  ) {
    await this.abuseReportsService.createFromVisitor(siteSlug, body, request);
    return { received: true as const };
  }
}
