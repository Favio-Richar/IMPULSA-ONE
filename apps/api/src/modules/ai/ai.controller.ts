import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { aiStatusResponse } from "@impulza/contracts";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { AiService } from "./ai.service.js";

@ApiTags("ai")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/ai")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get("status")
  @ApiOperation({
    summary: "Estado del asistente de IA",
    description:
      "Qué tareas de IA están disponibles y cuánto queda de la cuota mensual del plan (F6.2). No expone proveedores ni modelos: son configuración de la plataforma.",
  })
  @ApiZodResponse(200, aiStatusResponse, "Tareas disponibles y cuota del mes.")
  async status(@Param("organizationId") organizationId: string) {
    return this.aiService.status(organizationId);
  }
}
