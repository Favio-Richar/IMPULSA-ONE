import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { couponResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { createCouponSchema, updateCouponSchema, type CreateCouponInput, type UpdateCouponInput } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiUuidParam, ApiZodArrayResponse, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { COUPON_BELOW_USES, COUPON_CODE_TAKEN, COUPON_LIMIT, COUPON_NOT_FOUND, CouponsService } from "./coupons.service.js";

/** Cupones de descuento de un sitio (F7.8b, ADR-023). Leer: cualquier miembro; escribir: `catalog.manage`. */
@ApiTags("coupons")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/coupons")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get()
  @ApiOperation({ summary: "Listar los cupones del sitio", description: "Con su estado, usos y descuento entregado en pedidos no cancelados." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodArrayResponse(200, couponResponse, "Cupones, del más nuevo al más antiguo.")
  list(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.couponsService.list(organizationId, siteId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: "Crear un cupón",
    description: "Requiere `catalog.manage`. Porcentaje (1–100) o monto fijo con moneda; mínimo de compra, ventana y tope de usos opcionales. El código se guarda en mayúsculas.",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodBody(createCouponSchema)
  @ApiZodResponse(201, couponResponse, "Cupón creado.")
  @ApiResponse({ status: 409, description: COUPON_CODE_TAKEN })
  @ApiResponse({ status: 422, description: COUPON_LIMIT })
  create(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createCouponSchema)) body: CreateCouponInput,
  ) {
    return this.couponsService.create(organizationId, user.id, siteId, body);
  }

  @Patch(":couponId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Editar un cupón", description: "Requiere `catalog.manage`. Se combinan los cambios con lo guardado y se revalidan las reglas; `null` quita un opcional." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("couponId", "Cupón a editar.")
  @ApiZodBody(updateCouponSchema)
  @ApiZodResponse(200, couponResponse, "Cupón actualizado.")
  @ApiResponse({ status: 404, description: COUPON_NOT_FOUND })
  @ApiResponse({ status: 409, description: COUPON_CODE_TAKEN })
  @ApiResponse({ status: 422, description: `Reglas incoherentes (detalle en \`issues\`), o: ${COUPON_BELOW_USES}` })
  update(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("couponId") couponId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateCouponSchema)) body: UpdateCouponInput,
  ) {
    return this.couponsService.update(organizationId, user.id, siteId, couponId, body);
  }

  @Delete(":couponId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Borrar un cupón", description: "Requiere `catalog.manage`. Los pedidos que lo usaron conservan su código y su descuento." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("couponId", "Cupón a borrar.")
  @ApiResponse({ status: 204, description: "Cupón borrado." })
  @ApiResponse({ status: 404, description: COUPON_NOT_FOUND })
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("couponId") couponId: string,
    @CurrentUser() user: User,
  ) {
    await this.couponsService.remove(organizationId, user.id, siteId, couponId);
  }
}
