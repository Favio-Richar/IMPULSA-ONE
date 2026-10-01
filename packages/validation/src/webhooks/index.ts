import { z } from "zod";
import { isPublicHostname } from "../domains/index.js";
import { plainTextSchema } from "../blocks/primitives.js";

// Webhooks salientes (F7.2, ADR-017): lo que comparten la API y el panel. La firma, el envío y la
// protección SSRF al conectar viven en `@impulza/webhooks` (solo servidor).

export const WEBHOOK_EVENT_TYPES = ["contact.created", "booking.created", "booking.cancelled", "order.created", "order.paid"] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
/** El evento de prueba del panel: siempre se puede enviar, no se suscribe. */
export const WEBHOOK_PING_EVENT = "ping" as const;
export type WebhookDeliveredEvent = WebhookEventType | typeof WEBHOOK_PING_EVENT;

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, { label: string; description: string }> = {
  "contact.created": { label: "Contacto nuevo", description: "Alguien deja sus datos en un formulario, reserva o pide, o lo agregas a mano." },
  "booking.created": { label: "Reserva nueva", description: "Se toma una hora (también las que esperan la seña)." },
  "booking.cancelled": { label: "Reserva cancelada", description: "La cancela el cliente o tu equipo, o vence el plazo para pagar la seña." },
  "order.created": { label: "Pedido nuevo", description: "Alguien pide un producto desde tu página." },
  "order.paid": { label: "Pedido pagado", description: "Mercado Pago confirma el pago o tu equipo lo marca pagado." },
};

/** Versión del formato de la carga útil: cambia solo si se rompe la compatibilidad. */
export const WEBHOOK_API_VERSION = "2026-09-30";
export const MAX_WEBHOOK_ENDPOINTS = 10;

const INVALID_URL = "Pega la dirección completa que te dio la otra herramienta (empieza con https://).";

/**
 * URL de destino, validada por su forma (ADR-017 §1): `https`, sin usuario ni contraseña, sin puerto
 * no estándar y con un nombre de host público (nunca una IP literal ni un dominio reservado). Que el
 * nombre no resuelva a una IP privada se verifica **al conectar**, en el servidor.
 */
export const webhookUrlSchema = z
  .string()
  .trim()
  .max(2000, "La dirección es demasiado larga.")
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: INVALID_URL });
      return;
    }
    if (url.protocol !== "https:") {
      ctx.addIssue({ code: "custom", message: "La dirección tiene que usar https:// (conexión cifrada)." });
      return;
    }
    if (url.username || url.password) {
      ctx.addIssue({ code: "custom", message: "La dirección no puede llevar usuario ni contraseña." });
      return;
    }
    if (url.port !== "" && url.port !== "443") {
      ctx.addIssue({ code: "custom", message: "Solo se admite el puerto estándar de https." });
      return;
    }
    if (!isPublicHostname(url.hostname.replace(/\.$/, ""))) {
      ctx.addIssue({ code: "custom", message: "La dirección tiene que apuntar a un sitio público de internet (no una IP ni una red interna)." });
    }
  });

const eventsSchema = z
  .array(z.enum(WEBHOOK_EVENT_TYPES))
  .min(1, "Elige al menos un evento.")
  .transform((events) => [...new Set(events)].sort() as WebhookEventType[]);

export const createWebhookEndpointSchema = z.object({
  url: webhookUrlSchema,
  description: plainTextSchema(120).optional(),
  events: eventsSchema,
});
export type CreateWebhookEndpointInput = z.infer<typeof createWebhookEndpointSchema>;

export const updateWebhookEndpointSchema = z
  .object({
    url: webhookUrlSchema,
    description: plainTextSchema(120).nullable(),
    events: eventsSchema,
    /** Pausar o reanudar. Reanudar un destino desactivado por fallas lo vuelve a intentar. */
    active: z.boolean(),
  })
  .partial();
export type UpdateWebhookEndpointInput = z.infer<typeof updateWebhookEndpointSchema>;

/** Prueba desde el panel: un `ping`, o el ejemplo de un evento para que Zapier o Make aprendan sus campos. */
// Sin cuerpo (el botón "Probar" de siempre) es un `ping`.
export const sendWebhookTestSchema = z
  .object({ eventType: z.enum([WEBHOOK_PING_EVENT, ...WEBHOOK_EVENT_TYPES]).default(WEBHOOK_PING_EVENT) })
  .default({ eventType: WEBHOOK_PING_EVENT });
export type SendWebhookTestInput = z.infer<typeof sendWebhookTestSchema>;

export const WEBHOOK_DELIVERY_STATUSES = ["PENDING", "SUCCEEDED", "FAILED", "SKIPPED"] as const;
export const listWebhookDeliveriesQuerySchema = z.object({ status: z.enum(WEBHOOK_DELIVERY_STATUSES).optional() });
export type ListWebhookDeliveriesQuery = z.infer<typeof listWebhookDeliveriesQuerySchema>;

// --- Carga útil (lo que recibe el negocio) ---

export interface WebhookCustomer {
  name: string;
  email: string;
  phone: string | null;
}

export interface WebhookEnvelope<T = unknown> {
  /** Id estable del evento: el mismo en cada reintento (para descartar duplicados). */
  id: string;
  type: WebhookDeliveredEvent;
  apiVersion: string;
  createdAt: string;
  organizationId: string;
  /** `true` solo en los envíos de prueba del panel (datos de ejemplo): el receptor puede ignorarlos. */
  test: boolean;
  data: T;
}

/** Ejemplos de cada evento para el panel (guía de Zapier y Make). Datos inventados. */
export const WEBHOOK_SAMPLE_DATA: Record<WebhookDeliveredEvent, unknown> = {
  ping: { message: "Evento de prueba desde Impulza One." },
  "contact.created": {
    contact: { id: "0b6f9a0e-6a3c-4d1f-9b1a-2f3c4d5e6f70", name: "Ana Pérez", email: "ana@ejemplo.cl", phone: "+56912345678", source: "form", marketingConsent: true, createdAt: "2026-09-30T14:05:00.000Z" },
  },
  "booking.created": {
    booking: {
      id: "5d8e7f60-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
      siteId: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
      serviceName: "Corte y barba",
      startsAt: "2026-10-02T13:00:00.000Z",
      endsAt: "2026-10-02T13:45:00.000Z",
      timeZone: "America/Santiago",
      status: "CONFIRMED",
      priceAmount: 18000,
      priceCurrency: "CLP",
      deposit: { amount: 5000, paidAt: "2026-09-30T14:07:00.000Z", refundedAmount: 0 },
      customer: { name: "Ana Pérez", email: "ana@ejemplo.cl", phone: "+56912345678" },
      note: null,
    },
  },
  "booking.cancelled": {
    booking: {
      id: "5d8e7f60-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
      siteId: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
      serviceName: "Corte y barba",
      startsAt: "2026-10-02T13:00:00.000Z",
      endsAt: "2026-10-02T13:45:00.000Z",
      timeZone: "America/Santiago",
      status: "CANCELLED",
      priceAmount: 18000,
      priceCurrency: "CLP",
      deposit: null,
      customer: { name: "Ana Pérez", email: "ana@ejemplo.cl", phone: "+56912345678" },
      note: null,
    },
  },
  "order.created": {
    order: {
      id: "7c6b5a49-3827-4165-9f4e-3d2c1b0a9f8e",
      siteId: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
      productName: "Torta de chocolate (Mediana)",
      productKind: "PHYSICAL",
      quantity: 2,
      unitPriceAmount: 12990,
      totalAmount: 25980,
      priceCurrency: "CLP",
      discountAmount: 0,
      couponCode: null,
      status: "NEW",
      paidAt: null,
      onlinePayment: null,
      customer: { name: "Ana Pérez", email: "ana@ejemplo.cl", phone: "+56912345678" },
      deliveryAddress: "Av. Siempre Viva 742, Santiago",
      note: null,
      items: [
        { productName: "Torta de chocolate", variantName: "Mediana", productKind: "PHYSICAL", unitPriceAmount: 12990, quantity: 2, lineTotalAmount: 25980 },
      ],
    },
  },
  "order.paid": {
    order: {
      id: "7c6b5a49-3827-4165-9f4e-3d2c1b0a9f8e",
      siteId: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
      productName: "Torta de chocolate (Mediana)",
      productKind: "PHYSICAL",
      quantity: 2,
      unitPriceAmount: 12990,
      totalAmount: 25980,
      priceCurrency: "CLP",
      discountAmount: 0,
      couponCode: null,
      status: "PAID",
      paidAt: "2026-09-30T14:20:00.000Z",
      onlinePayment: { provider: "MERCADO_PAGO", paymentId: "1234567890" },
      customer: { name: "Ana Pérez", email: "ana@ejemplo.cl", phone: "+56912345678" },
      deliveryAddress: "Av. Siempre Viva 742, Santiago",
      note: null,
      items: [
        { productName: "Torta de chocolate", variantName: "Mediana", productKind: "PHYSICAL", unitPriceAmount: 12990, quantity: 2, lineTotalAmount: 25980 },
      ],
    },
  },
};

/**
 * Cómo verificar la firma en Node.js (guía del panel). Se prueba en `@impulza/webhooks` contra el
 * firmador real: si alguien cambia uno sin el otro, la prueba falla.
 */
export const WEBHOOK_SIGNATURE_SNIPPET = `import { createHmac, timingSafeEqual } from "node:crypto";

// body: el cuerpo tal como llegó (texto, sin reformatear).
export function isFromImpulza(body, header, secret) {
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=")));
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!parts.t || !parts.v1 || age > 300) return false;
  const expected = createHmac("sha256", secret).update(\`\${parts.t}.\${body}\`).digest("hex");
  return expected.length === parts.v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}`;
