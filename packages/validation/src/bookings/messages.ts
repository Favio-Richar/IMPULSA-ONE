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

function priceLine(data: BookingMessageData): string | null {
  if (data.priceAmount === null || !data.priceCurrency) {
    return null;
  }
  const amount = new Intl.NumberFormat("es-CL", { style: "currency", currency: data.priceCurrency }).format(
    data.priceAmount / 10 ** fractionDigits(data.priceCurrency),
  );
  return `Valor: ${amount}`;
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

export type OwnerNoticeKind = "created" | "cancelled" | "rescheduled";

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
}

const OWNER_SUBJECTS: Record<OwnerNoticeKind, string> = {
  created: "Nueva reserva",
  cancelled: "Reserva cancelada por el cliente",
  rescheduled: "Un cliente cambió la hora de su reserva",
};

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
      ...(data.agendaUrl ? ["", `Tu agenda: ${data.agendaUrl}`] : []),
    ].join("\n"),
  };
}
