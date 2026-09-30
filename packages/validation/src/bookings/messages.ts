// Correos de reservas (F5.4). Funciones puras: las usan la API (confirmación, cancelación, cambio
// de hora, aviso al negocio) y el worker (recordatorio), así el mismo texto sale por los dos
// caminos. Texto plano: el adaptador de correo del proyecto envía texto (ARCHITECTURE.md §5), y un
// texto nunca interpreta HTML de nadie.

export interface BookingMessageData {
  siteName: string;
  serviceName: string;
  startsAt: string;
  timeZone: string;
  priceAmount: number | null;
  priceCurrency: string | null;
  paymentUrl: string | null;
  /** Enlace "gestiona tu reserva"; `null` si la instalación no tiene la URL pública configurada. */
  manageUrl: string | null;
  /** Seña cobrada con Mercado Pago (F5.10), en la moneda del precio. */
  depositAmount?: number | null;
}

export interface EmailContent {
  subject: string;
  text: string;
}

function fractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("es-CL", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** "martes 29 de septiembre, 10:00" en la zona del negocio. */
export function formatBookingWhen(startsAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(startsAt));
}

/** Primera letra en mayúscula para una línea que empieza con la fecha. */
function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("es-CL") + text.slice(1);
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency }).format(amount / 10 ** fractionDigits(currency));
}

function priceLine(data: BookingMessageData): string | null {
  if (data.priceAmount === null || !data.priceCurrency) {
    return null;
  }
  return `Valor: ${money(data.priceAmount, data.priceCurrency)}`;
}

function depositText(data: BookingMessageData): string {
  return data.depositAmount && data.priceCurrency ? money(data.depositAmount, data.priceCurrency) : "";
}

/** "10:30" en la zona del negocio. */
function formatTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-CL", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
}

/** Quita saltos de línea de un texto que va en el asunto (nunca un encabezado inyectado). */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

function detailLines(data: BookingMessageData): string[] {
  return [`${data.serviceName}`, capitalize(formatBookingWhen(data.startsAt, data.timeZone)), ...(priceLine(data) ? [priceLine(data)!] : [])];
}

function manageLines(data: BookingMessageData): string[] {
  return data.manageUrl
    ? ["", "¿Necesitas cancelar o cambiar la hora? Hazlo aquí:", data.manageUrl]
    : ["", "¿Necesitas cancelar o cambiar la hora? Responde este correo o contacta al negocio."];
}

export function bookingConfirmationEmail(data: BookingMessageData): EmailContent {
  return {
    subject: oneLine(`Reserva confirmada en ${data.siteName}`),
    text: [
      "¡Tu reserva está confirmada!",
      "",
      ...detailLines(data),
      ...(data.paymentUrl ? ["", "Si quieres pagar por adelantado, el negocio recibe el pago aquí:", data.paymentUrl] : []),
      ...manageLines(data),
      "",
      `Te esperan en ${data.siteName}.`,
    ].join("\n"),
  };
}

export function bookingReminderEmail(data: BookingMessageData): EmailContent {
  return {
    subject: oneLine(`Recordatorio: tu reserva en ${data.siteName}`),
    text: ["Te recordamos tu reserva:", "", ...detailLines(data), ...manageLines(data)].join("\n"),
  };
}

export function bookingRescheduledEmail(data: BookingMessageData): EmailContent {
  return {
    subject: oneLine(`Cambiaste la hora de tu reserva en ${data.siteName}`),
    text: ["Tu reserva quedó en la nueva hora:", "", ...detailLines(data), ...manageLines(data)].join("\n"),
  };
}

export function bookingCancelledEmail(data: BookingMessageData): EmailContent {
  return {
    subject: oneLine(`Reserva cancelada en ${data.siteName}`),
    text: [
      "Tu reserva quedó cancelada:",
      "",
      `${data.serviceName}`,
      capitalize(formatBookingWhen(data.startsAt, data.timeZone)),
      "",
      "Si fue un error, puedes reservar de nuevo desde la página del negocio.",
    ].join("\n"),
  };
}

/**
 * Reserva que espera la seña (F5.10): la hora queda tomada hasta `paymentDeadline`. El enlace de
 * gestión lleva a "Tu reserva", que tiene el botón para pagar con Mercado Pago.
 */
export function bookingDepositPendingEmail(data: BookingMessageData, paymentDeadline: string): EmailContent {
  return {
    subject: oneLine(`Paga la seña para confirmar tu reserva en ${data.siteName}`),
    text: [
      "Guardamos tu hora. Para confirmarla, paga la seña:",
      "",
      ...detailLines(data),
      `Seña: ${depositText(data)}`,
      "",
      `Tienes hasta las ${formatTime(paymentDeadline, data.timeZone)} para pagarla; si no, la hora se libera.`,
      ...(data.manageUrl ? ["Paga la seña con Mercado Pago aquí (el pago lo recibe directamente el negocio):", data.manageUrl] : []),
      "",
      `${data.siteName}`,
    ].join("\n"),
  };
}

export function bookingDepositPaidEmail(data: BookingMessageData): EmailContent {
  return {
    subject: oneLine(`Recibimos tu seña: reserva confirmada en ${data.siteName}`),
    text: [
      "¡Recibimos tu seña y tu reserva está confirmada!",
      "",
      ...detailLines(data),
      `Seña pagada: ${depositText(data)}`,
      ...manageLines(data),
      "",
      `Te esperan en ${data.siteName}.`,
    ].join("\n"),
  };
}

export function bookingDepositExpiredEmail(data: BookingMessageData): EmailContent {
  return {
    subject: oneLine(`Se liberó tu hora en ${data.siteName}`),
    text: [
      "No recibimos la seña a tiempo, así que la hora quedó libre:",
      "",
      `${data.serviceName}`,
      capitalize(formatBookingWhen(data.startsAt, data.timeZone)),
      "",
      "Si todavía la quieres, puedes reservar de nuevo desde la página del negocio.",
    ].join("\n"),
  };
}

export type OwnerNoticeKind = "created" | "cancelled" | "rescheduled" | "deposit_paid" | "paid_without_slot";

export interface OwnerNoticeData {
  kind: OwnerNoticeKind;
  siteName: string;
  serviceName: string;
  startsAt: string;
  timeZone: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  note: string | null;
  /** Enlace a la agenda del panel. */
  agendaUrl: string | null;
  /** Seña pagada (F5.10): monto ya formateado e id del pago en Mercado Pago. */
  deposit?: { amount: string; paymentId: string } | null;
}

const OWNER_SUBJECTS: Record<OwnerNoticeKind, string> = {
  created: "Nueva reserva",
  cancelled: "Reserva cancelada por el cliente",
  rescheduled: "Un cliente cambió la hora de su reserva",
  deposit_paid: "Nueva reserva con seña pagada",
  paid_without_slot: "Atención: pagaron la seña de una reserva que ya no estaba activa",
};

/** Seña formateada para el aviso al negocio (misma regla de decimales que el resto de los montos). */
export function formatDepositAmount(amount: number, currency: string): string {
  return money(amount, currency);
}

export function ownerBookingNoticeEmail(data: OwnerNoticeData): EmailContent {
  const when = formatBookingWhen(data.startsAt, data.timeZone);
  return {
    subject: oneLine(`${OWNER_SUBJECTS[data.kind]}: ${data.customerName}, ${when}`),
    text: [
      `${OWNER_SUBJECTS[data.kind]} en ${data.siteName}.`,
      "",
      `${data.serviceName} — ${when}`,
      `Cliente: ${data.customerName}`,
      `Correo: ${data.customerEmail}`,
      ...(data.customerPhone ? [`Teléfono: ${data.customerPhone}`] : []),
      ...(data.note ? [`Comentario: ${data.note}`] : []),
      ...(data.deposit ? [`Seña pagada con Mercado Pago: ${data.deposit.amount} (pago ${data.deposit.paymentId}). El dinero está en tu cuenta.`] : []),
      ...(data.kind === "paid_without_slot"
        ? [
            "",
            "La reserva ya no estaba activa (se canceló, o venció el plazo y la hora la tomó otra persona). Reactívala desde tu agenda si la hora sigue libre, ofrécele otra hora al cliente o devuélvele la seña desde tu cuenta de Mercado Pago.",
          ]
        : []),
      ...(data.agendaUrl ? ["", `Tu agenda: ${data.agendaUrl}`] : []),
    ].join("\n"),
  };
}
