import { z } from "zod";

// Medición de terceros (F7.1, ADR-016): el negocio guarda solo identificadores. El script que se
// carga lo arma Impulza con el identificador: nunca código ni URLs del negocio.

/** ID de medición de Google Analytics 4 ("G-" y 4 a 15 letras o dígitos en mayúscula). */
export const GA4_MEASUREMENT_ID = /^G-[A-Z0-9]{4,15}$/;
/** ID del píxel de Meta: solo dígitos. */
export const META_PIXEL_ID = /^\d{10,20}$/;

export const measurementSettingsSchema = z.object({
  ga4MeasurementId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GA4_MEASUREMENT_ID, "Escribe el ID de medición de GA4 tal como aparece en Google Analytics: empieza con «G-», por ejemplo G-AB12CD34EF.")
    .nullable(),
  metaPixelId: z
    .string()
    .trim()
    .regex(META_PIXEL_ID, "Escribe solo los números del ID de tu píxel de Meta (de 10 a 20 dígitos).")
    .nullable(),
});
export type MeasurementSettingsInput = z.infer<typeof measurementSettingsSchema>;

// --- Consentimiento del visitante (ADR-016 §2) ---

/**
 * Versión del aviso de cookies. Subirla vuelve a preguntar a todos los visitantes (p. ej. si cambian
 * las categorías o el texto de lo que se mide).
 */
export const CONSENT_VERSION = 1;
/** La elección se recuerda 6 meses; después se vuelve a preguntar. */
export const CONSENT_MAX_AGE_MS = 182 * 24 * 3_600_000;

export interface ConsentChoice {
  version: number;
  /** Google Analytics 4. */
  analytics: boolean;
  /** Píxel de Meta. */
  marketing: boolean;
  /** Cuándo eligió (ms desde la época). */
  decidedAt: number;
}

const consentChoiceSchema = z.object({
  version: z.number().int(),
  analytics: z.boolean(),
  marketing: z.boolean(),
  decidedAt: z.number().int().positive(),
});

/** Clave por sitio: aceptar en un negocio no vale para otro. */
export function consentStorageKey(siteSlug: string): string {
  return `impulza-consent:${siteSlug}`;
}

/**
 * La elección guardada, o `null` si no hay, está corrupta, es de otra versión del aviso o venció
 * (en todos esos casos se vuelve a preguntar y, mientras tanto, no se mide).
 */
export function parseConsentChoice(raw: string | null, now: number): ConsentChoice | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = consentChoiceSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.version !== CONSENT_VERSION) return null;
  if (parsed.data.decidedAt > now || now - parsed.data.decidedAt > CONSENT_MAX_AGE_MS) return null;
  return parsed.data;
}

// --- Eventos que se envían a los proveedores (ADR-016 §3) ---

/** Conversiones que anuncian los bloques de la página pública. Sin datos personales, nunca. */
export type ConversionEvent =
  | { kind: "whatsapp_click" }
  | { kind: "form_submitted" }
  | { kind: "booking_created" }
  | { kind: "newsletter_signup" }
  | { kind: "order_created"; value: number; currency: string };

export interface ProviderCall {
  provider: "ga4" | "meta";
  /** Nombre del evento en el proveedor. */
  name: string;
  params: Record<string, string | number>;
}

/** Decimales de la unidad mínima de una moneda: el valor se informa en la moneda, no en centavos. */
function toMajorUnits(amount: number, currency: string): number {
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // moneda desconocida: se asume 2
  }
  return amount / 10 ** digits;
}

/**
 * Traducción de una conversión a los eventos estándar de cada proveedor, solo para las categorías
 * con consentimiento. Función pura: la usa el componente de la página y la prueban las unitarias.
 */
export function providerCallsFor(event: ConversionEvent, consent: Pick<ConsentChoice, "analytics" | "marketing">, enabled: { ga4: boolean; meta: boolean }): ProviderCall[] {
  const calls: ProviderCall[] = [];
  const ga4 = consent.analytics && enabled.ga4;
  const meta = consent.marketing && enabled.meta;
  switch (event.kind) {
    case "whatsapp_click":
      if (ga4) calls.push({ provider: "ga4", name: "whatsapp_click", params: {} });
      if (meta) calls.push({ provider: "meta", name: "Contact", params: {} });
      break;
    case "form_submitted":
      if (ga4) calls.push({ provider: "ga4", name: "generate_lead", params: { lead_source: "form" } });
      if (meta) calls.push({ provider: "meta", name: "Lead", params: {} });
      break;
    case "booking_created":
      if (ga4) calls.push({ provider: "ga4", name: "generate_lead", params: { lead_source: "booking" } });
      if (meta) calls.push({ provider: "meta", name: "Schedule", params: {} });
      break;
    // F7.4: la solicitud (la confirmación ocurre después, desde el correo).
    case "newsletter_signup":
      if (ga4) calls.push({ provider: "ga4", name: "sign_up", params: { method: "newsletter" } });
      if (meta) calls.push({ provider: "meta", name: "Lead", params: { content_category: "newsletter" } });
      break;
    case "order_created": {
      const value = toMajorUnits(event.value, event.currency);
      if (ga4) calls.push({ provider: "ga4", name: "begin_checkout", params: { currency: event.currency, value } });
      if (meta) calls.push({ provider: "meta", name: "InitiateCheckout", params: { currency: event.currency, value } });
      break;
    }
  }
  return calls;
}

/** Nombre del evento del navegador con que los bloques anuncian una conversión. */
export const CONVERSION_EVENT_NAME = "impulza:conversion";
