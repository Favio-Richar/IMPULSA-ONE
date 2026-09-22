import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { formSubmissionAckResponse, publicFormResponse } from "@impulza/contracts";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ApiZodResponse } from "../../openapi/zod-openapi.js";
import { PublicFormsService } from "./public-forms.service.js";

const FORM_NOT_FOUND = "Formulario no encontrado: no existe, o el sitio está archivado.";

/**
 * Envío público de formularios (F3.2) — el visitante no tiene sesión, mismo criterio que
 * `PublicSitesController` (F2.7): sin `SessionAuthGuard` ni guards de organización. `CsrfGuard` sí
 * aplica acá (a diferencia de ese controlador, que es solo lectura): exigir la cabecera
 * `X-Requested-With` bloquea un `<form action="...">` HTML entre sitios, aunque no haya sesión que
 * proteger — es la misma defensa de "no aceptar una escritura disparada por otro origen".
 */
@ApiTags("public-forms")
@Controller("public/sites/:siteSlug/forms")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicFormsController {
  constructor(private readonly publicFormsService: PublicFormsService) {}

  @Get(":formId")
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-form" })
  @ApiOperation({
    summary: "Definición pública de un formulario",
    description:
      "Lo que necesita el bloque `contact_form` del sitio público para pintar sus campos: sin `siteId`, sin timestamps, sin nada que un visitante anónimo no necesite.",
  })
  @ApiZodResponse(200, publicFormResponse, "El formulario, listo para renderizar.")
  @ApiResponse({ status: 404, description: FORM_NOT_FOUND })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (120 por minuto y IP)." })
  async getForm(@Param("siteSlug") siteSlug: string, @Param("formId") formId: string) {
    return this.publicFormsService.getPublicForm(siteSlug, formId);
  }

  @Post(":formId/submissions")
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "public-form-submit" })
  @ApiOperation({
    summary: "Enviar un formulario",
    description:
      "Validado en servidor contra los campos reales del formulario (nunca contra lo que declare el cliente). Con un campo de consentimiento marcado, crea o actualiza un `Contact` y su `ContactEvent`; sin consentimiento, solo queda el `FormSubmission` (ADR-004 punto 3). Límite de tasa propio y más estricto que la lectura: un envío es una escritura real.",
  })
  @ApiZodResponse(201, formSubmissionAckResponse, "Mensaje de éxito (y redirect si el formulario lo define).")
  @ApiResponse({ status: 400, description: "El envío no cumple con los campos del formulario." })
  @ApiResponse({ status: 404, description: FORM_NOT_FOUND })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (20 por minuto y IP)." })
  async submit(
    @Param("siteSlug") siteSlug: string,
    @Param("formId") formId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.publicFormsService.submit(siteSlug, formId, body ?? {});
  }
}
