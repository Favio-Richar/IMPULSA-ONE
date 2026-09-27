import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { campaignAudienceResponse, campaignResponse, campaignSegmentOptionsResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  campaignSchema,
  campaignSegmentSchema,
  updateCampaignSchema,
  type CampaignInput,
  type CampaignSegment,
  type UpdateCampaignInput,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiUuidParam, ApiZodArrayResponse, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { ANOTHER_SENDING, CAMPAIGN_NOT_DRAFT, CAMPAIGN_NOT_FOUND, CampaignsService, LINKS_NOT_CONFIGURED, NO_AUDIENCE } from "./campaigns.service.js";

@ApiTags("campaigns")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/campaigns")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  @ApiOperation({ summary: "Listar campañas", description: "Cualquier miembro activo las ve, con sus métricas." })
  @ApiZodArrayResponse(200, campaignResponse, "Campañas, de la más nueva a la más antigua.")
  list(@Param("organizationId") organizationId: string) {
    return this.campaignsService.list(organizationId);
  }

  @Get("segment-options")
  @ApiOperation({ summary: "Etiquetas y fuentes de los contactos", description: "Para armar el segmento de una campaña." })
  @ApiZodResponse(200, campaignSegmentOptionsResponse, "Etiquetas y fuentes existentes.")
  segmentOptions(@Param("organizationId") organizationId: string) {
    return this.campaignsService.segmentOptions(organizationId);
  }

  @Post("audience")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Cuántos contactos recibirían un segmento",
    description: "Solo cuentan los que aceptaron recibir correos de marketing y no se dieron de baja.",
  })
  @ApiZodBody(campaignSegmentSchema)
  @ApiZodResponse(200, campaignAudienceResponse, "Tamaño de la audiencia.")
  audience(@Param("organizationId") organizationId: string, @Body(new ZodValidationPipe(campaignSegmentSchema)) body: CampaignSegment) {
    return this.campaignsService.audience(organizationId, body);
  }

  @Get(":campaignId")
  @ApiOperation({ summary: "Leer una campaña" })
  @ApiUuidParam("campaignId", "Campaña a leer.")
  @ApiZodResponse(200, campaignResponse, "La campaña y sus métricas.")
  @ApiResponse({ status: 404, description: CAMPAIGN_NOT_FOUND })
  get(@Param("organizationId") organizationId: string, @Param("campaignId") campaignId: string) {
    return this.campaignsService.get(organizationId, campaignId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CAMPAIGN_MANAGE)
  @ApiOperation({ summary: "Crear una campaña en borrador", description: "Requiere `campaign.manage`. El cuerpo se sanea en el servidor." })
  @ApiZodBody(campaignSchema)
  @ApiZodResponse(201, campaignResponse, "Campaña creada.")
  create(@Param("organizationId") organizationId: string, @CurrentUser() user: User, @Body(new ZodValidationPipe(campaignSchema)) body: CampaignInput) {
    return this.campaignsService.create(organizationId, user.id, body);
  }

  @Patch(":campaignId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CAMPAIGN_MANAGE)
  @ApiOperation({ summary: "Editar una campaña en borrador", description: "Requiere `campaign.manage`." })
  @ApiUuidParam("campaignId", "Campaña a editar.")
  @ApiZodBody(updateCampaignSchema)
  @ApiZodResponse(200, campaignResponse, "Campaña actualizada.")
  @ApiResponse({ status: 404, description: CAMPAIGN_NOT_FOUND })
  @ApiResponse({ status: 409, description: CAMPAIGN_NOT_DRAFT })
  update(
    @Param("organizationId") organizationId: string,
    @Param("campaignId") campaignId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateCampaignSchema)) body: UpdateCampaignInput,
  ) {
    return this.campaignsService.update(organizationId, user.id, campaignId, body);
  }

  @Delete(":campaignId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CAMPAIGN_MANAGE)
  @ApiOperation({ summary: "Borrar una campaña en borrador", description: "Requiere `campaign.manage`. Las enviadas quedan como registro." })
  @ApiUuidParam("campaignId", "Campaña a borrar.")
  @ApiResponse({ status: 204, description: "Campaña borrada." })
  @ApiResponse({ status: 404, description: CAMPAIGN_NOT_FOUND })
  @ApiResponse({ status: 409, description: "No está en borrador." })
  async remove(@Param("organizationId") organizationId: string, @Param("campaignId") campaignId: string, @CurrentUser() user: User) {
    await this.campaignsService.remove(organizationId, user.id, campaignId);
  }

  @Post(":campaignId/test")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.CAMPAIGN_MANAGE)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "campaign-test" })
  @ApiOperation({ summary: "Enviarme una prueba", description: "Requiere `campaign.manage`. Llega al correo de quien la pide, marcada como prueba en el asunto." })
  @ApiUuidParam("campaignId", "Campaña a probar.")
  @ApiResponse({ status: 204, description: "Prueba enviada." })
  @ApiResponse({ status: 404, description: CAMPAIGN_NOT_FOUND })
  @ApiResponse({ status: 429, description: "Límite de pruebas superado (10 cada 10 minutos)." })
  async sendTest(@Param("organizationId") organizationId: string, @Param("campaignId") campaignId: string, @CurrentUser() user: User) {
    await this.campaignsService.sendTest(organizationId, { id: user.id, email: user.email }, campaignId);
  }

  @Post(":campaignId/send")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CAMPAIGN_MANAGE)
  @ApiOperation({
    summary: "Enviar la campaña",
    description:
      "Requiere `campaign.manage`. Congela los destinatarios del segmento (solo con consentimiento de marketing y sin baja) y la despacha el worker al ritmo del plan. Una campaña a la vez por organización.",
  })
  @ApiUuidParam("campaignId", "Campaña a enviar.")
  @ApiZodResponse(200, campaignResponse, "Campaña en envío.")
  @ApiResponse({ status: 404, description: CAMPAIGN_NOT_FOUND })
  @ApiResponse({ status: 409, description: `${CAMPAIGN_NOT_DRAFT} O: ${ANOTHER_SENDING}` })
  @ApiResponse({ status: 422, description: NO_AUDIENCE })
  @ApiResponse({ status: 503, description: LINKS_NOT_CONFIGURED })
  send(@Param("organizationId") organizationId: string, @Param("campaignId") campaignId: string, @CurrentUser() user: User) {
    return this.campaignsService.send(organizationId, user.id, campaignId);
  }

  @Post(":campaignId/cancel")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CAMPAIGN_MANAGE)
  @ApiOperation({ summary: "Detener un envío en curso", description: "Requiere `campaign.manage`. Lo que no salió, no sale." })
  @ApiUuidParam("campaignId", "Campaña a detener.")
  @ApiZodResponse(200, campaignResponse, "Envío detenido.")
  @ApiResponse({ status: 404, description: CAMPAIGN_NOT_FOUND })
  @ApiResponse({ status: 409, description: "No se está enviando." })
  cancel(@Param("organizationId") organizationId: string, @Param("campaignId") campaignId: string, @CurrentUser() user: User) {
    return this.campaignsService.cancel(organizationId, user.id, campaignId);
  }
}
