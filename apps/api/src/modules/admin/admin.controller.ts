import { applyDecorators, Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  adminAuditListResponse,
  adminSupportTicketDetailResponse,
  adminSupportTicketListResponse,
  adminIdentityResponse,
  adminLoginResponse,
  adminOrganizationDetailResponse,
  adminOrganizationListResponse,
  adminOverviewResponse,
  adminUserListResponse,
  planResponse,
} from "@impulza/contracts";
import type { Request, Response } from "express";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import type { RequestWithUser } from "../../common/request-with-user.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ADMIN_SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiRateLimited,
  ApiUuidParam,
  ApiZodArrayResponse,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { AdminAuthService } from "./admin-auth.service.js";
import { clearAdminSessionCookie, setAdminSessionCookie } from "./admin-session-cookie.js";
import { AdminService } from "./admin.service.js";
import {
  blockOrganizationSchema,
  changeOrganizationPlanSchema,
  unblockOrganizationSchema,
  updatePlanSchema,
  type BlockOrganizationDto,
  type ChangeOrganizationPlanDto,
  type UnblockOrganizationDto,
  type UpdatePlanDto,
} from "./dto/admin-actions.dto.js";
import { adminLoginSchema, type AdminLoginDto } from "./dto/admin-login.dto.js";
import {
  listAdminAuditQuerySchema,
  listAdminOrganizationsQuerySchema,
  listAdminUsersQuerySchema,
  uuidParamSchema,
  type ListAdminAuditQueryDto,
  type ListAdminOrganizationsQueryDto,
  type ListAdminUsersQueryDto,
} from "./dto/admin-queries.dto.js";
import { AdminSessionGuard } from "./guards/admin-session.guard.js";
import {
  listAdminSupportTicketsQuerySchema,
  supportMessageSchema,
  type ListAdminSupportTicketsQueryDto,
  type SupportMessageDto,
} from "../support/dto/support.dto.js";
import { SupportService } from "../support/support.service.js";

/** Errores que puede devolver cualquier ruta protegida por `AdminSessionGuard`. */
function ApiAdminErrors(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    ApiResponse({ status: 401, description: "Sin sesión de administración válida (cookie `impulza_admin_session`)." }),
    ApiResponse({ status: 403, description: "Petición que modifica estado sin la cabecera anti-CSRF." }),
  );
}

/** Login y sesión de superadministración (ADR-005 §4). */
@ApiTags("admin")
@Controller("admin/auth")
@UseGuards(CsrfGuard)
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post("login")
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 5, windowSeconds: 300, keyPrefix: "admin-login" })
  @ApiOperation({
    summary: "Iniciar sesión de superadministración",
    description:
      "Correo, contraseña y código 2FA en la misma petición. Emite la cookie `impulza_admin_session` (`HttpOnly`, `SameSite=Strict`, `path=/api/v1/admin`, 8 h). El mensaje de error es el mismo para cualquier fallo, y un código incorrecto cuenta como intento fallido.",
  })
  @ApiZodBody(adminLoginSchema)
  @ApiZodResponse(201, adminLoginResponse, "Sesión de administración abierta; la cookie va en `Set-Cookie`.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 401, description: "Credenciales de administración inválidas." })
  @ApiResponse({ status: 403, description: "Cuenta bloqueada temporalmente por intentos fallidos, o falta la cabecera anti-CSRF." })
  @ApiRateLimited(5, 300)
  async login(
    @Body(new ZodValidationPipe(adminLoginSchema)) body: AdminLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { session, user } = await this.adminAuthService.login(body.email, body.password, body.code, {
      userAgent: req.get("user-agent") ?? undefined,
      ip: req.ip,
    });
    setAdminSessionCookie(res, session.id);
    return { admin: { id: user.id, email: user.email }, expiresAt: session.expiresAt.toISOString() };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth(ADMIN_SESSION_AUTH)
  @ApiOperation({ summary: "Cerrar la sesión de superadministración" })
  @ApiResponse({ status: 204, description: "Sesión cerrada y cookie borrada." })
  @ApiResponse({ status: 401, description: "Sin sesión de administración válida." })
  async logout(@Req() req: RequestWithUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.adminAuthService.logout(req.session);
    clearAdminSessionCookie(res);
  }

  @Get("me")
  @UseGuards(AdminSessionGuard)
  @ApiCookieAuth(ADMIN_SESSION_AUTH)
  @ApiOperation({ summary: "Superadministrador de la sesión actual" })
  @ApiZodResponse(200, adminIdentityResponse, "Identidad del superadministrador.")
  @ApiResponse({ status: 401, description: "Sin sesión de administración válida." })
  me(@Req() req: RequestWithUser) {
    return { id: req.user.id, email: req.user.email };
  }
}

/** Panel global de la plataforma (F4.4). Solo metadatos: nunca datos comerciales (ADR-005 §5). */
@ApiTags("admin")
@ApiCookieAuth(ADMIN_SESSION_AUTH)
@ApiAdminErrors()
@Controller("admin")
@UseGuards(CsrfGuard, AdminSessionGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("overview")
  @ApiOperation({ summary: "Resumen global", description: "Totales, altas de los últimos 30 días, distribución por plan efectivo y organizaciones recientes." })
  @ApiZodResponse(200, adminOverviewResponse, "Resumen de la plataforma.")
  overview() {
    return this.adminService.overview();
  }

  @Get("organizations")
  @ApiOperation({ summary: "Buscar organizaciones", description: "`search` busca por nombre, slug o correo de un miembro." })
  @ApiQuery({ name: "search", required: false })
  @ApiQuery({ name: "status", required: false, enum: ["ACTIVE", "BLOCKED"] })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiZodResponse(200, adminOrganizationListResponse, "Una página de organizaciones, de la más nueva a la más antigua.")
  @ApiResponse({ status: 400, description: "Parámetros inválidos (detalle en `issues`)." })
  listOrganizations(@Query(new ZodValidationPipe(listAdminOrganizationsQuerySchema)) query: ListAdminOrganizationsQueryDto) {
    return this.adminService.listOrganizations(query);
  }

  @Get("organizations/:organizationId")
  @ApiOperation({
    summary: "Detalle de una organización",
    description: "Plan efectivo, uso, miembros y sitios. **Queda auditado** (`admin.organization_viewed`): no hay acceso silencioso.",
  })
  @ApiUuidParam("organizationId", "Organización a ver.")
  @ApiZodResponse(200, adminOrganizationDetailResponse, "Detalle de la organización.")
  @ApiResponse({ status: 404, description: "Organización no encontrada." })
  getOrganization(@Req() req: RequestWithUser, @Param("organizationId", new ZodValidationPipe(uuidParamSchema)) organizationId: string) {
    return this.adminService.getOrganization(req.user.id, organizationId);
  }

  @Put("organizations/:organizationId/plan")
  @ApiOperation({
    summary: "Asignar un plan a mano",
    description: "`planId: null` quita la asignación. Si hay una suscripción vigente, sigue mandando ella (el plan efectivo se ve en la respuesta).",
  })
  @ApiUuidParam("organizationId", "Organización a modificar.")
  @ApiZodBody(changeOrganizationPlanSchema)
  @ApiZodResponse(200, adminOrganizationDetailResponse, "Detalle actualizado.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: "Organización o plan no encontrado." })
  changePlan(
    @Req() req: RequestWithUser,
    @Param("organizationId", new ZodValidationPipe(uuidParamSchema)) organizationId: string,
    @Body(new ZodValidationPipe(changeOrganizationPlanSchema)) body: ChangeOrganizationPlanDto,
  ) {
    return this.adminService.changeOrganizationPlan(req.user.id, organizationId, body.planId, body.reason);
  }

  @Post("organizations/:organizationId/block")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Bloquear una organización",
    description: "Sus superficies públicas responden 404 y su panel queda en solo lectura (`403 ORGANIZATION_BLOCKED` en toda escritura).",
  })
  @ApiUuidParam("organizationId", "Organización a bloquear.")
  @ApiZodBody(blockOrganizationSchema)
  @ApiZodResponse(200, adminOrganizationDetailResponse, "Detalle actualizado.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: "Organización no encontrada." })
  @ApiResponse({ status: 409, description: "Ya estaba bloqueada." })
  block(
    @Req() req: RequestWithUser,
    @Param("organizationId", new ZodValidationPipe(uuidParamSchema)) organizationId: string,
    @Body(new ZodValidationPipe(blockOrganizationSchema)) body: BlockOrganizationDto,
  ) {
    return this.adminService.blockOrganization(req.user.id, organizationId, body.reason);
  }

  @Post("organizations/:organizationId/unblock")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Restaurar una organización bloqueada" })
  @ApiUuidParam("organizationId", "Organización a restaurar.")
  @ApiZodBody(unblockOrganizationSchema)
  @ApiZodResponse(200, adminOrganizationDetailResponse, "Detalle actualizado.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: "Organización no encontrada." })
  @ApiResponse({ status: 409, description: "No estaba bloqueada." })
  unblock(
    @Req() req: RequestWithUser,
    @Param("organizationId", new ZodValidationPipe(uuidParamSchema)) organizationId: string,
    @Body(new ZodValidationPipe(unblockOrganizationSchema)) body: UnblockOrganizationDto,
  ) {
    return this.adminService.unblockOrganization(req.user.id, organizationId, body.reason);
  }

  @Get("users")
  @ApiOperation({ summary: "Buscar usuarios", description: "`search` busca por correo." })
  @ApiQuery({ name: "search", required: false })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiZodResponse(200, adminUserListResponse, "Una página de usuarios, del más nuevo al más antiguo.")
  @ApiResponse({ status: 400, description: "Parámetros inválidos (detalle en `issues`)." })
  listUsers(@Query(new ZodValidationPipe(listAdminUsersQuerySchema)) query: ListAdminUsersQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Get("plans")
  @ApiOperation({ summary: "Catálogo de planes (editable)" })
  @ApiZodArrayResponse(200, planResponse, "Planes en orden de comparador.")
  listPlans() {
    return this.adminService.listPlans();
  }

  @Patch("plans/:planId")
  @ApiOperation({
    summary: "Editar un plan del catálogo",
    description: "Nombre, precios, moneda y límites. Bajar un límite por debajo del uso actual solo impide crear más; no borra nada. Queda auditado con el antes y el después.",
  })
  @ApiUuidParam("planId", "Plan a editar.")
  @ApiZodBody(updatePlanSchema)
  @ApiZodResponse(200, planResponse, "Plan actualizado.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: "Plan no encontrado." })
  updatePlan(
    @Req() req: RequestWithUser,
    @Param("planId", new ZodValidationPipe(uuidParamSchema)) planId: string,
    @Body(new ZodValidationPipe(updatePlanSchema)) body: UpdatePlanDto,
  ) {
    return this.adminService.updatePlan(req.user.id, planId, body);
  }

  @Get("audit-logs")
  @ApiOperation({ summary: "Auditoría", description: "`scope=admin` (por defecto) muestra solo acciones de superadministración." })
  @ApiQuery({ name: "scope", required: false, enum: ["admin", "all"] })
  @ApiQuery({ name: "organizationId", required: false })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiZodResponse(200, adminAuditListResponse, "Una página de la auditoría, de lo más reciente a lo más antiguo.")
  @ApiResponse({ status: 400, description: "Parámetros inválidos (detalle en `issues`)." })
  listAudit(@Query(new ZodValidationPipe(listAdminAuditQuerySchema)) query: ListAdminAuditQueryDto) {
    return this.adminService.listAudit(query);
  }
}

/** Bandeja de soporte del equipo (F4.5). Responder y cerrar quedan auditados con el actor real. */
@ApiTags("admin")
@ApiCookieAuth(ADMIN_SESSION_AUTH)
@ApiAdminErrors()
@Controller("admin/support-tickets")
@UseGuards(CsrfGuard, AdminSessionGuard)
export class AdminSupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get()
  @ApiOperation({
    summary: "Bandeja de soporte",
    description: "Filtrable por estado y organización. Con `status=OPEN` ordena de la más antigua a la más nueva (se atiende por antigüedad).",
  })
  @ApiQuery({ name: "status", required: false, enum: ["OPEN", "ANSWERED", "CLOSED"] })
  @ApiQuery({ name: "organizationId", required: false })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiZodResponse(200, adminSupportTicketListResponse, "Una página de solicitudes y los conteos por estado.")
  @ApiResponse({ status: 400, description: "Parámetros inválidos (detalle en `issues`)." })
  list(@Query(new ZodValidationPipe(listAdminSupportTicketsQuerySchema)) query: ListAdminSupportTicketsQueryDto) {
    return this.supportService.listForStaff(query);
  }

  @Get(":ticketId")
  @ApiOperation({ summary: "Ver una solicitud y su conversación" })
  @ApiUuidParam("ticketId", "Solicitud a leer.")
  @ApiZodResponse(200, adminSupportTicketDetailResponse, "La solicitud con todos sus mensajes.")
  @ApiResponse({ status: 404, description: "Solicitud no encontrada." })
  get(@Param("ticketId", new ZodValidationPipe(uuidParamSchema)) ticketId: string) {
    return this.supportService.getForStaff(ticketId);
  }

  @Post(":ticketId/messages")
  @ApiOperation({ summary: "Responder al cliente", description: "Pasa la solicitud a `ANSWERED` y avisa por correo a quien la abrió." })
  @ApiUuidParam("ticketId", "Solicitud a responder.")
  @ApiZodBody(supportMessageSchema)
  @ApiZodResponse(201, adminSupportTicketDetailResponse, "La solicitud con la respuesta agregada.")
  @ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." })
  @ApiResponse({ status: 404, description: "Solicitud no encontrada." })
  @ApiResponse({ status: 409, description: "La solicitud está cerrada." })
  reply(
    @Req() req: RequestWithUser,
    @Param("ticketId", new ZodValidationPipe(uuidParamSchema)) ticketId: string,
    @Body(new ZodValidationPipe(supportMessageSchema)) body: SupportMessageDto,
  ) {
    return this.supportService.replyAsStaff(req.user.id, ticketId, body.body);
  }

  @Post(":ticketId/close")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cerrar una solicitud", description: "El cliente ya no puede responder en ella; si necesita algo más, abre una nueva." })
  @ApiUuidParam("ticketId", "Solicitud a cerrar.")
  @ApiZodResponse(200, adminSupportTicketDetailResponse, "La solicitud cerrada.")
  @ApiResponse({ status: 404, description: "Solicitud no encontrada." })
  @ApiResponse({ status: 409, description: "Ya estaba cerrada." })
  close(@Req() req: RequestWithUser, @Param("ticketId", new ZodValidationPipe(uuidParamSchema)) ticketId: string) {
    return this.supportService.closeAsStaff(req.user.id, ticketId);
  }
}
