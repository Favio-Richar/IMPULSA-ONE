import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { formResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
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
  ApiPlanLimited,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import {
  createFormFieldSchema,
  createFormSchema,
  updateFormFieldSchema,
  updateFormSchema,
  type CreateFormDto,
  type CreateFormFieldDto,
  type UpdateFormDto,
  type UpdateFormFieldDto,
} from "./dto/form.dto.js";
import { FormsService } from "./forms.service.js";

const FORM_NOT_FOUND = "Formulario no encontrado: no existe, o el sitio pertenece a otra organización (ADR-002).";
const FIELD_NOT_FOUND = "Campo no encontrado: no existe, o no pertenece a este formulario.";

@ApiTags("forms")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/forms")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  // Leer no exige permiso: basta con ser miembro activo (mismo criterio que sitios/páginas).
  @Get()
  @ApiOperation({ summary: "Listar los formularios del sitio" })
  @ApiUuidParam("siteId", "Sitio dueño de los formularios.")
  @ApiZodArrayResponse(200, formResponse, "Formularios del sitio, con sus campos.")
  @ApiResponse({ status: 404, description: "Sitio no encontrado, o de otra organización (ADR-002)." })
  async list(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.formsService.listForms(organizationId, siteId);
  }

  @Get(":formId")
  @ApiOperation({ summary: "Leer un formulario" })
  @ApiUuidParam("siteId", "Sitio dueño del formulario.")
  @ApiUuidParam("formId", "Formulario a leer.")
  @ApiZodResponse(200, formResponse, "El formulario solicitado, con sus campos.")
  @ApiResponse({ status: 404, description: FORM_NOT_FOUND })
  async getOne(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("formId") formId: string,
  ) {
    return this.formsService.getForm(organizationId, siteId, formId);
  }

  @Post()
  @ApiPlanLimited("forms")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.FORM_MANAGE)
  @ApiOperation({
    summary: "Crear un formulario",
    description:
      "Requiere `form.manage`. Acepta una lista opcional de campos iniciales, para que quede usable en una sola llamada.",
  })
  @ApiUuidParam("siteId", "Sitio donde se crea el formulario.")
  @ApiZodBody(createFormSchema)
  @ApiZodResponse(201, formResponse, "Formulario creado, con sus campos si se enviaron.")
  @ApiResponse({ status: 404, description: "Sitio no encontrado, o de otra organización (ADR-002)." })
  async create(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createFormSchema)) body: CreateFormDto,
  ) {
    return this.formsService.createForm(organizationId, user.id, siteId, body);
  }

  @Patch(":formId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.FORM_MANAGE)
  @ApiOperation({ summary: "Editar un formulario", description: "Requiere `form.manage`." })
  @ApiUuidParam("siteId", "Sitio dueño del formulario.")
  @ApiUuidParam("formId", "Formulario a editar.")
  @ApiZodBody(updateFormSchema)
  @ApiZodResponse(200, formResponse, "Formulario actualizado.")
  @ApiResponse({ status: 404, description: FORM_NOT_FOUND })
  async update(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("formId") formId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateFormSchema)) body: UpdateFormDto,
  ) {
    return this.formsService.updateForm(organizationId, user.id, siteId, formId, body);
  }

  @Delete(":formId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.FORM_MANAGE)
  @ApiOperation({
    summary: "Borrar un formulario",
    description:
      "Requiere `form.manage`. Borrado **real**, no lógico: se lleva también sus envíos recibidos (`FormSubmission`). Los `Contact` ya creados a partir de esos envíos no se tocan.",
  })
  @ApiUuidParam("siteId", "Sitio dueño del formulario.")
  @ApiUuidParam("formId", "Formulario a borrar.")
  @ApiResponse({ status: 204, description: "Formulario borrado." })
  @ApiResponse({ status: 404, description: FORM_NOT_FOUND })
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("formId") formId: string,
    @CurrentUser() user: User,
  ) {
    await this.formsService.deleteForm(organizationId, user.id, siteId, formId);
  }

  @Post(":formId/fields")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.FORM_MANAGE)
  @ApiOperation({
    summary: "Agregar un campo al formulario",
    description: "Requiere `form.manage`. Se agrega al final del orden.",
  })
  @ApiUuidParam("siteId", "Sitio dueño del formulario.")
  @ApiUuidParam("formId", "Formulario donde se agrega el campo.")
  @ApiZodBody(createFormFieldSchema)
  @ApiZodResponse(201, formResponse, "Formulario con el campo agregado.")
  @ApiResponse({ status: 404, description: FORM_NOT_FOUND })
  async addField(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("formId") formId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createFormFieldSchema)) body: CreateFormFieldDto,
  ) {
    return this.formsService.addField(organizationId, user.id, siteId, formId, body);
  }

  @Patch(":formId/fields/:fieldId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.FORM_MANAGE)
  @ApiOperation({ summary: "Editar un campo del formulario", description: "Requiere `form.manage`." })
  @ApiUuidParam("siteId", "Sitio dueño del formulario.")
  @ApiUuidParam("formId", "Formulario dueño del campo.")
  @ApiUuidParam("fieldId", "Campo a editar.")
  @ApiZodBody(updateFormFieldSchema)
  @ApiZodResponse(200, formResponse, "Formulario con el campo actualizado.")
  @ApiResponse({ status: 404, description: FIELD_NOT_FOUND })
  async updateField(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("formId") formId: string,
    @Param("fieldId") fieldId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateFormFieldSchema)) body: UpdateFormFieldDto,
  ) {
    return this.formsService.updateField(organizationId, user.id, siteId, formId, fieldId, body);
  }

  @Delete(":formId/fields/:fieldId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.FORM_MANAGE)
  @ApiOperation({ summary: "Borrar un campo del formulario", description: "Requiere `form.manage`." })
  @ApiUuidParam("siteId", "Sitio dueño del formulario.")
  @ApiUuidParam("formId", "Formulario dueño del campo.")
  @ApiUuidParam("fieldId", "Campo a borrar.")
  @ApiZodResponse(200, formResponse, "Formulario sin el campo, con el orden reajustado.")
  @ApiResponse({ status: 404, description: FIELD_NOT_FOUND })
  async removeField(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("formId") formId: string,
    @Param("fieldId") fieldId: string,
    @CurrentUser() user: User,
  ) {
    return this.formsService.deleteField(organizationId, user.id, siteId, formId, fieldId);
  }
}
