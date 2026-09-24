import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { contactDetailResponse, contactResponse } from "@impulza/contracts";
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
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import {
  createContactNoteSchema,
  createContactSchema,
  listContactsQuerySchema,
  updateContactSchema,
  type CreateContactDto,
  type CreateContactNoteDto,
  type ListContactsQueryDto,
  type UpdateContactDto,
} from "./dto/contact.dto.js";
import { ContactsService } from "./contacts.service.js";

const CONTACT_NOT_FOUND = "Contacto no encontrado: no existe, o pertenece a otra organización (ADR-002).";

@ApiTags("contacts")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/contacts")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  // Leer no exige permiso: basta con ser miembro activo (mismo criterio que sitios/formularios).
  @Get()
  @ApiOperation({
    summary: "Listar contactos de la organización",
    description: "Filtros opcionales por etiqueta, estado comercial, estado de consentimiento y búsqueda libre (nombre/correo/teléfono).",
  })
  @ApiQuery({ name: "tag", required: false })
  @ApiQuery({ name: "commercialStatus", required: false, enum: ["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"] })
  @ApiQuery({ name: "consentStatus", required: false, enum: ["GRANTED", "WITHDRAWN", "UNKNOWN"] })
  @ApiQuery({ name: "search", required: false })
  @ApiQuery({ name: "retentionReview", required: false, enum: ["pending"], description: "Solo los marcados para revisión de retención (ADR-004)." })
  @ApiZodArrayResponse(200, contactResponse, "Contactos de la organización, del más reciente al más antiguo.")
  async list(
    @Param("organizationId") organizationId: string,
    @Query(new ZodValidationPipe(listContactsQuerySchema)) query: ListContactsQueryDto,
  ) {
    return this.contactsService.listContacts(organizationId, query);
  }

  @Get(":contactId")
  @ApiOperation({ summary: "Ver la ficha de un contacto", description: "Incluye su línea de tiempo completa (`ContactEvent`)." })
  @ApiUuidParam("contactId", "Contacto a leer.")
  @ApiZodResponse(200, contactDetailResponse, "La ficha del contacto, con su línea de tiempo.")
  @ApiResponse({ status: 404, description: CONTACT_NOT_FOUND })
  async getOne(@Param("organizationId") organizationId: string, @Param("contactId") contactId: string) {
    return this.contactsService.getContact(organizationId, contactId);
  }

  @Get(":contactId/export")
  @ApiOperation({
    summary: "Exportar los datos de un contacto",
    description: "Portabilidad ARCO+ (ADR-004 punto 5): todos los datos propios del contacto, incluida su línea de tiempo, en un formato legible. Queda auditado como acceso sensible.",
  })
  @ApiUuidParam("contactId", "Contacto a exportar.")
  @ApiZodResponse(200, contactDetailResponse, "Los datos completos del contacto.")
  @ApiResponse({ status: 404, description: CONTACT_NOT_FOUND })
  async export(
    @Param("organizationId") organizationId: string,
    @Param("contactId") contactId: string,
    @CurrentUser() user: User,
  ) {
    return this.contactsService.exportContact(organizationId, user.id, contactId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CONTACT_MANAGE)
  @ApiOperation({
    summary: "Crear un contacto manualmente",
    description: "Requiere `contact.manage`. Alta manual sin paso por un formulario público: el consentimiento queda `UNKNOWN` (ADR-004) hasta que se declare explícitamente otro.",
  })
  @ApiZodBody(createContactSchema)
  @ApiZodResponse(201, contactResponse, "Contacto creado.")
  async create(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createContactSchema)) body: CreateContactDto,
  ) {
    return this.contactsService.createContact(organizationId, user.id, body);
  }

  @Patch(":contactId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CONTACT_MANAGE)
  @ApiOperation({
    summary: "Editar un contacto",
    description: "Requiere `contact.manage`. Etiquetas, estado comercial, asignación y datos de contacto.",
  })
  @ApiUuidParam("contactId", "Contacto a editar.")
  @ApiZodBody(updateContactSchema)
  @ApiZodResponse(200, contactDetailResponse, "Contacto actualizado, con su línea de tiempo.")
  @ApiResponse({ status: 404, description: CONTACT_NOT_FOUND })
  async update(
    @Param("organizationId") organizationId: string,
    @Param("contactId") contactId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateContactSchema)) body: UpdateContactDto,
  ) {
    return this.contactsService.updateContact(organizationId, user.id, contactId, body);
  }

  @Post(":contactId/notes")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CONTACT_MANAGE)
  @ApiOperation({ summary: "Agregar una nota al contacto", description: "Requiere `contact.manage`. Queda en la línea de tiempo como `ContactEvent` tipo `NOTE`." })
  @ApiUuidParam("contactId", "Contacto donde se agrega la nota.")
  @ApiZodBody(createContactNoteSchema)
  @ApiZodResponse(201, contactDetailResponse, "Contacto con la nota agregada.")
  @ApiResponse({ status: 404, description: CONTACT_NOT_FOUND })
  async addNote(
    @Param("organizationId") organizationId: string,
    @Param("contactId") contactId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createContactNoteSchema)) body: CreateContactNoteDto,
  ) {
    return this.contactsService.addNote(organizationId, user.id, contactId, body);
  }

  @Post(":contactId/retention-review/keep")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CONTACT_MANAGE)
  @ApiOperation({
    summary: "Conservar un contacto marcado para revisión de retención",
    description:
      "Requiere `contact.manage`. Quita la marca que pone el job diario tras 36 meses sin interacción (ADR-004 punto 4) y cuenta como interacción. Auditado. Para no conservarlo, se usa el borrado de siempre.",
  })
  @ApiUuidParam("contactId", "Contacto a conservar.")
  @ApiZodResponse(200, contactDetailResponse, "Contacto sin la marca de revisión.")
  @ApiResponse({ status: 404, description: CONTACT_NOT_FOUND })
  async keepAfterRetentionReview(
    @Param("organizationId") organizationId: string,
    @Param("contactId") contactId: string,
    @CurrentUser() user: User,
  ) {
    return this.contactsService.keepAfterRetentionReview(organizationId, user.id, contactId);
  }

  @Delete(":contactId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CONTACT_DELETE)
  @ApiOperation({
    summary: "Borrar un contacto",
    description: "Requiere `contact.delete`. Borrado real en cascada (`ContactEvent`/`FormSubmission` vinculados) — es el mecanismo operable para un derecho de cancelación (ADR-004 punto 5), auditado con el actor real.",
  })
  @ApiUuidParam("contactId", "Contacto a borrar.")
  @ApiResponse({ status: 204, description: "Contacto borrado." })
  @ApiResponse({ status: 404, description: CONTACT_NOT_FOUND })
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("contactId") contactId: string,
    @CurrentUser() user: User,
  ) {
    await this.contactsService.deleteContact(organizationId, user.id, contactId);
  }
}
