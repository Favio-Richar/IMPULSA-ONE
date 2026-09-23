import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { qrCodeResponse } from "@impulza/contracts";
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
  createQrCodeSchema,
  updateQrCodeSchema,
  type CreateQrCodeDto,
  type UpdateQrCodeDto,
} from "./dto/qr-code.dto.js";
import { QrCodesService } from "./qr-codes.service.js";

const NOT_FOUND = "Código QR no encontrado: no existe, o pertenece a otra organización (ADR-002).";

@ApiTags("qr-codes")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/qr-codes")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class QrCodesController {
  constructor(private readonly qrCodesService: QrCodesService) {}

  @Get()
  @ApiOperation({ summary: "Listar los códigos QR de la organización" })
  @ApiZodArrayResponse(200, qrCodeResponse, "Códigos QR, del más reciente al más antiguo.")
  async list(@Param("organizationId") organizationId: string) {
    return this.qrCodesService.list(organizationId);
  }

  @Get(":qrCodeId")
  @ApiOperation({ summary: "Leer un código QR" })
  @ApiUuidParam("qrCodeId", "Código QR a leer.")
  @ApiZodResponse(200, qrCodeResponse, "El código QR solicitado.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async getOne(@Param("organizationId") organizationId: string, @Param("qrCodeId") qrCodeId: string) {
    return this.qrCodesService.get(organizationId, qrCodeId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SHORTLINK_MANAGE)
  @ApiOperation({
    summary: "Crear un código QR",
    description:
      "Requiere `shortlink.manage`. Apunta a un enlace corto propio o a una URL directa. El estilo se elige de un catálogo cerrado con el contraste ya verificado para escanear de forma confiable (F3.5) — nunca un color libre.",
  })
  @ApiZodBody(createQrCodeSchema)
  @ApiZodResponse(201, qrCodeResponse, "Código QR creado.")
  @ApiResponse({ status: 404, description: "El enlace corto indicado no existe, o es de otra organización." })
  async create(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createQrCodeSchema)) body: CreateQrCodeDto,
  ) {
    return this.qrCodesService.create(organizationId, user.id, body);
  }

  @Patch(":qrCodeId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SHORTLINK_MANAGE)
  @ApiOperation({ summary: "Editar el estilo de un código QR", description: "Requiere `shortlink.manage`." })
  @ApiUuidParam("qrCodeId", "Código QR a editar.")
  @ApiZodBody(updateQrCodeSchema)
  @ApiZodResponse(200, qrCodeResponse, "Código QR actualizado.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async update(
    @Param("organizationId") organizationId: string,
    @Param("qrCodeId") qrCodeId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateQrCodeSchema)) body: UpdateQrCodeDto,
  ) {
    return this.qrCodesService.update(organizationId, user.id, qrCodeId, body);
  }

  @Delete(":qrCodeId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.SHORTLINK_MANAGE)
  @ApiOperation({ summary: "Borrar un código QR", description: "Requiere `shortlink.manage`." })
  @ApiUuidParam("qrCodeId", "Código QR a borrar.")
  @ApiResponse({ status: 204, description: "Código QR borrado." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("qrCodeId") qrCodeId: string,
    @CurrentUser() user: User,
  ) {
    await this.qrCodesService.delete(organizationId, user.id, qrCodeId);
  }
}
