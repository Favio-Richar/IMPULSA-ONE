import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  pagePublishStatusResponse,
  publishRequestCommentResponse,
  publishRequestCommentsResponse,
  publishRequestDetailResponse,
  publishRequestListResponse,
  publishRequestSummaryResponse,
  publishSettingsResponse,
} from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  approvePublishRequestSchema,
  createPublishCommentSchema,
  createPublishRequestSchema,
  publishRequestListQuerySchema,
  publishSettingsSchema,
  rejectPublishRequestSchema,
  type ApprovePublishRequestDto,
  type CreatePublishCommentDto,
  type CreatePublishRequestDto,
  type PublishRequestListQuery,
  type PublishSettingsDto,
  type RejectPublishRequestDto,
} from "@impulza/validation";
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
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import type { RequestWithMembership } from "../organizations/request-with-membership.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { PublishApprovalService } from "./publish-approval.service.js";

const NOT_FOUND = "La solicitud no existe, o es de otra organización (ADR-002).";
const NOT_PENDING = "La solicitud ya fue resuelta (código `NOT_PENDING`).";

/** Pedir la aprobación y ver el estado de publicación de una página concreta. */
@ApiTags("pages")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/pages")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class PagePublishRequestsController {
  constructor(private readonly approvals: PublishApprovalService) {}

  @Get(":pageId/publish-status")
  @ApiOperation({
    summary: "Estado de publicación de una página",
    description:
      "Si la organización exige aprobación, si quien consulta puede publicar directo, la solicitud pendiente, las aprobaciones que hoy sirven y la última resuelta (con el motivo de un rechazo). Basta ser miembro activo.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página a consultar.")
  @ApiZodResponse(200, pagePublishStatusResponse, "Estado de publicación.")
  @ApiResponse({ status: 404, description: "Página no encontrada, o de otra organización (ADR-002)." })
  status(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @Req() req: RequestWithMembership,
  ) {
    return this.approvals.status(organizationId, siteId, pageId, req.membership);
  }

  @Post(":pageId/publish-requests")
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "publish-request-create" })
  @ApiOperation({
    summary: "Pedir la aprobación para publicar",
    description:
      "Requiere `page.manage`. Guarda el contenido exacto que se pide publicar (`kind: PUBLISH`) o la versión a la que se quiere volver (`kind: RESTORE`, con `versionId`) y avisa a quienes pueden aprobar. Una sola pendiente por página: si hay otra con distinto contenido, la reemplaza. Solo aplica cuando la organización exige aprobación y quien pide no puede aprobar.",
  })
  @ApiUuidParam("siteId", "Sitio dueño de la página.")
  @ApiUuidParam("pageId", "Página a publicar.")
  @ApiZodBody(createPublishRequestSchema)
  @ApiZodResponse(201, publishRequestSummaryResponse, "Solicitud creada, pendiente.")
  @ApiRateLimited(30, 60)
  @ApiResponse({
    status: 409,
    description:
      "No hace falta (`APPROVAL_NOT_REQUIRED`, `CAN_PUBLISH_DIRECTLY`, `NOTHING_TO_PUBLISH`) o ya existe (`ALREADY_PENDING`, `ALREADY_APPROVED`, con `requestId`).",
  })
  @ApiResponse({ status: 404, description: "Página o versión no encontrada, o de otra organización (ADR-002)." })
  create(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("pageId") pageId: string,
    @CurrentUser() user: User,
    @Req() req: RequestWithMembership,
    @Body(new ZodValidationPipe(createPublishRequestSchema)) body: CreatePublishRequestDto,
  ) {
    return this.approvals.create(organizationId, user.id, req.membership, siteId, pageId, body);
  }
}

/** La cola y el historial de solicitudes de toda la organización, y su resolución. */
@ApiTags("pages")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/publish-requests")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class PublishRequestsController {
  constructor(private readonly approvals: PublishApprovalService) {}

  @Get()
  @ApiOperation({
    summary: "Solicitudes de publicación de la organización",
    description: "De la más reciente a la más antigua, con filtro por estado y por página y paginación en el servidor. Sin el contenido: el detalle está en `GET …/:requestId`. Basta ser miembro activo.",
  })
  @ApiQuery({ name: "status", required: false, enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] })
  @ApiQuery({ name: "pageId", required: false, type: String })
  @ApiQuery({ name: "limit", required: false, type: Number, description: "1 a 100 (25 por defecto)." })
  @ApiQuery({ name: "offset", required: false, type: Number })
  @ApiZodResponse(200, publishRequestListResponse, "Una página de solicitudes.")
  list(
    @Param("organizationId") organizationId: string,
    @Query(new ZodValidationPipe(publishRequestListQuerySchema)) query: PublishRequestListQuery,
  ) {
    return this.approvals.list(organizationId, query);
  }

  @Get(":requestId")
  @ApiOperation({
    summary: "Ver una solicitud con su contenido",
    description: "Incluye exactamente el contenido que se pidió publicar y si el contenido vivo de la página sigue siendo ese (`contentIsCurrent`).",
  })
  @ApiUuidParam("requestId", "Solicitud de esta organización.")
  @ApiZodResponse(200, publishRequestDetailResponse, "La solicitud, con su contenido.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  detail(@Param("organizationId") organizationId: string, @Param("requestId") requestId: string) {
    return this.approvals.detail(organizationId, requestId);
  }

  @Get(":requestId/comments")
  @ApiOperation({
    summary: "Comentarios de una solicitud",
    description: "Del más antiguo al más reciente. Basta ser miembro activo (también el visor del portal del cliente).",
  })
  @ApiUuidParam("requestId", "Solicitud de esta organización.")
  @ApiZodResponse(200, publishRequestCommentsResponse, "Comentarios de la solicitud.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  comments(@Param("organizationId") organizationId: string, @Param("requestId") requestId: string) {
    return this.approvals.listComments(organizationId, requestId);
  }

  @Post(":requestId/comments")
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.PUBLISH_COMMENT)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "publish-request-comment" })
  @ApiOperation({
    summary: "Comentar una solicitud",
    description: "Requiere `publish.comment` (quien pide, quien revisa y el visor del portal del cliente). Queda en la auditoría.",
  })
  @ApiUuidParam("requestId", "Solicitud de esta organización.")
  @ApiZodBody(createPublishCommentSchema)
  @ApiZodResponse(201, publishRequestCommentResponse, "Comentario creado.")
  @ApiRateLimited(60, 60)
  @ApiResponse({ status: 404, description: NOT_FOUND })
  comment(
    @Param("organizationId") organizationId: string,
    @Param("requestId") requestId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createPublishCommentSchema)) body: CreatePublishCommentDto,
  ) {
    return this.approvals.addComment(organizationId, user.id, requestId, body);
  }

  @Post(":requestId/approve")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.PUBLISH_APPROVE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "publish-request-review" })
  @ApiOperation({
    summary: "Aprobar una solicitud",
    description:
      "Requiere `publish.approve`. Nadie aprueba su propia solicitud (`SELF_REVIEW`). La aprobación vale para el contenido solicitado y se usa una sola vez; si la página cambia después, hay que pedir de nuevo.",
  })
  @ApiUuidParam("requestId", "Solicitud pendiente de esta organización.")
  @ApiZodBody(approvePublishRequestSchema)
  @ApiZodResponse(200, publishRequestSummaryResponse, "Solicitud aprobada.")
  @ApiRateLimited(60, 60)
  @ApiResponse({ status: 403, description: "Falta el permiso, o es la solicitud propia (`SELF_REVIEW`)." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 409, description: `${NOT_PENDING} O la página está en la papelera (\`PAGE_DELETED\`).` })
  approve(
    @Param("organizationId") organizationId: string,
    @Param("requestId") requestId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(approvePublishRequestSchema)) body: ApprovePublishRequestDto,
  ) {
    return this.approvals.approve(organizationId, user.id, requestId, body);
  }

  @Post(":requestId/reject")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.PUBLISH_APPROVE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "publish-request-review" })
  @ApiOperation({
    summary: "Rechazar una solicitud",
    description: "Requiere `publish.approve` y un motivo. Nadie rechaza su propia solicitud (`SELF_REVIEW`).",
  })
  @ApiUuidParam("requestId", "Solicitud pendiente de esta organización.")
  @ApiZodBody(rejectPublishRequestSchema)
  @ApiZodResponse(200, publishRequestSummaryResponse, "Solicitud rechazada.")
  @ApiRateLimited(60, 60)
  @ApiResponse({ status: 403, description: "Falta el permiso, o es la solicitud propia (`SELF_REVIEW`)." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 409, description: NOT_PENDING })
  reject(
    @Param("organizationId") organizationId: string,
    @Param("requestId") requestId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(rejectPublishRequestSchema)) body: RejectPublishRequestDto,
  ) {
    return this.approvals.reject(organizationId, user.id, requestId, body);
  }

  @Post(":requestId/cancel")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "publish-request-review" })
  @ApiOperation({
    summary: "Cancelar la propia solicitud",
    description: "Requiere `page.manage` y ser quien pidió la publicación (`NOT_REQUESTER`). Solo mientras esté pendiente.",
  })
  @ApiUuidParam("requestId", "Solicitud pendiente de esta organización.")
  @ApiZodResponse(200, publishRequestSummaryResponse, "Solicitud cancelada.")
  @ApiRateLimited(60, 60)
  @ApiResponse({ status: 403, description: "Falta el permiso, o la solicitud es de otra persona (`NOT_REQUESTER`)." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 409, description: NOT_PENDING })
  cancel(@Param("organizationId") organizationId: string, @Param("requestId") requestId: string, @CurrentUser() user: User) {
    return this.approvals.cancel(organizationId, user.id, requestId);
  }
}

/** La opción que activa la compuerta. Una agencia con acceso delegado no llega aquí (`AGENCY_LIMIT`): la decide el propietario. */
@ApiTags("organizations")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/publish-settings")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class PublishSettingsController {
  constructor(private readonly approvals: PublishApprovalService) {}

  @Get()
  @ApiOperation({
    summary: "Opción de aprobación antes de publicar",
    description: "Si está activa y si quien consulta puede cambiarla. Basta ser miembro activo; una agencia con acceso delegado no llega aquí (`AGENCY_LIMIT`).",
  })
  @ApiZodResponse(200, publishSettingsResponse, "Opción actual.")
  get(@Param("organizationId") organizationId: string, @Req() req: RequestWithMembership) {
    return this.approvals.getSettings(organizationId, req.membership);
  }

  @Put()
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.PUBLISH_CONFIGURE)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "publish-settings" })
  @ApiOperation({
    summary: "Activar o desactivar la aprobación antes de publicar",
    description:
      "Requiere `publish.configure` (el propietario). Al desactivarla, las solicitudes pendientes se cancelan: quien las pidió ya puede publicar directo. Queda en la auditoría.",
  })
  @ApiZodBody(publishSettingsSchema)
  @ApiZodResponse(200, publishSettingsResponse, "Opción actualizada.")
  @ApiRateLimited(20, 60)
  @ApiResponse({ status: 403, description: "Falta el permiso `publish.configure`." })
  update(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Req() req: RequestWithMembership,
    @Body(new ZodValidationPipe(publishSettingsSchema)) body: PublishSettingsDto,
  ) {
    return this.approvals.updateSettings(organizationId, user.id, req.membership, body.requireApproval);
  }
}
