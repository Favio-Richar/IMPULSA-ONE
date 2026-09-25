import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { supportTicketDetailResponse, supportTicketSummaryResponse } from "@impulza/contracts";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiRateLimited,
  ApiUuidParam,
  ApiZodArrayResponse,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { uuidParamSchema } from "../admin/dto/admin-queries.dto.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { AllowWhenOrganizationBlocked } from "../organizations/allow-when-blocked.decorator.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import type { RequestWithMembership } from "../organizations/request-with-membership.js";
import { createSupportTicketSchema, supportMessageSchema, type CreateSupportTicketDto, type SupportMessageDto } from "./dto/support.dto.js";
import { SupportService } from "./support.service.js";

/**
 * Soporte desde el panel (F4.5). Cualquier miembro activo abre una solicitud; ver todas las de la
 * organización exige `support.view_all` (propietario y administrador). Funciona también con la
 * organización bloqueada: pedir ayuda es el camino para resolver un bloqueo (ADR-005 §6).
 */
@ApiTags("support")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/support-tickets")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get()
  @ApiOperation({
    summary: "Listar solicitudes de soporte",
    description: "Con `support.view_all`, todas las de la organización; si no, solo las propias. De la más reciente a la más antigua.",
  })
  @ApiZodArrayResponse(200, supportTicketSummaryResponse, "Solicitudes visibles para quien consulta.")
  list(@Param("organizationId") organizationId: string, @Req() req: RequestWithMembership) {
    return this.supportService.listForOrganization(organizationId, req.user, req.membership);
  }

  @Post()
  @AllowWhenOrganizationBlocked()
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 3600, keyPrefix: "support-open" })
  @ApiOperation({
    summary: "Abrir una solicitud de soporte",
    description: "Asunto y detalle en texto plano, sin adjuntos. Avisa por correo a quien la abre y al equipo (sin copiar el detalle).",
  })
  @ApiZodBody(createSupportTicketSchema)
  @ApiZodResponse(201, supportTicketDetailResponse, "La solicitud creada, con su primer mensaje.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiRateLimited(10, 3600)
  open(
    @Param("organizationId") organizationId: string,
    @Req() req: RequestWithMembership,
    @Body(new ZodValidationPipe(createSupportTicketSchema)) body: CreateSupportTicketDto,
  ) {
    return this.supportService.open(organizationId, req.user, body.subject, body.body);
  }

  @Get(":ticketId")
  @ApiOperation({ summary: "Ver una solicitud y su conversación" })
  @ApiUuidParam("ticketId", "Solicitud a leer.")
  @ApiZodResponse(200, supportTicketDetailResponse, "La solicitud con todos sus mensajes.")
  @ApiResponse({ status: 404, description: "No existe o no es visible para quien consulta." })
  get(
    @Param("organizationId") organizationId: string,
    @Param("ticketId", new ZodValidationPipe(uuidParamSchema)) ticketId: string,
    @Req() req: RequestWithMembership,
  ) {
    return this.supportService.getForOrganization(organizationId, req.user, req.membership, ticketId);
  }

  @Post(":ticketId/messages")
  @AllowWhenOrganizationBlocked()
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 30, windowSeconds: 3600, keyPrefix: "support-reply" })
  @ApiOperation({ summary: "Responder en una solicitud", description: "La solicitud vuelve a quedar esperando respuesta del equipo." })
  @ApiUuidParam("ticketId", "Solicitud a responder.")
  @ApiZodBody(supportMessageSchema)
  @ApiZodResponse(201, supportTicketDetailResponse, "La solicitud con el mensaje agregado.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: "No existe o no es visible para quien consulta." })
  @ApiResponse({ status: 409, description: "La solicitud está cerrada." })
  @ApiRateLimited(30, 3600)
  reply(
    @Param("organizationId") organizationId: string,
    @Param("ticketId", new ZodValidationPipe(uuidParamSchema)) ticketId: string,
    @Req() req: RequestWithMembership,
    @Body(new ZodValidationPipe(supportMessageSchema)) body: SupportMessageDto,
  ) {
    return this.supportService.replyAsCustomer(organizationId, req.user, req.membership, ticketId, body.body);
  }
}
