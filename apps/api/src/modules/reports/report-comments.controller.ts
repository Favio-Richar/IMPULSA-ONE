import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { reportCommentResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { createReportCommentSchema, reportQuerySchema, type CreateReportCommentDto, type ReportQuery } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiRateLimited,
  ApiZodArrayResponse,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { ReportCommentsService } from "./report-comments.service.js";

/** Comentarios del informe de un periodo (F9.8d): la agencia anota y el cliente responde desde su portal. Permiso `report.comment`. */
@ApiTags("reports")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/reports/comments")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, PermissionGuard, RateLimitGuard)
export class ReportCommentsController {
  constructor(private readonly comments: ReportCommentsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.REPORT_COMMENT)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "report-comments-list" })
  @ApiOperation({ summary: "Comentarios del informe de un periodo", description: "Del más antiguo al más reciente. Requiere `report.comment`." })
  @ApiZodArrayResponse(200, reportCommentResponse, "El hilo del periodo `from`–`to`.")
  @ApiRateLimited(60, 60)
  list(@Param("organizationId") organizationId: string, @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery) {
    return this.comments.list(organizationId, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.REPORT_COMMENT)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "report-comments-create" })
  @ApiOperation({
    summary: "Comentar el informe de un periodo",
    description: "El periodo va en `from` y `to` (query). Texto plano de hasta 1000 caracteres; hasta 100 comentarios por periodo. Requiere `report.comment`.",
  })
  @ApiZodBody(createReportCommentSchema)
  @ApiZodResponse(201, reportCommentResponse, "Comentario creado.")
  @ApiRateLimited(30, 60)
  @ApiResponse({ status: 409, description: "El periodo alcanzó su máximo de comentarios (`COMMENT_LIMIT`)." })
  create(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery,
    @Body(new ZodValidationPipe(createReportCommentSchema)) body: CreateReportCommentDto,
  ) {
    return this.comments.add(organizationId, user.id, query, body);
  }
}
