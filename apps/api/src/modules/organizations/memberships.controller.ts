import { Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import type { User } from "@impulza/database";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { OrganizationsService } from "./organizations.service.js";

// Fuera de /organizations/:organizationId a propósito: quien acepta todavía no tiene membresía
// ACTIVA (está en estado INVITED), así que no puede pasar OrganizationMembershipGuard — solo
// necesita estar autenticado y ser el destinatario real de la invitación.
@Controller("memberships")
@UseGuards(CsrfGuard, SessionAuthGuard)
export class MembershipsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post(":membershipId/accept")
  @HttpCode(HttpStatus.NO_CONTENT)
  async accept(@CurrentUser() user: User, @Param("membershipId") membershipId: string): Promise<void> {
    await this.organizationsService.acceptInvitation(user.id, membershipId);
  }
}
