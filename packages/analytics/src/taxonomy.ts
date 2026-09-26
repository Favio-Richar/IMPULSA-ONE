// Catálogo de tipos de evento de analítica (F3.6, ST §10, ERD §7). Abierto a crecer como
// `Block.type` — la columna es `String` en la base — pero todo lo que el sistema emite pasa por
// esta lista, para que un error de tipeo no termine en un agregado huérfano que nadie consulta.

export const ANALYTICS_EVENT_TYPES = [
  "page_view",
  "block_click",
  "whatsapp_click",
  "form_submit",
  "lead_created",
  "qr_visit",
  "short_link_click",
  // F5.2: una reserva confirmada desde la página pública. Solo la emite el servidor.
  "booking_created",
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export function isAnalyticsEventType(value: string): value is AnalyticsEventType {
  return (ANALYTICS_EVENT_TYPES as readonly string[]).includes(value);
}

/** Los que puede disparar el propio navegador del visitante. El resto nace del lado del servidor
 *  (envío de formulario, contacto creado, resolución de enlace/QR) y nunca se acepta desde afuera:
 *  si no, cualquiera podría fabricar "leads" en el dashboard de otro negocio con un `curl`. */
export const CLIENT_EVENT_TYPES = ["page_view", "block_click", "whatsapp_click"] as const satisfies readonly AnalyticsEventType[];
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export const DEVICE_TYPES = ["mobile", "tablet", "desktop"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export interface UtmParams {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}
