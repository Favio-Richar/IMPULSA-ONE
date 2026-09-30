// Correos de pedidos (F5.5), en texto plano como los de reservas. Asuntos sin saltos de línea.

export interface OrderMessageData {
  siteName: string;
  productName: string;
  quantity: number;
  unitPriceAmount: number;
  totalAmount: number;
  priceCurrency: string;
  paymentUrl: string | null;
  /** Enlace "Tu pedido" (F5.9): solo si el pedido se cobra con la cuenta conectada del negocio. */
  statusUrl?: string | null;
}

export interface OrderEmailContent {
  subject: string;
  text: string;
}

function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

/** Monto en la unidad mínima de la moneda, con su formato local ("$12.000", "US$19,90"). */
export function formatMoneyAmount(amount: number, currency: string): string {
  const formatter = new Intl.NumberFormat("es-CL", { style: "currency", currency });
  return formatter.format(amount / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2));
}

function lines(data: OrderMessageData): string[] {
  return [
    `${data.quantity} × ${data.productName} (${formatMoneyAmount(data.unitPriceAmount, data.priceCurrency)} c/u)`,
    `Total: ${formatMoneyAmount(data.totalAmount, data.priceCurrency)}`,
  ];
}

export function orderReceivedEmail(data: OrderMessageData): OrderEmailContent {
  return {
    subject: oneLine(`Recibimos tu pedido en ${data.siteName}`),
    text: [
      "¡Gracias! Tu pedido quedó registrado:",
      "",
      ...lines(data),
      "",
      ...(data.statusUrl
        ? ["Puedes pagarlo con Mercado Pago y ver su estado aquí (el pago lo recibe directamente el negocio):", data.statusUrl, ""]
        : data.paymentUrl
          ? ["Puedes pagarlo aquí (el pago lo recibe directamente el negocio):", data.paymentUrl, ""]
          : ["El negocio te contactará para coordinar el pago y la entrega.", ""]),
      `${data.siteName}`,
    ].join("\n"),
  };
}

export type OrderStatusNotice = "PAID" | "DELIVERED" | "CANCELLED";

const STATUS_TEXT: Record<OrderStatusNotice, { subject: string; body: string }> = {
  PAID: { subject: "Confirmamos el pago de tu pedido", body: "El negocio confirmó el pago de tu pedido:" },
  DELIVERED: { subject: "Tu pedido fue entregado", body: "Tu pedido figura como entregado:" },
  CANCELLED: { subject: "Tu pedido fue cancelado", body: "Tu pedido fue cancelado. Si tienes dudas, contacta al negocio:" },
};

export function orderStatusEmail(status: OrderStatusNotice, data: OrderMessageData): OrderEmailContent {
  const text = STATUS_TEXT[status];
  return {
    subject: oneLine(`${text.subject} en ${data.siteName}`),
    text: [text.body, "", ...lines(data), "", `${data.siteName}`].join("\n"),
  };
}

/** Pago confirmado por Mercado Pago (F5.9): no lo marcó el negocio a mano. */
export function orderPaidOnlineEmail(data: OrderMessageData): OrderEmailContent {
  return {
    subject: oneLine(`Recibimos el pago de tu pedido en ${data.siteName}`),
    text: [
      "Mercado Pago confirmó el pago de tu pedido. El negocio ya fue avisado:",
      "",
      ...lines(data),
      "",
      ...(data.statusUrl ? ["Estado de tu pedido:", data.statusUrl, ""] : []),
      `${data.siteName}`,
    ].join("\n"),
  };
}

export interface OwnerOrderNoticeData extends OrderMessageData {
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  deliveryAddress: string | null;
  note: string | null;
  ordersUrl: string | null;
}

export function ownerNewOrderEmail(data: OwnerOrderNoticeData): OrderEmailContent {
  return {
    subject: oneLine(`Nuevo pedido: ${data.quantity} × ${data.productName} de ${data.customerName}`),
    text: [
      `Nuevo pedido en ${data.siteName}.`,
      "",
      ...lines(data),
      "",
      `Cliente: ${data.customerName}`,
      `Correo: ${data.customerEmail}`,
      ...(data.customerPhone ? [`Teléfono: ${data.customerPhone}`] : []),
      ...(data.deliveryAddress ? [`Dirección de entrega: ${data.deliveryAddress}`] : []),
      ...(data.note ? [`Comentario: ${data.note}`] : []),
      ...(data.ordersUrl ? ["", `Tus pedidos: ${data.ordersUrl}`] : []),
    ].join("\n"),
  };
}

export interface OwnerOrderPaymentData extends OrderMessageData {
  customerName: string;
  /** Id del pago en Mercado Pago (para buscarlo en la cuenta del negocio). */
  paymentId: string;
  ordersUrl: string | null;
}

/** Aviso al negocio: Mercado Pago confirmó el pago de un pedido (F5.9). */
export function ownerOrderPaidOnlineEmail(data: OwnerOrderPaymentData): OrderEmailContent {
  return {
    subject: oneLine(`Pago recibido: ${data.quantity} × ${data.productName} de ${data.customerName}`),
    text: [
      `Mercado Pago confirmó el pago de un pedido en ${data.siteName}. El dinero está en tu cuenta de Mercado Pago.`,
      "",
      ...lines(data),
      "",
      `Cliente: ${data.customerName}`,
      `Pago en Mercado Pago: ${data.paymentId}`,
      "Recuerda emitir la boleta de esta venta: la relación con el comprador es de tu negocio.",
      ...(data.ordersUrl ? ["", `Tus pedidos: ${data.ordersUrl}`] : []),
    ].join("\n"),
  };
}

/** Aviso al negocio: el comprador pagó un pedido que ya estaba cancelado (F5.9). Hay que devolverle el dinero. */
export function ownerCancelledOrderPaidEmail(data: OwnerOrderPaymentData): OrderEmailContent {
  return {
    subject: oneLine(`Atención: pagaron un pedido cancelado (${data.productName}, ${data.customerName})`),
    text: [
      `Mercado Pago confirmó el pago de un pedido que estaba cancelado en ${data.siteName}.`,
      "",
      ...lines(data),
      "",
      `Cliente: ${data.customerName}`,
      `Pago en Mercado Pago: ${data.paymentId}`,
      "Reactiva el pedido si puedes entregarlo, o devuelve el dinero desde tu cuenta de Mercado Pago.",
      ...(data.ordersUrl ? ["", `Tus pedidos: ${data.ordersUrl}`] : []),
    ].join("\n"),
  };
}
