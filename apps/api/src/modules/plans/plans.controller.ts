import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { organizationPlanResponse, planResponse } from "@impulza/contracts";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiZodArrayResponse,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PlansService } from "./plans.service.js";

/** Catálogo público de planes (F4.1): lo que necesita la página de precios y el comparador del
 *  panel. Sin sesión: los precios de un SaaS son públicos. */
@ApiTags("plans")
@Controller("plans")
export class PlansCatalogController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @ApiOperation({ summary: "Catálogo de planes, en orden de comparador" })
  @ApiZodArrayResponse(200, planResponse, "Planes con precio mensual/anual y límites.")
  async list() {
    return this.plansService.listCatalog();
  }
}

/** Plan efectivo y uso de una organización (F4.1). Lectura: basta membresía activa. */
@ApiTags("plans")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/plan")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class OrganizationPlanController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @ApiOperation({
    summary: "Plan efectivo y uso de la organización",
    description:
      "El plan lo decide el servidor: suscripción vigente → plan asignado por superadministración → Gratis. El uso es el conteo real contra cada límite.",
  })
  @ApiZodResponse(200, organizationPlanResponse, "Plan, de dónde sale, y uso actual.")
  async get(@Param("organizationId") organizationId: string) {
    return this.plansService.organizationPlan(organizationId);
  }
}
