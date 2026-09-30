import { BadGatewayException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { EmailAdapter } from "@impulza/auth";
import type { AdminBillingSummaryResponse, AdminPaymentListResponse, AdminPaymentResponse, AdminRefundResponse } from "@impulza/contracts";
import { PaymentStatus, type Prisma, type PrismaClient, SubscriptionStatus, TaxDocumentStatus } from "@impulza/database";
import {
  csvRow,
  currentSantiagoMonth,
  type MerchantRecurringGateway,
  monthlyRecurringAmount,
  PaymentGatewayError,
  paymentRefundedEmail,
  santiagoMonthRange,
} from "@impulza/payments";
import type { AdminRefundInput, ListAdminPaymentsQuery, MarkTaxDocumentInput } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { BillingService } from "./billing.service.js";
import { MERCHANT_GATEWAY } from "./merchant-gateway.token.js";

const PAYMENT_INCLUDE = { organization: { select: { id: true, name: true } }, subscription: { select: { plan: { select: { name: true } } } } } as const;
type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

const CSV_LIMIT = 5_000;
/** Marca de orden de bytes: sin ella, Excel abre el CSV como Latin-1 y rompe tildes y eñes. */
const UTF8_BOM = String.fromCharCode(0xfeff);
const STATUS_LABELS: Record<PaymentStatus, string> = { PENDING: "Confirmando", APPROVED: "Pagado", REJECTED: "Rechazado", REFUNDED: "Reembolsado" };
const TAX_LABELS: Record<TaxDocumentStatus, string> = { PENDING: "Pendiente", ISSUED: "Emitida", NOT_REQUIRED: "No requiere" };

/**
 * Ingresos de la plataforma en la superadministración (F4.6d, ADR-012). Son los cobros de Impulza a
 * sus clientes — no datos comerciales de un cliente (ADR-005 §5). Toda escritura queda auditada.
 */
@Injectable()
export class AdminBillingService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(MERCHANT_GATEWAY) private readonly webpay: MerchantRecurringGateway | null,
    @Inject(EMAIL_ADAPTER) private readonly emailAdapter: EmailAdapter,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
  ) {}

  async summary(month: string = currentSantiagoMonth()): Promise<AdminBillingSummaryResponse> {
    const { from, to } = santiagoMonthRange(month);
    const [live, collected, refunded, failed, taxPending, newSubscriptions, churned] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] }, firstPaidAt: { not: null } },
        select: { status: true, billingCycle: true, cancelAtPeriodEnd: true, plan: { select: { code: true, name: true, priceMonthly: true, priceYearly: true, sortOrder: true } } },
      }),
      this.prisma.payment.aggregate({
        where: { paidAt: { gte: from, lt: to }, status: { in: [PaymentStatus.APPROVED, PaymentStatus.REFUNDED] } },
        _sum: { amount: true, netAmount: true, vatAmount: true },
      }),
      this.prisma.payment.aggregate({ where: { refundedAt: { gte: from, lt: to } }, _sum: { refundedAmount: true } }),
      this.prisma.payment.count({ where: { createdAt: { gte: from, lt: to }, status: PaymentStatus.REJECTED } }),
      this.prisma.payment.aggregate({
        where: { taxDocumentStatus: TaxDocumentStatus.PENDING, status: { in: [PaymentStatus.APPROVED, PaymentStatus.REFUNDED] } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.subscription.count({ where: { firstPaidAt: { gte: from, lt: to } } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.CANCELED, firstPaidAt: { not: null }, canceledAt: { gte: from, lt: to } } }),
    ]);

    let mrr = 0;
    let mrrAtRisk = 0;
    const byPlan = new Map<string, { planCode: string; planName: string; subscriptions: number; mrr: number; sortOrder: number }>();
    for (const subscription of live) {
      const amount = monthlyRecurringAmount(subscription.plan, subscription.billingCycle);
      mrr += amount;
      if (subscription.cancelAtPeriodEnd || subscription.status === SubscriptionStatus.PAST_DUE) mrrAtRisk += amount;
      const row = byPlan.get(subscription.plan.code) ?? { planCode: subscription.plan.code, planName: subscription.plan.name, subscriptions: 0, mrr: 0, sortOrder: subscription.plan.sortOrder };
      row.subscriptions += 1;
      row.mrr += amount;
      byPlan.set(subscription.plan.code, row);
    }

    return {
      month,
      mrr,
      arr: mrr * 12,
      mrrAtRisk,
      subscriptions: {
        active: live.filter((s) => s.status === SubscriptionStatus.ACTIVE && !s.cancelAtPeriodEnd).length,
        pastDue: live.filter((s) => s.status === SubscriptionStatus.PAST_DUE).length,
        canceling: live.filter((s) => s.cancelAtPeriodEnd).length,
      },
      movement: { newSubscriptions, churned },
      collected: { total: collected._sum.amount ?? 0, net: collected._sum.netAmount ?? 0, vat: collected._sum.vatAmount ?? 0 },
      refunded: refunded._sum.refundedAmount ?? 0,
      failedPayments: failed,
      taxDocumentsPending: { count: taxPending._count._all, total: taxPending._sum.amount ?? 0 },
      byPlan: [...byPlan.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((row) => ({ planCode: row.planCode, planName: row.planName, subscriptions: row.subscriptions, mrr: row.mrr })),
      gateways: this.billing.availableGateways(),
    };
  }

  private paymentsWhere(query: Pick<ListAdminPaymentsQuery, "month" | "status" | "taxDocument">): Prisma.PaymentWhereInput {
    const where: Prisma.PaymentWhereInput = {};
    if (query.month) {
      const { from, to } = santiagoMonthRange(query.month);
      where.createdAt = { gte: from, lt: to };
    }
    if (query.status) where.status = query.status;
    if (query.taxDocument) where.taxDocumentStatus = query.taxDocument;
    return where;
  }

  async listPayments(query: ListAdminPaymentsQuery): Promise<AdminPaymentListResponse> {
    const where = this.paymentsWhere(query);
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({ where, include: PAYMENT_INCLUDE, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.payment.count({ where }),
    ]);
    return { items: items.map((payment) => this.toResponse(payment)), total };
  }

  /** Planilla del mes para el contador: una fila por cobro, con neto, IVA y folio. */
  async paymentsCsv(adminId: string, month: string): Promise<string> {
    const payments = await this.prisma.payment.findMany({
      where: this.paymentsWhere({ month }),
      include: PAYMENT_INCLUDE,
      orderBy: { createdAt: "asc" },
      take: CSV_LIMIT,
    });
    await this.audit.record({ actorId: adminId, action: "admin.billing.payments_exported", targetType: "payment", metadata: { month, rows: payments.length } });
    const header = csvRow(["Fecha", "Organización", "Plan", "Neto", "IVA", "Total", "Reembolsado", "Estado", "Boleta", "Folio", "Orden de compra"]);
    const rows = payments.map((payment) =>
      csvRow([
        (payment.paidAt ?? payment.createdAt).toISOString(),
        payment.organization.name,
        payment.subscription.plan.name,
        payment.netAmount,
        payment.vatAmount,
        payment.amount,
        payment.refundedAmount,
        STATUS_LABELS[payment.status],
        TAX_LABELS[payment.taxDocumentStatus],
        payment.taxDocumentNumber,
        payment.buyOrder,
      ]),
    );
    // BOM para que Excel reconozca UTF-8 (tildes y ñ); separador de líneas CRLF del estándar CSV.
    return `${UTF8_BOM}${[header, ...rows].join("\r\n")}\r\n`;
  }

  /** La boleta de un cobro se emitió (fuera del sistema, hasta tener un emisor automático). */
  async markTaxDocumentIssued(adminId: string, paymentId: string, input: MarkTaxDocumentInput): Promise<AdminPaymentResponse> {
    const updated = await this.prisma.payment.updateMany({
      where: { id: paymentId, taxDocumentStatus: TaxDocumentStatus.PENDING, status: { in: [PaymentStatus.APPROVED, PaymentStatus.REFUNDED] } },
      data: { taxDocumentStatus: TaxDocumentStatus.ISSUED, taxDocumentNumber: input.documentNumber },
    });
    if (updated.count !== 1) {
      const exists = await this.prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true } });
      if (!exists) throw new NotFoundException("Pago no encontrado.");
      throw new ConflictException({ code: "TAX_DOCUMENT_NOT_PENDING", message: "Este cobro no tiene una boleta pendiente." });
    }
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: PAYMENT_INCLUDE });
    await this.audit.record({
      organizationId: payment.organizationId,
      actorId: adminId,
      action: "admin.billing.tax_document_issued",
      targetType: "payment",
      targetId: payment.id,
      metadata: { documentNumber: input.documentNumber, amount: payment.amount },
    });
    return this.toResponse(payment);
  }

  /**
   * Reembolso manual por el equipo (un cobro por error, un duplicado cuyo reembolso automático
   * falló). Se reclama el pago antes de llamar a Transbank — dos clics no reembolsan dos veces — y
   * si la pasarela falla se revierte. No cancela la suscripción: eso es decisión del cliente.
   */
  async refund(adminId: string, paymentId: string, input: AdminRefundInput): Promise<AdminRefundResponse> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { ...PAYMENT_INCLUDE, organization: { select: { id: true, name: true } } } });
    if (!payment) throw new NotFoundException("Pago no encontrado.");
    const pending = payment.amount - payment.refundedAmount;
    if (payment.status !== PaymentStatus.APPROVED || pending <= 0) {
      throw new ConflictException({ code: "NOT_REFUNDABLE", message: "Solo se reembolsa un cobro pagado que no se haya devuelto." });
    }
    if (payment.gateway !== "WEBPAY_ONECLICK" || !this.webpay) {
      throw new UnprocessableEntityException({ code: "GATEWAY_UNAVAILABLE", message: "La pasarela de este cobro no está configurada en este ambiente." });
    }
    const creditNoteRequired = payment.taxDocumentStatus === TaxDocumentStatus.ISSUED;
    const now = new Date();
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.APPROVED, refundedAmount: payment.refundedAmount },
      data: {
        status: PaymentStatus.REFUNDED,
        refundedAmount: payment.amount,
        refundedAt: now,
        ...(payment.taxDocumentStatus === TaxDocumentStatus.PENDING ? { taxDocumentStatus: TaxDocumentStatus.NOT_REQUIRED } : {}),
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException({ code: "NOT_REFUNDABLE", message: "Este cobro cambió mientras tanto: recarga la lista." });
    }

    try {
      await this.webpay.refund({ buyOrder: payment.buyOrder, amount: pending });
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.APPROVED, refundedAmount: payment.refundedAmount, refundedAt: payment.refundedAt, taxDocumentStatus: payment.taxDocumentStatus },
      });
      logger.error("admin.billing: falló el reembolso manual", { paymentId: payment.id, code: error instanceof PaymentGatewayError ? error.code : "unknown" });
      throw new BadGatewayException({ code: "REFUND_FAILED", message: "Transbank no procesó el reembolso. El cobro quedó como estaba." });
    }

    await this.audit.record({
      organizationId: payment.organizationId,
      actorId: adminId,
      action: "admin.billing.payment_refunded",
      targetType: "payment",
      targetId: payment.id,
      metadata: { refundedAmount: pending, reason: input.reason, creditNoteRequired },
    });
    logger.info("admin.billing: reembolso manual", { paymentId: payment.id, refundedAmount: pending, creditNoteRequired });

    const owners = await this.prisma.membership.findMany({
      where: { organizationId: payment.organizationId, status: "ACTIVE", role: { name: "OWNER" } },
      select: { user: { select: { email: true } } },
    });
    const content = paymentRefundedEmail({
      organizationName: payment.organization.name,
      planName: payment.subscription.plan.name,
      refundedAmount: pending,
      planUrl: `${env.APP_BASE_URL.replace(/\/+$/, "")}/plan`,
    });
    for (const owner of owners) {
      await this.emailAdapter
        .send({ to: owner.user.email, subject: content.subject, text: content.text })
        .catch((error: unknown) => logger.warn("admin.billing: no se pudo avisar el reembolso", { paymentId: payment.id, error: error instanceof Error ? error.name : "unknown" }));
    }

    const refreshed = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: PAYMENT_INCLUDE });
    return { payment: this.toResponse(refreshed), creditNoteRequired };
  }

  private toResponse(payment: PaymentWithRelations): AdminPaymentResponse {
    return {
      id: payment.id,
      organization: { id: payment.organization.id, name: payment.organization.name },
      planName: payment.subscription.plan.name,
      gateway: payment.gateway,
      amount: payment.amount,
      netAmount: payment.netAmount,
      vatAmount: payment.vatAmount,
      currency: payment.currency,
      status: payment.status,
      attempt: payment.attempt,
      failureReason: payment.failureReason,
      refundedAmount: payment.refundedAmount,
      taxDocumentStatus: payment.taxDocumentStatus,
      taxDocumentNumber: payment.taxDocumentNumber,
      periodStart: payment.periodStart.toISOString(),
      periodEnd: payment.periodEnd.toISOString(),
      paidAt: payment.paidAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
    };
  }
}
