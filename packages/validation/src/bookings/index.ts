import { z } from "zod";
import { plainTextSchema, safeUrlSchema } from "../blocks/primitives.js";
import { isValidTimeZone } from "./timezone.js";

export * from "./timezone.js";
export * from "./availability.js";

// Reservas (F5.1). Esquemas compartidos por la API (que siempre revalida) y el panel.

export const DEFAULT_BOOKING_TIME_ZONE = "America/Santiago";
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miércoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sábado",
  sun: "Domingo",
};
/** Cada cuántos minutos se ofrece una hora de inicio. */
export const SLOT_INTERVALS = [10, 15, 20, 30, 45, 60] as const;
export const MAX_WINDOWS_PER_DAY = 4;

/** `HH:MM` (00:00–23:59) o `24:00` como fin del día. */
const timeOfDaySchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Usa el formato HH:MM, por ejemplo 09:30.");

export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return hours * 60 + minutes;
}

const windowSchema = z
  .object({ start: timeOfDaySchema, end: timeOfDaySchema })
  .refine((window) => window.start !== "24:00", { message: "La hora de inicio no puede ser 24:00.", path: ["start"] })
  .refine((window) => minutesOfDay(window.start) < minutesOfDay(window.end), {
    message: "La hora de término tiene que ser posterior a la de inicio.",
    path: ["end"],
  });

/** Tramos de un día: ordenados y sin solaparse. */
const dayWindowsSchema = z
  .array(windowSchema)
  .max(MAX_WINDOWS_PER_DAY)
  .superRefine((windows, ctx) => {
    const sorted = [...windows].sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start));
    for (let i = 1; i < sorted.length; i++) {
      if (minutesOfDay(sorted[i]!.start) < minutesOfDay(sorted[i - 1]!.end)) {
        ctx.addIssue({ code: "custom", message: "Los tramos del día no pueden solaparse.", path: [i] });
      }
    }
  })
  .transform((windows) => [...windows].sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start)));

export const weeklyHoursSchema = z.object({
  mon: dayWindowsSchema,
  tue: dayWindowsSchema,
  wed: dayWindowsSchema,
  thu: dayWindowsSchema,
  fri: dayWindowsSchema,
  sat: dayWindowsSchema,
  sun: dayWindowsSchema,
});
export type WeeklyHours = z.infer<typeof weeklyHoursSchema>;

/** Horario inicial razonable: lunes a viernes 09:00–13:00 y 15:00–19:00, sábado 10:00–14:00. */
export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  mon: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }],
  tue: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }],
  wed: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }],
  thu: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }],
  fri: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }],
  sat: [{ start: "10:00", end: "14:00" }],
  sun: [],
};

export const bookingSettingsSchema = z.object({
  enabled: z.boolean(),
  timeZone: z.string().refine(isValidTimeZone, { message: "Zona horaria desconocida." }),
  weeklyHours: weeklyHoursSchema,
  /** Anticipación mínima: no se puede reservar para dentro de menos de esto. */
  minNoticeMinutes: z.number().int().min(0).max(14 * 24 * 60),
  /** Horizonte: hasta cuántos días hacia adelante se puede reservar. */
  maxAdvanceDays: z.number().int().min(1).max(365),
  /** Margen libre entre una reserva y la siguiente. */
  bufferMinutes: z.number().int().min(0).max(240),
  slotIntervalMinutes: z
    .number()
    .int()
    .refine((value) => (SLOT_INTERVALS as readonly number[]).includes(value), { message: `Elige uno de: ${SLOT_INTERVALS.join(", ")} minutos.` }),
});
export type BookingSettingsInput = z.infer<typeof bookingSettingsSchema>;

export const DEFAULT_BOOKING_SETTINGS: BookingSettingsInput = {
  enabled: false,
  timeZone: DEFAULT_BOOKING_TIME_ZONE,
  weeklyHours: DEFAULT_WEEKLY_HOURS,
  minNoticeMinutes: 120,
  maxAdvanceDays: 60,
  bufferMinutes: 0,
  slotIntervalMinutes: 30,
};

/** Campos de un servicio sin la regla cruzada del precio (base de la creación y de la edición). */
export const bookableServiceFieldsSchema = z.object({
  name: plainTextSchema(120),
  description: plainTextSchema(500).optional(),
  durationMinutes: z.number().int().min(5, "La duración mínima es 5 minutos.").max(480, "La duración máxima es 8 horas."),
  priceAmount: z.number().int().min(0).optional(),
  priceCurrency: z.string().length(3).toUpperCase().optional(),
  /** Enlace de pago del propio negocio (Impulza no cobra: decisión #6). */
  paymentUrl: safeUrlSchema.optional(),
  active: z.boolean().default(true),
});

export const bookableServiceSchema = bookableServiceFieldsSchema.refine(
  (service) => (service.priceAmount === undefined) === (service.priceCurrency === undefined),
  { message: "El precio necesita monto y moneda.", path: ["priceCurrency"] },
);
export type BookableServiceInput = z.infer<typeof bookableServiceSchema>;

/**
 * Edición: cualquier subconjunto de campos; `null` borra un opcional (descripción, precio, enlace).
 * El servidor mezcla con lo guardado y valida el resultado con `bookableServiceSchema`.
 */
export const updateBookableServiceSchema = z
  .object({
    name: plainTextSchema(120),
    description: plainTextSchema(500).nullable(),
    durationMinutes: bookableServiceFieldsSchema.shape.durationMinutes,
    priceAmount: z.number().int().min(0).nullable(),
    priceCurrency: z.string().length(3).toUpperCase().nullable(),
    paymentUrl: safeUrlSchema.nullable(),
    active: z.boolean(),
    position: z.number().int().min(0).max(10_000),
  })
  .partial();
export type UpdateBookableServiceInput = z.infer<typeof updateBookableServiceSchema>;

/** Servicios por sitio (tope técnico; un límite por plan es la decisión #4). */
export const MAX_SERVICES_PER_SITE = 50;

export const bookingBlackoutSchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: plainTextSchema(120).optional(),
  })
  .refine((blackout) => Date.parse(blackout.endsAt) > Date.parse(blackout.startsAt), {
    message: "El término tiene que ser posterior al inicio.",
    path: ["endsAt"],
  })
  .refine((blackout) => Date.parse(blackout.endsAt) - Date.parse(blackout.startsAt) <= 366 * 24 * 3_600_000, {
    message: "Un bloqueo puede durar hasta un año.",
    path: ["endsAt"],
  });
export type BookingBlackoutInput = z.infer<typeof bookingBlackoutSchema>;

/** Consulta de horarios libres: servicio, primer día local y cuántos días (hasta 31). */
export const bookingAvailabilityQuerySchema = z.object({
  serviceId: z.uuid(),
  from: z.iso.date(),
  days: z.coerce.number().int().min(1).max(31).default(7),
});
export type BookingAvailabilityQuery = z.infer<typeof bookingAvailabilityQuerySchema>;

/**
 * Decimales de la unidad mínima de una moneda (ISO 4217, según `Intl`): 0 para CLP, 2 para USD.
 * Mismo criterio que `formatPrice` del render público: un precio se guarda como entero en esa unidad.
 */
export function currencyFractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("es-CL", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}
