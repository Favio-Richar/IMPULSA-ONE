// Textos y cálculos de "Plan y pagos" (F4.6c). Funciones puras, probadas aparte.

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Santiago" });

export function formatClp(amount: number): string {
  return CLP.format(amount);
}

export function formatDate(iso: string | Date): string {
  return DATE.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** IVA incluido (19 %). Misma regla que `splitVat` de `@impulza/payments` (que no se puede importar
 *  en el navegador): neto = round(total / 1,19) e IVA = el resto, así suman exactamente el total. */
export function vatBreakdown(total: number): { net: number; vat: number } {
  const net = Math.round((total * 100) / 119);
  return { net, vat: total - net };
}

/** Lo que se ahorra pagando el año de una vez frente a 12 meses. `null` si no hay ahorro. */
export function yearlySavings(priceMonthly: number, priceYearly: number): { amount: number; months: number } | null {
  const saved = priceMonthly * 12 - priceYearly;
  if (priceMonthly <= 0 || priceYearly <= 0 || saved <= 0) return null;
  return { amount: saved, months: Math.round(saved / priceMonthly) };
}

/** Fecha del próximo cobro si se contrata hoy: mismo día del mes (o año) siguiente, sin saltarse
 *  un mes corto — igual que `periodEnd` del servidor. Solo para mostrar. */
export function renewalDate(from: Date, cycle: "MONTHLY" | "YEARLY"): Date {
  const date = new Date(from.getTime());
  const day = from.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + (cycle === "MONTHLY" ? 1 : 12));
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return date;
}

/** Resultado del regreso desde la pasarela (`/plan?pago=…`). */
export type PaymentOutcome = "exito" | "rechazado" | "pendiente" | "vencido" | "error";

export const PAYMENT_OUTCOMES: Record<PaymentOutcome, { tone: "success" | "warning" | "danger" | "info"; title: string; body: string }> = {
  exito: {
    tone: "success",
    title: "¡Listo! Tu plan ya está activo",
    body: "Te enviamos el comprobante por correo. Ya puedes usar todo lo que incluye tu nuevo plan.",
  },
  pendiente: {
    tone: "info",
    title: "Estamos confirmando tu pago",
    body: "Webpay no nos respondió a tiempo. No vuelvas a pagar: en unos minutos lo confirmamos y esta página se actualiza sola.",
  },
  rechazado: {
    tone: "warning",
    title: "El pago no se completó",
    body: "El banco no autorizó la tarjeta o cancelaste el pago en Webpay. No se hizo ningún cobro. Puedes intentarlo de nuevo con la misma u otra tarjeta.",
  },
  vencido: {
    tone: "warning",
    title: "El tiempo para pagar se agotó",
    body: "Pasaron más de 30 minutos desde que empezaste. No se hizo ningún cobro: vuelve a elegir tu plan para intentarlo.",
  },
  error: {
    tone: "danger",
    title: "No pudimos completar el pago",
    body: "Algo falló al volver de Webpay. Revisa tu historial de pagos más abajo antes de reintentar; si ves un cobro que no corresponde, escríbenos desde Soporte.",
  },
};

export function parsePaymentOutcome(value: string | null): PaymentOutcome | null {
  return value && value in PAYMENT_OUTCOMES ? (value as PaymentOutcome) : null;
}

/** Por qué un estado de suscripción se ve como se ve. */
export function subscriptionStatusLabel(input: { status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: string; nextChargeAt: string | null }): {
  tone: "success" | "warning" | "danger" | "neutral";
  label: string;
  detail: string;
} {
  if (input.status === "CANCELED") {
    return { tone: "neutral", label: "Terminado", detail: `Terminó el ${formatDate(input.currentPeriodEnd)}. Tu cuenta está en el plan Gratis.` };
  }
  if (input.status === "INCOMPLETE") {
    return { tone: "warning", label: "Confirmando pago", detail: "Estamos confirmando tu primer pago con Webpay." };
  }
  if (input.cancelAtPeriodEnd) {
    return { tone: "warning", label: "Cancelado", detail: `Sigue activo hasta el ${formatDate(input.currentPeriodEnd)}. No se volverá a cobrar.` };
  }
  if (input.status === "PAST_DUE") {
    return {
      tone: "danger",
      label: "Pago pendiente",
      detail: input.nextChargeAt
        ? `No pudimos cobrar la renovación. Reintentaremos el ${formatDate(input.nextChargeAt)}; tu plan sigue activo hasta el ${formatDate(input.currentPeriodEnd)}.`
        : `No pudimos cobrar la renovación. Tu plan sigue activo hasta el ${formatDate(input.currentPeriodEnd)}.`,
    };
  }
  return {
    tone: "success",
    label: "Activo",
    detail: input.nextChargeAt ? `Se renueva el ${formatDate(input.nextChargeAt)}.` : `Vigente hasta el ${formatDate(input.currentPeriodEnd)}.`,
  };
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  APPROVED: "Pagado",
  REJECTED: "Rechazado",
  PENDING: "Confirmando",
  REFUNDED: "Reembolsado",
};

/** Mensaje del servidor (ya escrito para el cliente) o uno genérico honesto. */
export function billingErrorMessage(error: unknown): string {
  const body = (error as { body?: { message?: unknown } } | null)?.body;
  if (body && typeof body.message === "string" && body.message.length > 0) return body.message;
  return "No pudimos completar la acción. Revisa tu conexión e intenta de nuevo.";
}
