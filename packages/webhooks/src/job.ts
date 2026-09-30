/** Cola de entregas de webhooks (API encola, worker entrega). */
export const WEBHOOKS_QUEUE = "webhook-deliveries";

/** Un trabajo = una entrega (fila `WebhookDelivery`); el worker lee todo lo demás de la base. */
export interface WebhookDeliveryJob {
  deliveryId: string;
}
