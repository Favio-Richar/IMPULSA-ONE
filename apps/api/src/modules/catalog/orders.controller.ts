import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { orderListResponse, orderResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  listOrdersQuerySchema,
  ORDER_STATUSES,
  updateOrderStatusSchema,
  type ListOrdersQuery,
  type UpdateOrderStatusInput,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiUuidParam, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { ORDER_CHANGED, ORDER_NO_STOCK, ORDER_NOT_FOUND, OrdersService } from "./orders.service.js";

@ApiTags("orders")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/orders")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: "Listar pedidos", description: "Cualquier miembro activo los ve. Del más nuevo al más antiguo, de a 50; con conteo por estado." })
  @ApiQuery({ name: "siteId", required: false, type: String })
  @ApiQuery({ name: "status", required: false, enum: ORDER_STATUSES })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiZodResponse(200, orderListResponse, "Página de pedidos.")
  @ApiResponse({ status: 400, description: "Parámetros inválidos (detalle en `issues`)." })
  list(@Param("organizationId") organizationId: string, @Query(new ZodValidationPipe(listOrdersQuerySchema)) query: ListOrdersQuery) {
    return this.ordersService.list(organizationId, query);
  }

  @Get(":orderId")
  @ApiOperation({ summary: "Leer un pedido" })
  @ApiUuidParam("orderId", "Pedido a leer.")
  @ApiZodResponse(200, orderResponse, "El pedido.")
  @ApiResponse({ status: 404, description: ORDER_NOT_FOUND })
  get(@Param("organizationId") organizationId: string, @Param("orderId") orderId: string) {
    return this.ordersService.get(organizationId, orderId);
  }

  @Patch(":orderId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.ORDER_MANAGE)
  @ApiOperation({
    summary: "Cambiar el estado de un pedido",
    description: "Requiere `order.manage`. Pagado se marca a mano (Impulza no cobra). Cancelar devuelve el stock reservado; un entregado no se reabre.",
  })
  @ApiUuidParam("orderId", "Pedido a cambiar.")
  @ApiZodBody(updateOrderStatusSchema)
  @ApiZodResponse(200, orderResponse, "Pedido actualizado.")
  @ApiResponse({ status: 404, description: ORDER_NOT_FOUND })
  @ApiResponse({ status: 409, description: `${ORDER_CHANGED} O: ${ORDER_NO_STOCK}` })
  @ApiResponse({ status: 422, description: "Transición de estado no permitida." })
  updateStatus(
    @Param("organizationId") organizationId: string,
    @Param("orderId") orderId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateOrderStatusSchema)) body: UpdateOrderStatusInput,
  ) {
    return this.ordersService.updateStatus(organizationId, user.id, orderId, body);
  }
}
