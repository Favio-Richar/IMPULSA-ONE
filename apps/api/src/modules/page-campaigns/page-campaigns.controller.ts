import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { pageCampaignReportResponse, pageCampaignResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  createPageCampaignSchema,
  updatePageCampaignSchema,
  type CreatePageCampaignInput,
  type UpdatePageCampaignInput,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiUuidParam,
  ApiZodArrayResponse,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { PageCampaignsService } from "./page-campaigns.service.js";

const NOT_FOUND = "Sitio o campaña no encontrados, o de otra organización (ADR-002).";
const CONFLICT =
  "`PAGE_CAMPAIGN_OVERLAP` (la página ya está en otra campaña en esas fechas), `HOME_TAKEOVER_OVERLAP` (otra campaña ya toma el inicio) o `PAGE_CAMPAIGN_CLOSED` (terminada o cancelada).";

// Modo campaña (F7.7, ADR-022). Leer, cualquier miembro; escribir, `site.update`: tomar el inicio
// cambia lo que ve todo visitante del sitio.
@ApiTags("page-campaigns")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/page-campaigns")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class PageCampaignsController {
  constructor(private readonly campaignsService: PageCampaignsService) {}

  @Get()
  @ApiOperation({ summary: "Listar las campañas del sitio", description: "De la más reciente a la más antigua, con su estado calculado ahora." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodArrayResponse(200, pageCampaignResponse, "Campañas del sitio.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async list(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.campaignsService.list(organizationId, siteId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({
    summary: "Crear una campaña",
    description:
      "Una página publicada del sitio (nunca el inicio) con una ventana de fechas. Fuera de la ventana la página no se sirve; con `replaceHome`, durante la ventana la raíz del sitio la muestra. Hasta 50 por sitio.",
  })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodBody(createPageCampaignSchema)
  @ApiZodResponse(201, pageCampaignResponse, "Campaña creada.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 409, description: CONFLICT })
  @ApiResponse({ status: 422, description: "`PAGE_CAMPAIGN_PAGE_INVALID`, `PAGE_CAMPAIGN_WINDOW_INVALID` o `PAGE_CAMPAIGN_LIMIT_REACHED`." })
  async create(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createPageCampaignSchema)) body: CreatePageCampaignInput,
  ) {
    return this.campaignsService.create(organizationId, user.id, siteId, body);
  }

  @Get(":campaignId")
  @ApiOperation({ summary: "Leer una campaña" })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("campaignId", "Campaña del sitio.")
  @ApiZodResponse(200, pageCampaignResponse, "La campaña.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async get(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string, @Param("campaignId") campaignId: string) {
    return this.campaignsService.get(organizationId, siteId, campaignId);
  }

  @Patch(":campaignId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Editar una campaña programada o activa", description: "Para terminarla antes, se cancela." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("campaignId", "Campaña del sitio.")
  @ApiZodBody(updatePageCampaignSchema)
  @ApiZodResponse(200, pageCampaignResponse, "Campaña actualizada.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 409, description: CONFLICT })
  @ApiResponse({ status: 422, description: "`PAGE_CAMPAIGN_PAGE_INVALID` o `PAGE_CAMPAIGN_WINDOW_INVALID`." })
  async update(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("campaignId") campaignId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updatePageCampaignSchema)) body: UpdatePageCampaignInput,
  ) {
    return this.campaignsService.update(organizationId, user.id, siteId, campaignId, body);
  }

  @Post(":campaignId/cancel")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Cancelar (terminar ahora) una campaña", description: "La página deja de ser temporal y la raíz vuelve al inicio al instante." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("campaignId", "Campaña del sitio.")
  @ApiZodResponse(200, pageCampaignResponse, "Campaña cancelada.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 409, description: "`PAGE_CAMPAIGN_CLOSED`: ya terminó o ya estaba cancelada." })
  async cancel(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("campaignId") campaignId: string,
    @CurrentUser() user: User,
  ) {
    return this.campaignsService.cancel(organizationId, user.id, siteId, campaignId);
  }

  @Delete(":campaignId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @ApiOperation({ summary: "Borrar una campaña", description: "La página vuelve a ser una página normal. Los eventos de analítica no se tocan." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("campaignId", "Campaña del sitio.")
  @ApiResponse({ status: 204, description: "Campaña borrada." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("campaignId") campaignId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.campaignsService.remove(organizationId, user.id, siteId, campaignId);
  }

  @Get(":campaignId/report")
  @ApiOperation({
    summary: "Reporte de la campaña",
    description: "Visitas del día (anónimas) a la página dentro de la ventana y, de ellas, interacción, contacto, reserva, pedido y pago, más el desglose por `utm_source`.",
  })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("campaignId", "Campaña del sitio.")
  @ApiZodResponse(200, pageCampaignReportResponse, "Totales de la campaña.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async report(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string, @Param("campaignId") campaignId: string) {
    return this.campaignsService.report(organizationId, siteId, campaignId);
  }
}
