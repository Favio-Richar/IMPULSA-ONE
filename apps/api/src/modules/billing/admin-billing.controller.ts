import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiProduces, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { adminBillingSummaryResponse, adminPaymentListResponse, adminPaymentResponse, adminRefundResponse } from "@impulza/contracts";
import {
  adminRefundSchema,
  billingMonthSchema,
  listAdminPaymentsQuerySchema,
  markTaxDocumentSchema,
  type AdminRefundInput,
  type ListAdminPaymentsQuery,
  type MarkTaxDocumentInput,
} from "@impulza/validation";
import { z } from "zod";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import type { RequestWithUser } from "../../common/request-with-user.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ADMIN_SESSION_AUTH } from "../../openapi/document.js";
import { ApiRateLimited, ApiUuidParam, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { uuidParamSchema } from "../admin/dto/admin-queries.dto.js";
import { AdminSessionGuard } from "../admin/guards/admin-session.guard.js";
import { AdminBillingService } from "./admin-billing.service.js";

const monthQuerySchema = z.object({ month: billingMonthSchema.optional() });
const requiredMonthQuerySchema = z.object({ month: billingMonthSchema });

/**
 * Ingresos de la plataforma (F4.6d, ADR-012): MRR, cobros, boletas pendientes y reembolsos manuales.
 * Misma puerta que el resto de `/admin/*` (sesión `ADMIN` con TOTP, ADR-005).
 */
@ApiTags("admin")
@ApiCookieAuth(ADMIN_SESSION_AUTH)
@ApiResponse({ status: 401, description: "Sin sesión de administración válida (cookie `impulza_admin_session`)." })
@ApiResponse({ status: 403, description: "Petición que modifica estado sin la cabecera anti-CSRF." })
@Controller("admin/billing")
@UseGuards(CsrfGuard, AdminSessionGuard)
export class AdminBillingController {
  constructor(private readonly adminBilling: AdminBillingService) {}

  @Get("summary")
  @ApiOperation({ summary: "Resumen de ingresos", description: "MRR/ARR, suscripciones, cobrado y reembolsado en el mes (hora de Chile) y boletas pendientes." })
  @ApiQuery({ name: "month", required: false, description: "`AAAA-MM`; por defecto, el mes en curso en Chile." })
  @ApiZodResponse(200, adminBillingSummaryResponse, "Resumen del mes.")
  @ApiResponse({ status: 400, description: "Mes inválido." })
  summary(@Query(new ZodValidationPipe(monthQuerySchema)) query: z.infer<typeof monthQuerySchema>) {
    return this.adminBilling.summary(query.month);
  }

  @Get("payments")
  @ApiOperation({ summary: "Cobros", description: "Filtrables por mes, estado y boleta; del más nuevo al más antiguo." })
  @ApiQuery({ name: "month", required: false })
  @ApiQuery({ name: "status", required: false, enum: ["PENDING", "APPROVED", "REJECTED", "REFUNDED"] })
  @ApiQuery({ name: "taxDocument", required: false, enum: ["PENDING", "ISSUED", "NOT_REQUIRED"] })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiZodResponse(200, adminPaymentListResponse, "Una página de cobros.")
  @ApiResponse({ status: 400, description: "Parámetros inválidos." })
  listPayments(@Query(new ZodValidationPipe(listAdminPaymentsQuerySchema)) query: ListAdminPaymentsQuery) {
    return this.adminBilling.listPayments(query);
  }

  @Get("payments.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=\"impulza-cobros.csv\"")
  @ApiOperation({ summary: "Exportar los cobros de un mes (CSV)", description: "Para el contador: neto, IVA, total, boleta y folio. Queda auditado. Celdas protegidas contra inyección de fórmulas." })
  @ApiQuery({ name: "month", required: true })
  @ApiProduces("text/csv")
  @ApiResponse({ status: 200, description: "Planilla CSV en UTF-8." })
  @ApiResponse({ status: 400, description: "Mes inválido." })
  async exportPayments(@Req() req: RequestWithUser, @Query(new ZodValidationPipe(requiredMonthQuerySchema)) query: z.infer<typeof requiredMonthQuerySchema>) {
    return this.adminBilling.paymentsCsv(req.user.id, query.month);
  }

  @Post("payments/:paymentId/tax-document")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Marcar la boleta como emitida", description: "Con el folio del documento emitido ante el SII. Queda auditado." })
  @ApiUuidParam("paymentId", "Cobro.")
  @ApiZodBody(markTaxDocumentSchema)
  @ApiZodResponse(200, adminPaymentResponse, "Cobro actualizado.")
  @ApiResponse({ status: 404, description: "Pago no encontrado." })
  @ApiResponse({ status: 409, description: "`TAX_DOCUMENT_NOT_PENDING`." })
  markTaxDocument(
    @Req() req: RequestWithUser,
    @Param("paymentId", new ZodValidationPipe(uuidParamSchema)) paymentId: string,
    @Body(new ZodValidationPipe(markTaxDocumentSchema)) body: MarkTaxDocumentInput,
  ) {
    return this.adminBilling.markTaxDocumentIssued(req.user.id, paymentId, body);
  }

  @Post("payments/:paymentId/refund")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "admin-billing-refund" })
  @ApiOperation({ summary: "Reembolsar un cobro", description: "Devuelve lo que falte del cobro por la misma pasarela, con motivo obligatorio (auditado) y aviso al dueño. No cancela la suscripción." })
  @ApiUuidParam("paymentId", "Cobro.")
  @ApiZodBody(adminRefundSchema)
  @ApiZodResponse(200, adminRefundResponse, "Cobro reembolsado.")
  @ApiResponse({ status: 404, description: "Pago no encontrado." })
  @ApiResponse({ status: 409, description: "`NOT_REFUNDABLE`." })
  @ApiResponse({ status: 422, description: "`GATEWAY_UNAVAILABLE`." })
  @ApiResponse({ status: 502, description: "`REFUND_FAILED`: el cobro quedó como estaba." })
  @ApiRateLimited(10, 600)
  refund(
    @Req() req: RequestWithUser,
    @Param("paymentId", new ZodValidationPipe(uuidParamSchema)) paymentId: string,
    @Body(new ZodValidationPipe(adminRefundSchema)) body: AdminRefundInput,
  ) {
    return this.adminBilling.refund(req.user.id, paymentId, body);
  }
}
