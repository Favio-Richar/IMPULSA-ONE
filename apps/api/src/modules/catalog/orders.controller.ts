import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { orderListResponse, orderResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  listOrdersQuerySchema,
  ORDER_STATUSES,
  refundRequestSchema,
  updateOrderStatusSchema,
  type ListOrdersQuery,
  type RefundRequest,
  type UpdateOrderStatusInput,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiRateLimited, ApiUuidParam, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { REFUND_IN_PROGRESS, REFUND_UNAVAILABLE } from "../payment-accounts/checkout-refunds.service.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { NOTHING_TO_REFUND, ONLINE_PAYMENT_UNDO, ORDER_CHANGED, ORDER_NO_STOCK, ORDER_NOT_FOUND, OrdersService, REFUND_TOO_HIGH } from "./orders.service.js";

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
  @ApiResponse({ status: 422, description: `Transición de estado no permitida. O: ${ONLINE_PAYMENT_UNDO}` })
  updateStatus(
    @Param("organizationId") organizationId: string,
    @Param("orderId") orderId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateOrderStatusSchema)) body: UpdateOrderStatusInput,
  ) {
    return this.ordersService.updateStatus(organizationId, user.id, orderId, body);
  }

  @Post(":orderId/refund")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.PAYMENTS_REFUND)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "order-refund" })
  @ApiOperation({
    summary: "Devolver el pago de un pedido",
    description:
      "Requiere `payments.refund` (solo el dueño). Total (sin `amount`) o parcial, con el token de la cuenta de Mercado Pago del negocio y clave de idempotencia; lo devuelto se lee de Mercado Pago. Avisa al comprador y queda auditado (F5.11a).",
  })
  @ApiUuidParam("orderId", "Pedido a devolver.")
  @ApiZodBody(refundRequestSchema)
  @ApiZodResponse(200, orderResponse, "Pedido con lo devuelto.")
  @ApiResponse({ status: 404, description: ORDER_NOT_FOUND })
  @ApiResponse({ status: 409, description: REFUND_IN_PROGRESS })
  @ApiResponse({ status: 422, description: `${NOTHING_TO_REFUND} O: ${REFUND_TOO_HIGH} O: \`PAYMENTS_UNAVAILABLE\` (${REFUND_UNAVAILABLE}) O: \`REFUND_REJECTED\`.` })
  @ApiResponse({ status: 503, description: "Mercado Pago no respondió; reintentar no devuelve dos veces." })
  @ApiRateLimited(10, 600)
  refund(
    @Param("organizationId") organizationId: string,
    @Param("orderId") orderId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(refundRequestSchema)) body: RefundRequest,
  ) {
    return this.ordersService.refund(organizationId, user.id, orderId, body);
  }
}
