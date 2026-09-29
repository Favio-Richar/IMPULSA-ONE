import { createHash } from "node:crypto";

// Reglas puras del motor de facturación (F4.6a, ADR-012): IVA, períodos, orden de compra y la
// política de morosidad. Sin base ni red, para probarlas sin nada alrededor.

/** IVA en Chile. Los precios del catálogo son precio final al consumidor (IVA incluido). */
export const VAT_RATE_PERCENT = 19;

/** Separa neto e IVA de un total en pesos enteros: neto = round(total / 1,19), IVA = el resto, así
 *  neto + IVA es siempre exactamente el total cobrado. */
export function splitVat(total: number): { net: number; vat: number; total: number } {
  if (!Number.isInteger(total) || total < 0) throw new Error("El total debe ser un entero de pesos ≥ 0.");
  const net = Math.round((total * 100) / (100 + VAT_RATE_PERCENT));
  return { net, vat: total - net, total };
}

export const BILLING_CYCLES = ["MONTHLY", "YEARLY"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/**
 * Fin de un período que empieza en `start`. Mensual: mismo día del mes siguiente, y si ese día no
 * existe (31 → febrero) el último día de ese mes — nunca se salta un mes. Anual: igual, un año.
 */
export function periodEnd(start: Date, cycle: BillingCycle): Date {
  const months = cycle === "MONTHLY" ? 1 : 12;
  const end = new Date(start.getTime());
  const day = start.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

export function priceFor(plan: { priceMonthly: number; priceYearly: number }, cycle: BillingCycle): number {
  return cycle === "MONTHLY" ? plan.priceMonthly : plan.priceYearly;
}

/**
 * Núcleo de orden de compra **determinista**: el mismo (suscripción, inicio de período, intento)
 * da siempre la misma orden, y `Payment.buyOrder` es único — así un trabajo repetido nunca genera
 * un segundo cobro, ni en nuestra base ni en la pasarela. 24 caracteres alfanuméricos (Transbank
 * admite 26 con el prefijo P/C de `oneclickBuyOrders`).
 */
export function buyOrderFor(subscriptionId: string, periodStart: Date, attempt: number): string {
  const digest = createHash("sha256").update(`${subscriptionId}|${periodStart.toISOString()}|${attempt}`).digest("hex");
  return BigInt(`0x${digest}`).toString(36).toUpperCase().padStart(24, "0").slice(0, 24);
}

/** Gracia tras un cobro fallido antes de volver a Gratis (ADR-012). */
export const GRACE_PERIOD_DAYS = 7;
/** Días, contados desde el vencimiento, en que se reintenta el cobro. */
export const RETRY_SCHEDULE_DAYS = [1, 3, 6] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Próximo reintento tras `failedAttempts` fallos, o `null` si ya no quedan (se agota la gracia). */
export function nextRetryAt(dueAt: Date, failedAttempts: number): Date | null {
  const days = RETRY_SCHEDULE_DAYS[failedAttempts - 1];
  return days === undefined ? null : new Date(dueAt.getTime() + days * DAY_MS);
}

export function graceEndsAt(dueAt: Date): Date {
  return new Date(dueAt.getTime() + GRACE_PERIOD_DAYS * DAY_MS);
}

/** Derecho a retracto (Ley 19.496 art. 3 bis b): 10 días desde la contratación. */
export const WITHDRAWAL_DAYS = 10;

export function withinWithdrawalWindow(firstPaidAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - firstPaidAt.getTime() <= WITHDRAWAL_DAYS * DAY_MS;
}

/** Identificador del cliente en la pasarela: el id de la organización sin guiones (32 caracteres;
 *  Transbank admite hasta 40). No es un dato personal. */
export function customerRefFor(organizationId: string): string {
  return organizationId.replace(/-/g, "");
}
