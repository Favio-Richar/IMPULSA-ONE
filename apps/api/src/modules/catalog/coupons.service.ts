import { ConflictException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { CouponResponse } from "@impulza/contracts";
import type { Coupon, Prisma, PrismaClient } from "@impulza/database";
import {
  COUPON_INVALID_MESSAGE,
  computeCouponDiscount,
  couponCodeSchema,
  couponRulesProblem,
  couponStatus,
  MAX_COUPONS_PER_SITE,
  type CouponKind,
  type CreateCouponInput,
  type UpdateCouponInput,
} from "@impulza/validation";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";

export const COUPON_NOT_FOUND = "Cupón no encontrado: no existe, o pertenece a otro sitio u organización (ADR-002).";
export const COUPON_CODE_TAKEN = "Ya hay un cupón con ese código en este sitio.";
export const COUPON_LIMIT = `Un sitio admite hasta ${MAX_COUPONS_PER_SITE} cupones.`;
export const COUPON_BELOW_USES = "El tope de usos no puede ser menor que los usos que ya tiene.";

function unprocessable(path: string, message: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ statusCode: HttpStatus.UNPROCESSABLE_ENTITY, error: "Unprocessable Entity", code: "COUPON_INVALID_RULES", message, issues: [{ path, message }] });
}

/** Error público uniforme: no revela si el código existe, venció, se agotó o no alcanza el mínimo. */
export function couponNotApplicable(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    error: "Unprocessable Entity",
    code: "COUPON_INVALID",
    message: COUPON_INVALID_MESSAGE,
    issues: [{ path: "couponCode", message: COUPON_INVALID_MESSAGE }],
  });
}

/**
 * Cupones de un sitio (F7.8b, ADR-023): el panel los administra (`catalog.manage`) y la página
 * pública los aplica al pedir. El descuento lo calcula siempre el servidor; el uso se cuenta con una
 * actualización condicional dentro de la transacción del pedido (dos pedidos a la vez no pasan el
 * tope, y la base además lo impide con un `CHECK`).
 */
@Injectable()
export class CouponsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  private async assertSite(organizationId: string, siteId: string): Promise<void> {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId }, select: { id: true } });
    if (!site) throw new NotFoundException("Sitio no encontrado.");
  }

  private async getOrThrow(organizationId: string, siteId: string, couponId: string): Promise<Coupon> {
    const coupon = await this.prisma.coupon.findFirst({ where: { id: couponId, siteId, organizationId } });
    if (!coupon) throw new NotFoundException(COUPON_NOT_FOUND);
    return coupon;
  }

  private toResponse(coupon: Coupon, discountGiven: Array<{ currency: string; amount: number }>): CouponResponse {
    return {
      id: coupon.id,
      siteId: coupon.siteId,
      code: coupon.code,
      description: coupon.description,
      kind: coupon.kind as CouponKind,
      percentOff: coupon.percentOff,
      amountOff: coupon.amountOff,
      currency: coupon.currency,
      minSubtotal: coupon.minSubtotal,
      startsAt: coupon.startsAt?.toISOString() ?? null,
      endsAt: coupon.endsAt?.toISOString() ?? null,
      maxRedemptions: coupon.maxRedemptions,
      redemptionCount: coupon.redemptionCount,
      active: coupon.active,
      status: couponStatus(coupon),
      discountGiven,
      createdAt: coupon.createdAt.toISOString(),
      updatedAt: coupon.updatedAt.toISOString(),
    };
  }

  /** Descuento entregado por cupón y moneda, en pedidos no cancelados. */
  private async discountGivenBy(couponIds: string[]): Promise<Map<string, Array<{ currency: string; amount: number }>>> {
    const result = new Map<string, Array<{ currency: string; amount: number }>>();
    if (couponIds.length === 0) return result;
    const rows = await this.prisma.order.groupBy({
      by: ["couponId", "priceCurrency"],
      where: { couponId: { in: couponIds }, status: { not: "CANCELLED" } },
      _sum: { discountAmount: true },
    });
    for (const row of rows) {
      if (!row.couponId) continue;
      const list = result.get(row.couponId) ?? [];
      list.push({ currency: row.priceCurrency, amount: row._sum.discountAmount ?? 0 });
      result.set(row.couponId, list);
    }
    return result;
  }

  private async withStats(coupon: Coupon): Promise<CouponResponse> {
    return this.toResponse(coupon, (await this.discountGivenBy([coupon.id])).get(coupon.id) ?? []);
  }

  async list(organizationId: string, siteId: string): Promise<CouponResponse[]> {
    await this.assertSite(organizationId, siteId);
    const coupons = await this.prisma.coupon.findMany({ where: { siteId, organizationId }, orderBy: { createdAt: "desc" } });
    const given = await this.discountGivenBy(coupons.map((coupon) => coupon.id));
    return coupons.map((coupon) => this.toResponse(coupon, given.get(coupon.id) ?? []));
  }

  async create(organizationId: string, actorId: string, siteId: string, input: CreateCouponInput): Promise<CouponResponse> {
    await this.assertSite(organizationId, siteId);
    if ((await this.prisma.coupon.count({ where: { siteId } })) >= MAX_COUPONS_PER_SITE) {
      throw new UnprocessableEntityException(COUPON_LIMIT);
    }
    let created: Coupon;
    try {
      created = await this.prisma.coupon.create({
        data: {
          organizationId,
          siteId,
          code: input.code,
          description: input.description ?? null,
          kind: input.kind,
          percentOff: input.kind === "percent" ? (input.percentOff ?? null) : null,
          amountOff: input.kind === "fixed" ? (input.amountOff ?? null) : null,
          currency: input.currency ?? null,
          minSubtotal: input.minSubtotal ?? null,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          maxRedemptions: input.maxRedemptions ?? null,
          active: input.active,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(COUPON_CODE_TAKEN);
      throw error;
    }
    await this.auditService.record({
      organizationId,
      actorId,
      action: "coupon.created",
      targetType: "Coupon",
      targetId: created.id,
      metadata: { siteId, code: created.code, kind: created.kind },
    });
    logger.info("cupón creado", { organizationId, siteId, couponId: created.id });
    return this.toResponse(created, []);
  }

  async update(organizationId: string, actorId: string, siteId: string, couponId: string, changes: UpdateCouponInput): Promise<CouponResponse> {
    const current = await this.getOrThrow(organizationId, siteId, couponId);
    const kind = (changes.kind ?? current.kind) as CouponKind;
    const pick = <K extends keyof UpdateCouponInput>(key: K, fallback: NonNullable<UpdateCouponInput[K]> | null) =>
      (changes[key] === undefined ? fallback : changes[key]) as NonNullable<UpdateCouponInput[K]> | null;
    const merged = {
      kind,
      // Cambiar de tipo deja el campo del otro tipo vacío.
      percentOff: kind === "percent" ? pick("percentOff", current.percentOff) : null,
      amountOff: kind === "fixed" ? pick("amountOff", current.amountOff) : null,
      currency: pick("currency", current.currency),
      minSubtotal: pick("minSubtotal", current.minSubtotal),
      startsAt: pick("startsAt", current.startsAt?.toISOString() ?? null),
      endsAt: pick("endsAt", current.endsAt?.toISOString() ?? null),
      maxRedemptions: pick("maxRedemptions", current.maxRedemptions),
    };
    const problem = couponRulesProblem(merged);
    if (problem) throw unprocessable(problem.path, problem.message);
    if (merged.maxRedemptions !== null && merged.maxRedemptions < current.redemptionCount) {
      throw unprocessable("maxRedemptions", COUPON_BELOW_USES);
    }
    const data: Prisma.CouponUncheckedUpdateInput = {
      ...(changes.code === undefined ? {} : { code: changes.code }),
      ...(changes.description === undefined ? {} : { description: changes.description }),
      ...(changes.active === undefined ? {} : { active: changes.active }),
      kind: merged.kind,
      percentOff: merged.percentOff,
      amountOff: merged.amountOff,
      currency: merged.currency,
      minSubtotal: merged.minSubtotal,
      startsAt: merged.startsAt ? new Date(merged.startsAt) : null,
      endsAt: merged.endsAt ? new Date(merged.endsAt) : null,
      maxRedemptions: merged.maxRedemptions,
    };
    let updated: Coupon;
    try {
      // Condicional a los usos leídos: si un pedido lo usó entretanto y el tope nuevo queda corto, la
      // base lo rechaza (CHECK) y se responde como un tope inválido, nunca con un 500.
      updated = await this.prisma.coupon.update({ where: { id: current.id }, data });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(COUPON_CODE_TAKEN);
      if (error instanceof Error && error.message.includes("coupons_redemptions_check")) throw unprocessable("maxRedemptions", COUPON_BELOW_USES);
      throw error;
    }
    await this.auditService.record({
      organizationId,
      actorId,
      action: "coupon.updated",
      targetType: "Coupon",
      targetId: current.id,
      metadata: { siteId, fields: Object.keys(changes) },
    });
    return this.withStats(updated);
  }

  /** Borra el cupón; los pedidos que lo usaron conservan su código y su descuento (FK `SET NULL`). */
  async remove(organizationId: string, actorId: string, siteId: string, couponId: string): Promise<void> {
    const current = await this.getOrThrow(organizationId, siteId, couponId);
    await this.prisma.coupon.delete({ where: { id: current.id } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "coupon.deleted",
      targetType: "Coupon",
      targetId: current.id,
      metadata: { siteId, code: current.code, redemptions: current.redemptionCount },
    });
  }

  // --- Página pública ---

  /**
   * Cupón aplicable a un subtotal, o error público uniforme. Revisa formato, sitio, estado, vigencia,
   * usos, moneda y mínimo. No cuenta el uso (eso lo hace `redeem`, dentro del pedido).
   */
  async resolve(siteId: string, rawCode: string, subtotal: number, currency: string, now = new Date()): Promise<{ coupon: Coupon; discount: number }> {
    const parsed = couponCodeSchema.safeParse(rawCode);
    if (!parsed.success) throw couponNotApplicable();
    const coupon = await this.prisma.coupon.findUnique({ where: { siteId_code: { siteId, code: parsed.data } } });
    if (!coupon || couponStatus(coupon, now) !== "active") throw couponNotApplicable();
    const discount = computeCouponDiscount(
      { kind: coupon.kind as CouponKind, percentOff: coupon.percentOff, amountOff: coupon.amountOff, currency: coupon.currency, minSubtotal: coupon.minSubtotal },
      subtotal,
      currency,
    );
    if (discount === null || discount <= 0) throw couponNotApplicable();
    return { coupon, discount };
  }

  /**
   * Cuenta un uso dentro de la transacción del pedido, solo si el cupón sigue activo, vigente y con
   * cupo **en la base** (no en lo leído antes): dos pedidos a la vez por el último uso no pasan los dos.
   */
  async redeem(tx: Prisma.TransactionClient, couponId: string): Promise<void> {
    const updated = await tx.$executeRaw`
      UPDATE "coupons"
      SET "redemption_count" = "redemption_count" + 1, "updated_at" = now()
      WHERE "id" = ${couponId}::uuid
        AND "active"
        AND ("max_redemptions" IS NULL OR "redemption_count" < "max_redemptions")
        AND ("starts_at" IS NULL OR "starts_at" <= now())
        AND ("ends_at" IS NULL OR "ends_at" > now())`;
    if (updated === 0) throw couponNotApplicable();
  }
}
