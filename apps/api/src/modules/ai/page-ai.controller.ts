import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { aiBlockProposalsResponse, aiSeoProposalsResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  aiBlockCopyRequestSchema,
  aiSeoRequestSchema,
  aiTranslateRequestSchema,
  type AiBlockCopyRequest,
  type AiSeoRequest,
  type AiTranslateRequest,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiUuidParam, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { PageAiService } from "./page-ai.service.js";

const NOT_FOUND = "Página o bloque no encontrados, o de otra organización (ADR-002).";
const NOT_SUPPORTED = "`AI_BLOCK_NOT_SUPPORTED`: el bloque no tiene textos para esta tarea o su configuración no se puede mostrar; `AI_CONTENT_TOO_LONG`: demasiado texto para traducir de una vez.";
const PLAN_LIMIT = "`PLAN_LIMIT_REACHED`: se agotó la cuota mensual de IA del plan (`aiRequestsPerMonth`).";
const RATE_LIMIT = "Demasiadas solicitudes al asistente en el último minuto.";
const UNAVAILABLE = "`AI_UNAVAILABLE`: no hay modelos configurados para la tarea o ninguno respondió.";
const NO_PROPOSAL = "`AI_NO_USEFUL_PROPOSAL`: el modelo respondió, pero ninguna propuesta era válida o distinta de lo actual.";

// Generar propuestas consume cuota del plan y prepara un cambio de contenido: exige el mismo permiso
// que editar la página (`page.manage`). Ninguna de estas rutas escribe: aplicar es la edición normal.
@ApiTags("ai")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/pages/:pageId/ai")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class PageAiController {
  constructor(private readonly pageAiService: PageAiService) {}

  @Post("block-copy")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({
    summary: "Proponer textos para un bloque",
    description:
      "Hasta 3 propuestas de título, subtítulo o texto de botón del bloque (F6.3), ya validadas contra el esquema del bloque. No guarda nada: el panel aplica la elegida con la edición normal del bloque.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página del bloque.")
  @ApiZodBody(aiBlockCopyRequestSchema)
  @ApiZodResponse(200, aiBlockProposalsResponse, "Textos actuales y propuestas.")
  @ApiResponse({ status: 402, description: PLAN_LIMIT })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 422, description: NOT_SUPPORTED })
  @ApiResponse({ status: 429, description: RATE_LIMIT })
  @ApiResponse({ status: 502, description: NO_PROPOSAL })
  @ApiResponse({ status: 503, description: UNAVAILABLE })
  async blockCopy(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(aiBlockCopyRequestSchema)) body: AiBlockCopyRequest,
  ) {
    return this.pageAiService.proposeBlockCopy(organizationId, user.id, siteId, pageId, body);
  }

  @Post("translate")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({
    summary: "Traducir los textos de un bloque",
    description:
      "Una propuesta con todos los textos visibles del bloque traducidos a un idioma de la lista cerrada (F6.3). Los textos enriquecidos vuelven sanitizados. No guarda nada.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página del bloque.")
  @ApiZodBody(aiTranslateRequestSchema)
  @ApiZodResponse(200, aiBlockProposalsResponse, "Textos actuales y la traducción propuesta.")
  @ApiResponse({ status: 402, description: PLAN_LIMIT })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 422, description: NOT_SUPPORTED })
  @ApiResponse({ status: 429, description: RATE_LIMIT })
  @ApiResponse({ status: 502, description: NO_PROPOSAL })
  @ApiResponse({ status: 503, description: UNAVAILABLE })
  async translate(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(aiTranslateRequestSchema)) body: AiTranslateRequest,
  ) {
    return this.pageAiService.translateBlock(organizationId, user.id, siteId, pageId, body);
  }

  @Post("seo")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({
    summary: "Proponer título y descripción SEO",
    description:
      "Hasta 3 pares de título y descripción para buscadores derivados del contenido visible de la página (F6.3). No guarda nada: se aplican al formulario de SEO.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página.")
  @ApiZodBody(aiSeoRequestSchema)
  @ApiZodResponse(200, aiSeoProposalsResponse, "SEO actual y propuestas.")
  @ApiResponse({ status: 402, description: PLAN_LIMIT })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 422, description: "`AI_BLOCK_NOT_SUPPORTED`: la página no tiene contenido visible del que derivar el SEO." })
  @ApiResponse({ status: 429, description: RATE_LIMIT })
  @ApiResponse({ status: 502, description: NO_PROPOSAL })
  @ApiResponse({ status: 503, description: UNAVAILABLE })
  async seo(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(aiSeoRequestSchema)) body: AiSeoRequest,
  ) {
    return this.pageAiService.proposeSeo(organizationId, user.id, siteId, pageId, body);
  }
}
