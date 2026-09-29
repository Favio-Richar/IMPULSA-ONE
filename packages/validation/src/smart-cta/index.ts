import { z } from "zod";
import { wallTimeOf } from "../bookings/timezone.js";
import { minutesOfDay, type WeeklyHours } from "../bookings/index.js";

// Smart CTA (F6.6). La acción principal de la página (PP5) puede cambiar según reglas de un
// catálogo cerrado: fuera del horario del sitio, tipo de dispositivo, campaña (UTM) o sin reservas
// disponibles. Isomorfo: la API valida las reglas al guardarlas y `apps/web` las evalúa en cada
// visita con la hora, el dispositivo y la campaña reales — los datos de la página siguen en caché.
// Sin geolocalización.

export const SMART_CTA_DEVICES = ["mobile", "tablet", "desktop"] as const;
export type SmartCtaDevice = (typeof SMART_CTA_DEVICES)[number];

export const MAX_SMART_CTA_RULES = 5;

/** Valor de campaña: se compara sin mayúsculas ni espacios de más, igual que las dimensiones UTM (F3.6). */
const utmValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .transform((value) => normalizeUtm(value));

export const smartCtaConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("outside_hours") }),
  z.object({ kind: z.literal("device"), device: z.enum(SMART_CTA_DEVICES) }),
  z.object({ kind: z.literal("utm_source"), value: utmValueSchema }),
  z.object({ kind: z.literal("utm_campaign"), value: utmValueSchema }),
  z.object({ kind: z.literal("bookings_unavailable") }),
]);
export type SmartCtaCondition = z.infer<typeof smartCtaConditionSchema>;
export type SmartCtaConditionKind = SmartCtaCondition["kind"];

export const SMART_CTA_CONDITION_LABELS: Record<SmartCtaConditionKind, string> = {
  outside_hours: "Fuera del horario de atención",
  device: "Según el dispositivo",
  utm_source: "Visitas desde una fuente (utm_source)",
  utm_campaign: "Visitas de una campaña (utm_campaign)",
  bookings_unavailable: "Cuando no quedan horas para reservar",
};

/** Lo que guarda el panel: regla → bloque de acción que pasa a ser el principal. */
export const smartCtaRuleSchema = z.object({ condition: smartCtaConditionSchema, blockId: z.uuid() });
export const smartCtaSchema = z.object({ rules: z.array(smartCtaRuleSchema).max(MAX_SMART_CTA_RULES) });
export type SmartCtaRule = z.infer<typeof smartCtaRuleSchema>;
export type SmartCta = z.infer<typeof smartCtaSchema>;

/** Lo que recibe el sitio público: el bloque por su posición publicada, nunca por id. */
export interface PublicSmartCtaRule {
  condition: SmartCtaCondition;
  position: number;
}

export interface SmartCtaContext {
  now: Date;
  device: SmartCtaDevice | null;
  utm: { source?: string | null; campaign?: string | null };
  /** Horario del sitio (el de reservas). Sin horario, "fuera de horario" nunca se cumple. */
  hours: { timeZone: string; weeklyHours: WeeklyHours } | null;
  /** `null` = no se consultó o no se pudo saber: la regla no se cumple (nunca se adivina). */
  bookingsAvailable: boolean | null;
}

export function normalizeUtm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 80);
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** `true` si `now` cae dentro de algún tramo del horario, en la zona horaria del negocio. */
export function isWithinHours(now: Date, timeZone: string, weeklyHours: WeeklyHours): boolean {
  const wall = wallTimeOf(now, timeZone);
  const weekday = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
  const minutes = wall.hour * 60 + wall.minute;
  return weeklyHours[WEEKDAY_KEYS[weekday]!].some((window) => minutes >= minutesOfDay(window.start) && minutes < minutesOfDay(window.end));
}

export function conditionMatches(condition: SmartCtaCondition, context: SmartCtaContext): boolean {
  switch (condition.kind) {
    case "outside_hours":
      return context.hours !== null && !isWithinHours(context.now, context.hours.timeZone, context.hours.weeklyHours);
    case "device":
      return context.device === condition.device;
    case "utm_source":
      return context.utm.source ? normalizeUtm(context.utm.source) === condition.value : false;
    case "utm_campaign":
      return context.utm.campaign ? normalizeUtm(context.utm.campaign) === condition.value : false;
    case "bookings_unavailable":
      return context.bookingsAvailable === false;
  }
}

/** Posición del bloque que debe ser el principal: la de la primera regla que se cumple, o `null` (se queda el de siempre). */
export function evaluateSmartCta(rules: PublicSmartCtaRule[], context: SmartCtaContext): number | null {
  return rules.find((rule) => conditionMatches(rule.condition, context))?.position ?? null;
}

/** ¿Hace falta saber si quedan reservas? Solo entonces `apps/web` lo consulta. */
export function needsBookingAvailability(rules: PublicSmartCtaRule[]): boolean {
  return rules.some((rule) => rule.condition.kind === "bookings_unavailable");
}
