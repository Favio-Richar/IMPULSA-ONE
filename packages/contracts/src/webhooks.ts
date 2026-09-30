import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Webhooks salientes (F7.2, ADR-017). Nunca incluyen el secreto, salvo `webhookSecretResponse`, que
// solo lo devuelven la creación y la rotación (se muestra una sola vez).

const deliveryStatus = z.enum(["PENDING", "SUCCEEDED", "FAILED", "SKIPPED"]);

export const webhookEndpointResponse = z.object({
  id: uuid,
  url: z.string(),
  description: z.string().nullable(),
  events: z.array(z.string()),
  active: z.boolean(),
  /** `gone` (el destino respondió 410) o `too_many_failures`. `null` si lo pausó una persona. */
  disabledReason: z.enum(["gone", "too_many_failures"]).nullable(),
  disabledAt: isoDateTime.nullable(),
  consecutiveFailures: z.number().int(),
  lastSuccessAt: isoDateTime.nullable(),
  lastFailureAt: isoDateTime.nullable(),
  /** Últimos 4 caracteres del secreto, para reconocerlo. */
  secretHint: z.string(),
  deliveriesLast7Days: z.object({ succeeded: z.number().int(), failed: z.number().int(), pending: z.number().int() }),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const webhookSecretResponse = z.object({
  endpoint: webhookEndpointResponse,
  /** Secreto de firma `whsec_…`. Solo aparece en esta respuesta. */
  secret: z.string(),
});

/** Una entrega. La carga útil solo en el detalle (lleva datos de clientes). */
export const webhookDeliveryResponse = z.object({
  id: uuid,
  eventId: uuid,
  eventType: z.string(),
  status: deliveryStatus,
  attempts: z.number().int(),
  nextAttemptAt: isoDateTime.nullable(),
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  lastDurationMs: z.number().int().nullable(),
  deliveredAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});

export const webhookDeliveryDetailResponse = webhookDeliveryResponse.extend({ payload: z.unknown() });

export type WebhookEndpointResponse = z.infer<typeof webhookEndpointResponse>;
export type WebhookSecretResponse = z.infer<typeof webhookSecretResponse>;
export type WebhookDeliveryResponse = z.infer<typeof webhookDeliveryResponse>;
export type WebhookDeliveryDetailResponse = z.infer<typeof webhookDeliveryDetailResponse>;
