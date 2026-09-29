import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { automationListItemResponse, automationResponse, automationRunResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { createAutomationSchema, updateAutomationSchema, type CreateAutomationInput, type UpdateAutomationInput } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiUuidParam, ApiZodArrayResponse, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { AutomationsService } from "./automations.service.js";

const NOT_FOUND = "Automatización no encontrada, o de otra organización (ADR-002).";

// Las acciones tocan contactos (etiqueta, estado) o avisan al equipo: `contact.manage` para cambiar
// las reglas. Ver el listado y el registro de ejecuciones: cualquier miembro activo.
@ApiTags("automations")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/automations")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get()
  @ApiOperation({ summary: "Listar las automatizaciones", description: "Con las ejecuciones de los últimos 30 días y la última (F6.7)." })
  @ApiZodArrayResponse(200, automationListItemResponse, "Automatizaciones de la organización.")
  async list(@Param("organizationId") organizationId: string) {
    return this.automations.list(organizationId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CONTACT_MANAGE)
  @ApiOperation({
    summary: "Crear una automatización",
    description: "Disparador (contacto nuevo, reserva creada, pedido creado) → acción (etiquetar, cambiar estado comercial, avisar al equipo por correo), de un catálogo cerrado. La ejecuta el worker, una vez por evento.",
  })
  @ApiZodBody(createAutomationSchema)
  @ApiZodResponse(201, automationListItemResponse, "Automatización creada y encendida.")
  @ApiResponse({ status: 422, description: "`AUTOMATION_LIMIT_REACHED`: ya hay 20 automatizaciones." })
  async create(@Param("organizationId") organizationId: string, @CurrentUser() user: User, @Body(new ZodValidationPipe(createAutomationSchema)) body: CreateAutomationInput) {
    return this.automations.create(organizationId, user.id, body);
  }

  @Patch(":automationId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CONTACT_MANAGE)
  @ApiOperation({ summary: "Editar, encender o apagar una automatización" })
  @ApiUuidParam("automationId", "Automatización.")
  @ApiZodBody(updateAutomationSchema)
  @ApiZodResponse(200, automationResponse, "Automatización actualizada.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async update(
    @Param("organizationId") organizationId: string,
    @Param("automationId") automationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateAutomationSchema)) body: UpdateAutomationInput,
  ) {
    return this.automations.update(organizationId, user.id, automationId, body);
  }

  @Delete(":automationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CONTACT_MANAGE)
  @ApiOperation({ summary: "Borrar una automatización", description: "También borra su registro de ejecuciones." })
  @ApiUuidParam("automationId", "Automatización.")
  @ApiResponse({ status: 204, description: "Borrada." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async remove(@Param("organizationId") organizationId: string, @Param("automationId") automationId: string, @CurrentUser() user: User): Promise<void> {
    await this.automations.remove(organizationId, user.id, automationId);
  }

  @Get(":automationId/runs")
  @ApiOperation({ summary: "Registro de ejecuciones", description: "Las últimas 50: estado, intentos y motivo técnico si falló u omitió, sin datos del contacto." })
  @ApiUuidParam("automationId", "Automatización.")
  @ApiZodArrayResponse(200, automationRunResponse, "Ejecuciones, de la más reciente a la más antigua.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async runs(@Param("organizationId") organizationId: string, @Param("automationId") automationId: string) {
    return this.automations.runs(organizationId, automationId);
  }
}
