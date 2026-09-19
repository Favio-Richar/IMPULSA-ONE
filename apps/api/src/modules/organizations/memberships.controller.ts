import { Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { User } from "@impulza/database";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiSessionScopedErrors, ApiUuidParam } from "../../openapi/zod-openapi.js";
import { OrganizationsService } from "./organizations.service.js";

// Fuera de /organizations/:organizationId a propósito: quien acepta todavía no tiene membresía
// ACTIVA (está en estado INVITED), así que no puede pasar OrganizationMembershipGuard — solo
// necesita estar autenticado y ser el destinatario real de la invitación.
@ApiTags("memberships")
@ApiCookieAuth(SESSION_AUTH)
@Controller("memberships")
@UseGuards(CsrfGuard, SessionAuthGuard)
export class MembershipsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post(":membershipId/accept")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Aceptar una invitación",
    description:
      "Pasa la membresía de `INVITED` a `ACTIVE`. Solo la puede aceptar la persona invitada: una invitación de otra cuenta responde 404, no 403, para no confirmar que existe.",
  })
  @ApiUuidParam("membershipId", "Invitación recibida, del enlace del correo.")
  @ApiResponse({ status: 204, description: "Invitación aceptada; la membresía queda activa." })
  @ApiResponse({ status: 404, description: "La invitación no existe o no te pertenece." })
  @ApiResponse({
    status: 409,
    description: "Esta invitación ya no está pendiente (ya se aceptó, o la membresía fue removida).",
  })
  @ApiSessionScopedErrors()
  async accept(@CurrentUser() user: User, @Param("membershipId") membershipId: string): Promise<void> {
    await this.organizationsService.acceptInvitation(user.id, membershipId);
  }
}
