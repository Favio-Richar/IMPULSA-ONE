import { describe, expect, it } from "vitest";
import { MEMBERSHIP_EXPIRY_NOTICE_WINDOW_DAYS, MEMBERSHIP_RENEWAL_REMINDER_DAYS, membershipNoticeDue, type PurchaseForAccess } from "./index.js";

const NOW = new Date("2026-10-11T12:00:00Z");
const day = (n: number): Date => new Date(NOW.getTime() + n * 86_400_000);

type Notices = PurchaseForAccess & { renewalReminderSentAt: Date | null; expiryNoticeSentAt: Date | null };
const purchase = (overrides: Partial<Notices> = {}): Notices => ({
  status: "PAID",
  paymentStatus: "approved",
  amount: 5000,
  refundedAmount: 0,
  periodEnd: day(3),
  renewalReminderSentAt: null,
  expiryNoticeSentAt: null,
  ...overrides,
});

describe("avisos del ciclo de una membresía", () => {
  it("avisa de la renovación solo en la última semana", () => {
    expect(membershipNoticeDue(purchase({ periodEnd: day(3) }), [purchase({ periodEnd: day(3) })], NOW)).toBe("renewal_reminder");
    expect(membershipNoticeDue(purchase({ periodEnd: day(MEMBERSHIP_RENEWAL_REMINDER_DAYS) }), [purchase({ periodEnd: day(MEMBERSHIP_RENEWAL_REMINDER_DAYS) })], NOW)).toBe("renewal_reminder");
    expect(membershipNoticeDue(purchase({ periodEnd: day(MEMBERSHIP_RENEWAL_REMINDER_DAYS + 1) }), [purchase({ periodEnd: day(8) })], NOW)).toBeNull();
  });

  it("avisa del vencimiento poco después de terminar, no de lo que venció hace mucho", () => {
    const expired = purchase({ periodEnd: day(-1) });
    expect(membershipNoticeDue(expired, [expired], NOW)).toBe("expiry_notice");
    const old = purchase({ periodEnd: day(-(MEMBERSHIP_EXPIRY_NOTICE_WINDOW_DAYS + 1)) });
    expect(membershipNoticeDue(old, [old], NOW)).toBeNull();
  });

  it("cada aviso se manda una sola vez por compra", () => {
    const reminded = purchase({ renewalReminderSentAt: day(-1) });
    expect(membershipNoticeDue(reminded, [reminded], NOW)).toBeNull();
    const notified = purchase({ periodEnd: day(-1), expiryNoticeSentAt: day(0) });
    expect(membershipNoticeDue(notified, [notified], NOW)).toBeNull();
  });

  it("si el miembro ya renovó (otro periodo termina después), no se le avisa del anterior", () => {
    const current = purchase({ periodEnd: day(3) });
    const renewed = purchase({ periodEnd: day(33) });
    expect(membershipNoticeDue(current, [current, renewed], NOW)).toBeNull();
    // Y del vencido tampoco, porque tiene uno vigente.
    const expired = purchase({ periodEnd: day(-1) });
    expect(membershipNoticeDue(expired, [expired, renewed], NOW)).toBeNull();
    // El último periodo sí avisa.
    expect(membershipNoticeDue(renewed, [current, renewed], NOW)).toBeNull(); // aún falta (33 días)
    const lastSoon = purchase({ periodEnd: day(5) });
    expect(membershipNoticeDue(lastSoon, [current, lastSoon], NOW)).toBe("renewal_reminder");
  });

  it("no avisa de un pago reembolsado, en disputa o sin aprobar", () => {
    for (const overrides of [{ refundedAmount: 5000, paymentStatus: "refunded" }, { paymentStatus: "charged_back" }, { status: "PENDING" as const }, { periodEnd: null }]) {
      const p = purchase(overrides);
      expect(membershipNoticeDue(p, [p], NOW), JSON.stringify(overrides)).toBeNull();
    }
  });
});
