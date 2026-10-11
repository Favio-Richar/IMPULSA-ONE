import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { MembershipPlanListResponse, MembershipPlanResponse } from "@impulza/contracts";
import { MembershipPlanStatus, type PrismaClient } from "@impulza/database";
import { checkoutSupportsCurrency, currentSantiagoMonth, santiagoMonthRange } from "@impulza/payments";
import {
  MEMBERSHIP_PLANS_PER_SITE_MAX,
  purchaseGrantsAccess,
  type CreateMembershipPlanDto,
  type UpdateMembershipPlanDto,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";
import { MembershipCheckoutService } from "./membership-checkout.service.js";

const SITE_NOT_FOUND = "Sitio no encontrado.";
const PLAN_NOT_FOUND = "Plan no encontrado.";
const UNSUPPORTED_CURRENCY = "Mercado Pago no cobra en esa moneda. Usa una moneda compatible, por ejemplo CLP.";

/** Planes de membresía de un sitio, vistos y editados desde el panel (F10.2, ADR-029). */
@Injectable()
export class MembershipPlansService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MembershipCheckoutService) private readonly checkout: MembershipCheckoutService,
  ) {}

  private async siteOf(organizationId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId }, select: { id: true } });
    if (!site) throw new NotFoundException(SITE_NOT_FOUND);
    return site;
  }

  private async planOf(organizationId: string, siteId: string, planId: string) {
    const plan = await this.prisma.membershipPlan.findFirst({ where: { id: planId, siteId, organizationId } });
    if (!plan) throw new NotFoundException(PLAN_NOT_FOUND);
    return plan;
  }

  private toResponse(plan: { id: string; name: string; description: string | null; priceAmount: number; priceCurrency: string; period: "MONTHLY" | "YEARLY"; status: MembershipPlanStatus; createdAt: Date }, activeMembers: number): MembershipPlanResponse {
    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      priceAmount: plan.priceAmount,
      priceCurrency: plan.priceCurrency,
      period: plan.period,
      status: plan.status,
      activeMembers,
      createdAt: plan.createdAt.toISOString(),
    };
  }

  async list(organizationId: string, siteId: string): Promise<MembershipPlanListResponse> {
    await this.siteOf(organizationId, siteId);
    const now = new Date();
    const range = santiagoMonthRange(currentSantiagoMonth());

    const [plans, current, month, available] = await Promise.all([
      this.prisma.membershipPlan.findMany({ where: { siteId, organizationId }, orderBy: [{ status: "asc" }, { createdAt: "asc" }] }),
      // Periodos vigentes: el filtro fino (reembolsos) se aplica con la misma regla que el acceso.
      this.prisma.membershipPurchase.findMany({
        where: { siteId, organizationId, status: "PAID", periodEnd: { gt: now } },
        select: { planId: true, memberId: true, status: true, paymentStatus: true, amount: true, refundedAmount: true, periodEnd: true },
      }),
      this.prisma.membershipPurchase.findMany({
        where: { siteId, organizationId, status: "PAID", paidAt: { gte: range.from, lt: range.to } },
        select: { currency: true, amount: true, refundedAmount: true, paymentStatus: true },
      }),
      this.checkout.checkoutAvailable(organizationId),
    ]);

    const members = new Map<string, Set<string>>();
    for (const purchase of current) {
      if (!purchaseGrantsAccess(purchase, now)) continue;
      const set = members.get(purchase.planId) ?? new Set<string>();
      set.add(purchase.memberId);
      members.set(purchase.planId, set);
    }

    const revenue = new Map<string, { amount: number; purchases: number }>();
    for (const purchase of month) {
      if (purchase.paymentStatus !== "approved" || purchase.refundedAmount >= purchase.amount) continue;
      const row = revenue.get(purchase.currency) ?? { amount: 0, purchases: 0 };
      row.amount += purchase.amount - purchase.refundedAmount;
      row.purchases += 1;
      revenue.set(purchase.currency, row);
    }

    return {
      plans: plans.map((plan) => this.toResponse(plan, members.get(plan.id)?.size ?? 0)),
      checkoutAvailable: available,
      monthRevenue: [...revenue.entries()].map(([currency, row]) => ({ currency, ...row })),
    };
  }

  async create(organizationId: string, siteId: string, actorId: string, dto: CreateMembershipPlanDto): Promise<MembershipPlanResponse> {
    await this.siteOf(organizationId, siteId);
    if (!checkoutSupportsCurrency(dto.priceCurrency)) throw new ConflictException(UNSUPPORTED_CURRENCY);
    const count = await this.prisma.membershipPlan.count({ where: { siteId, status: MembershipPlanStatus.ACTIVE } });
    if (count >= MEMBERSHIP_PLANS_PER_SITE_MAX) {
      throw new ConflictException(`Un sitio admite hasta ${MEMBERSHIP_PLANS_PER_SITE_MAX} planes activos. Archiva alguno para crear otro.`);
    }
    const plan = await this.prisma.membershipPlan.create({
      data: {
        organizationId,
        siteId,
        name: dto.name,
        description: dto.description && dto.description.length > 0 ? dto.description : null,
        priceAmount: dto.priceAmount,
        priceCurrency: dto.priceCurrency,
        period: dto.period,
      },
    });
    await this.audit.record({ organizationId, actorId, action: "membership_plan.created", targetType: "MembershipPlan", targetId: plan.id, metadata: { siteId, priceAmount: plan.priceAmount, priceCurrency: plan.priceCurrency, period: plan.period } });
    return this.toResponse(plan, 0);
  }

  /** Cambiar el precio o el periodo solo afecta compras futuras: cada compra guarda copia de lo que se pagó. */
  async update(organizationId: string, siteId: string, planId: string, actorId: string, dto: UpdateMembershipPlanDto): Promise<MembershipPlanResponse> {
    await this.planOf(organizationId, siteId, planId);
    if (dto.priceCurrency !== undefined && !checkoutSupportsCurrency(dto.priceCurrency)) throw new ConflictException(UNSUPPORTED_CURRENCY);
    const plan = await this.prisma.membershipPlan.update({
      where: { id: planId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description && dto.description.length > 0 ? dto.description : null } : {}),
        ...(dto.priceAmount !== undefined ? { priceAmount: dto.priceAmount } : {}),
        ...(dto.priceCurrency !== undefined ? { priceCurrency: dto.priceCurrency } : {}),
        ...(dto.period !== undefined ? { period: dto.period } : {}),
      },
    });
    await this.audit.record({ organizationId, actorId, action: "membership_plan.updated", targetType: "MembershipPlan", targetId: planId, metadata: { siteId, fields: Object.keys(dto) } });
    return this.toResponse(plan, 0);
  }

  /** Archivar deja de ofrecer el plan; quienes ya pagaron conservan su periodo. */
  async setStatus(organizationId: string, siteId: string, planId: string, actorId: string, status: MembershipPlanStatus): Promise<MembershipPlanResponse> {
    const existing = await this.planOf(organizationId, siteId, planId);
    if (status === MembershipPlanStatus.ACTIVE && existing.status !== MembershipPlanStatus.ACTIVE) {
      const count = await this.prisma.membershipPlan.count({ where: { siteId, status: MembershipPlanStatus.ACTIVE } });
      if (count >= MEMBERSHIP_PLANS_PER_SITE_MAX) throw new ConflictException(`Un sitio admite hasta ${MEMBERSHIP_PLANS_PER_SITE_MAX} planes activos.`);
    }
    const plan = await this.prisma.membershipPlan.update({ where: { id: planId }, data: { status } });
    await this.audit.record({
      organizationId,
      actorId,
      action: status === MembershipPlanStatus.ARCHIVED ? "membership_plan.archived" : "membership_plan.restored",
      targetType: "MembershipPlan",
      targetId: planId,
      metadata: { siteId },
    });
    return this.toResponse(plan, 0);
  }
}
