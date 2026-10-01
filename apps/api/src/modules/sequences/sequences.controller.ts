import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { emailSequenceEnrollmentResponse, emailSequenceResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { createEmailSequenceSchema, updateEmailSequenceSchema, type CreateEmailSequenceInput, type UpdateEmailSequenceInput } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiRateLimited, ApiUuidParam, ApiZodArrayResponse, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { SequencesService } from "./sequences.service.js";

const NOT_FOUND = "Secuencia (o inscripción) no encontrada, o de otra organización (ADR-002).";

// Escribir exige `campaign.manage` (OWNER, ADMIN): una secuencia manda correos a nombre del negocio,
// igual que una campaña. Ver la lista y el registro: cualquier miembro activo.
@ApiTags("email-sequences")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/email-sequences")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class SequencesController {
  constructor(private readonly sequences: SequencesService) {}

  @Get()
  @ApiOperation({ summary: "Listar las secuencias de correo", description: "Con sus pasos e inscripciones en curso, completadas y detenidas (F7.5)." })
  @ApiZodArrayResponse(200, emailSequenceResponse, "Secuencias de la organización.")
  list(@Param("organizationId") organizationId: string) {
    return this.sequences.list(organizationId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CAMPAIGN_MANAGE)
  @ApiOperation({
    summary: "Crear una secuencia",
    description: "Disparador del catálogo de automatizaciones y hasta 10 correos con su espera. Solo llega a contactos con consentimiento de marketing (ADR-020).",
  })
  @ApiZodBody(createEmailSequenceSchema)
  @ApiZodResponse(201, emailSequenceResponse, "Secuencia creada y encendida.")
  @ApiResponse({ status: 422, description: "`SEQUENCE_LIMIT_REACHED`: ya hay 10 secuencias." })
  create(@Param("organizationId") organizationId: string, @CurrentUser() user: User, @Body(new ZodValidationPipe(createEmailSequenceSchema)) body: CreateEmailSequenceInput) {
    return this.sequences.create(organizationId, user.id, body);
  }

  @Patch(":sequenceId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CAMPAIGN_MANAGE)
  @ApiOperation({ summary: "Editar, encender o apagar una secuencia", description: "Los pasos se reemplazan completos; apagarla pausa sus inscripciones." })
  @ApiUuidParam("sequenceId", "Secuencia.")
  @ApiZodBody(updateEmailSequenceSchema)
  @ApiZodResponse(200, emailSequenceResponse, "Secuencia actualizada.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  update(
    @Param("organizationId") organizationId: string,
    @Param("sequenceId") sequenceId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateEmailSequenceSchema)) body: UpdateEmailSequenceInput,
  ) {
    return this.sequences.update(organizationId, user.id, sequenceId, body);
  }

  @Delete(":sequenceId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CAMPAIGN_MANAGE)
  @ApiOperation({ summary: "Borrar una secuencia", description: "También borra sus inscripciones y su registro de envíos." })
  @ApiUuidParam("sequenceId", "Secuencia.")
  @ApiResponse({ status: 204, description: "Borrada." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async remove(@Param("organizationId") organizationId: string, @Param("sequenceId") sequenceId: string, @CurrentUser() user: User): Promise<void> {
    await this.sequences.remove(organizationId, user.id, sequenceId);
  }

  @Get(":sequenceId/enrollments")
  @ApiOperation({ summary: "Registro de inscripciones", description: "Las últimas 50, con su avance y estado." })
  @ApiUuidParam("sequenceId", "Secuencia.")
  @ApiZodArrayResponse(200, emailSequenceEnrollmentResponse, "Inscripciones, de la más reciente a la más antigua.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  enrollments(@Param("organizationId") organizationId: string, @Param("sequenceId") sequenceId: string) {
    return this.sequences.enrollments(organizationId, sequenceId);
  }

  @Post(":sequenceId/enrollments/:enrollmentId/stop")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CAMPAIGN_MANAGE)
  @ApiOperation({ summary: "Detener una inscripción", description: "La persona no recibe más correos de esta secuencia." })
  @ApiUuidParam("sequenceId", "Secuencia.")
  @ApiUuidParam("enrollmentId", "Inscripción.")
  @ApiResponse({ status: 204, description: "Detenida." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 409, description: "La inscripción ya terminó." })
  async stop(@Param("organizationId") organizationId: string, @Param("sequenceId") sequenceId: string, @Param("enrollmentId") enrollmentId: string, @CurrentUser() user: User): Promise<void> {
    await this.sequences.stopEnrollment(organizationId, user.id, sequenceId, enrollmentId);
  }

  @Post(":sequenceId/steps/:position/test")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.CAMPAIGN_MANAGE)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "sequence-test" })
  @ApiOperation({ summary: "Enviarme un correo de prueba", description: "El paso indicado, marcado [Prueba], al correo de quien lo pide." })
  @ApiUuidParam("sequenceId", "Secuencia.")
  @ApiResponse({ status: 204, description: "Enviado." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiRateLimited(10, 600)
  async test(
    @Param("organizationId") organizationId: string,
    @Param("sequenceId") sequenceId: string,
    @Param("position", ParseIntPipe) position: number,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.sequences.sendTest(organizationId, { id: user.id, email: user.email }, sequenceId, position);
  }
}
