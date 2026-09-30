import { splitVat, type BillingCycle } from "./billing.js";

// Correos de la suscripción (ADR-012 §3: confirmación escrita de la contratación y de cada cobro).
// Texto plano, compartido por la API (primer cobro) y el worker (renovaciones). Nunca datos de
// tarjeta más allá de marca y últimos 4 dígitos.

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Santiago" });

export function formatClp(amount: number): string {
  return CLP.format(amount);
}

export function formatDate(date: Date): string {
  return DATE.format(date);
}

function cycleLabel(cycle: BillingCycle): string {
  return cycle === "MONTHLY" ? "mensual" : "anual";
}

function card(brand: string | null, last4: string | null): string {
  if (!last4) return "tu medio de pago inscrito";
  return `${brand ?? "tarjeta"} terminada en ${last4}`;
}

function amountLines(amount: number): string[] {
  const { net, vat } = splitVat(amount);
  return [`Neto: ${formatClp(net)}`, `IVA (19 %): ${formatClp(vat)}`, `Total: ${formatClp(amount)}`];
}

export interface BillingEmailBase {
  organizationName: string;
  planName: string;
  cycle: BillingCycle;
  amount: number;
  /** Enlace a "Plan y pagos" del panel; `null` si el panel no tiene URL configurada. */
  planUrl: string | null;
}

export interface SubscriptionEmail {
  subject: string;
  text: string;
}

export function subscriptionStartedEmail(
  input: BillingEmailBase & { periodEnd: Date; cardBrand: string | null; cardLast4: string | null; withdrawalUntil: Date },
): SubscriptionEmail {
  return {
    subject: `Tu plan ${input.planName} está activo`,
    text: [
      `Hola, ${input.organizationName}:`,
      "",
      `Contrataste el plan ${input.planName} de Impulza One, con cobro ${cycleLabel(input.cycle)} a ${card(input.cardBrand, input.cardLast4)}.`,
      "",
      ...amountLines(input.amount),
      "",
      `El plan se renueva automáticamente el ${formatDate(input.periodEnd)} por el mismo monto. Puedes cancelarlo cuando quieras desde "Plan y pagos" en tu panel, sin trámites: seguirá activo hasta el fin del período pagado.`,
      "",
      `Derecho a retracto: hasta el ${formatDate(input.withdrawalUntil)} puedes cancelar y recibir el reembolso total desde el mismo lugar (Ley 19.496, art. 3 bis).`,
      ...(input.planUrl ? ["", `Plan y pagos: ${input.planUrl}`] : []),
      "",
      "Este correo es tu comprobante de pago. La boleta electrónica llegará por separado.",
    ].join("\n"),
  };
}

export function renewalChargedEmail(
  input: BillingEmailBase & { periodEnd: Date; cardBrand: string | null; cardLast4: string | null },
): SubscriptionEmail {
  return {
    subject: `Renovamos tu plan ${input.planName}`,
    text: [
      `Hola, ${input.organizationName}:`,
      "",
      `Cobramos la renovación ${cycleLabel(input.cycle)} de tu plan ${input.planName} a ${card(input.cardBrand, input.cardLast4)}.`,
      "",
      ...amountLines(input.amount),
      "",
      `Próxima renovación: ${formatDate(input.periodEnd)}. Puedes cancelar cuando quieras desde "Plan y pagos".`,
      ...(input.planUrl ? ["", `Plan y pagos: ${input.planUrl}`] : []),
      "",
      "Este correo es tu comprobante de pago. La boleta electrónica llegará por separado.",
    ].join("\n"),
  };
}

export function chargeFailedEmail(input: BillingEmailBase & { graceEndsAt: Date; nextRetryAt: Date | null }): SubscriptionEmail {
  return {
    subject: `No pudimos cobrar tu plan ${input.planName}`,
    text: [
      `Hola, ${input.organizationName}:`,
      "",
      `El banco rechazó el cobro de ${formatClp(input.amount)} de tu plan ${input.planName}. Tu plan sigue activo mientras lo resolvemos.`,
      "",
      input.nextRetryAt
        ? `Volveremos a intentarlo el ${formatDate(input.nextRetryAt)}. Revisa que tu tarjeta tenga cupo o inscribe otra desde "Plan y pagos".`
        : `Ya no quedan reintentos. Inscribe otra tarjeta desde "Plan y pagos" antes del ${formatDate(input.graceEndsAt)}.`,
      "",
      `Si no se resuelve antes del ${formatDate(input.graceEndsAt)}, tu cuenta pasará al plan Gratis. No perderás nada de lo que creaste: solo no podrás crear más allá de los límites de ese plan.`,
      ...(input.planUrl ? ["", `Plan y pagos: ${input.planUrl}`] : []),
    ].join("\n"),
  };
}

export function subscriptionEndedEmail(input: { organizationName: string; planName: string; planUrl: string | null; reason: "payment_failed" | "canceled" }): SubscriptionEmail {
  return {
    subject: `Tu cuenta pasó al plan Gratis`,
    text: [
      `Hola, ${input.organizationName}:`,
      "",
      input.reason === "payment_failed"
        ? `No pudimos cobrar tu plan ${input.planName} después de varios intentos, así que tu cuenta pasó al plan Gratis.`
        : `Tu plan ${input.planName} terminó, como pediste, y tu cuenta pasó al plan Gratis.`,
      "",
      "No perdiste nada de lo que creaste: tus páginas, contactos y datos siguen ahí. Solo no podrás crear más allá de los límites del plan Gratis.",
      "",
      "Puedes volver a contratar un plan cuando quieras.",
      ...(input.planUrl ? ["", `Plan y pagos: ${input.planUrl}`] : []),
    ].join("\n"),
  };
}

export function subscriptionCanceledEmail(input: { organizationName: string; planName: string; activeUntil: Date; planUrl: string | null }): SubscriptionEmail {
  return {
    subject: `Cancelaste tu plan ${input.planName}`,
    text: [
      `Hola, ${input.organizationName}:`,
      "",
      `Recibimos la cancelación de tu plan ${input.planName}. No volveremos a cobrarte.`,
      "",
      `Tu plan sigue activo hasta el ${formatDate(input.activeUntil)}. Después, tu cuenta pasa al plan Gratis sin perder nada de lo que creaste.`,
      "",
      `¿Cambiaste de opinión? Puedes reanudarlo antes de esa fecha desde "Plan y pagos".`,
      ...(input.planUrl ? ["", `Plan y pagos: ${input.planUrl}`] : []),
    ].join("\n"),
  };
}

export function withdrawalRefundedEmail(input: { organizationName: string; planName: string; refundedAmount: number; planUrl: string | null }): SubscriptionEmail {
  return {
    subject: `Reembolsamos tu plan ${input.planName}`,
    text: [
      `Hola, ${input.organizationName}:`,
      "",
      `Ejerciste tu derecho a retracto (Ley 19.496, art. 3 bis): cancelamos tu plan ${input.planName} y reembolsamos ${formatClp(input.refundedAmount)} al mismo medio de pago.`,
      "",
      "Según tu banco, el reembolso puede tardar algunos días hábiles en verse en tu estado de cuenta.",
      "",
      "Tu cuenta pasó al plan Gratis y conserva todo lo que creaste.",
      ...(input.planUrl ? ["", `Plan y pagos: ${input.planUrl}`] : []),
    ].join("\n"),
  };
}

/** Reembolso hecho por el equipo (F4.6d), fuera del retracto: un cobro por error, un duplicado. */
export function paymentRefundedEmail(input: { organizationName: string; planName: string; refundedAmount: number; planUrl: string | null }): SubscriptionEmail {
  return {
    subject: `Te devolvimos ${formatClp(input.refundedAmount)}`,
    text: [
      `Hola, ${input.organizationName}:`,
      "",
      `Reembolsamos ${formatClp(input.refundedAmount)} de un cobro de tu plan ${input.planName} al mismo medio de pago.`,
      "",
      "Según tu banco, el reembolso puede tardar algunos días hábiles en verse en tu estado de cuenta.",
      ...(input.planUrl ? ["", `Plan y pagos: ${input.planUrl}`] : []),
    ].join("\n"),
  };
}
