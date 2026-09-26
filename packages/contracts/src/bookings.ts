import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Reservas (F5.1). La forma de `weeklyHours` la define `weeklyHoursSchema` en `@impulza/validation`.

const windowResponse = z.object({ start: z.string(), end: z.string() });

export const bookingSettingsResponse = z.object({
  siteId: uuid,
  /** `false` hasta que el negocio guarda su configuración la primera vez. */
  configured: z.boolean(),
  enabled: z.boolean(),
  timeZone: z.string(),
  weeklyHours: z.object({
    mon: z.array(windowResponse),
    tue: z.array(windowResponse),
    wed: z.array(windowResponse),
    thu: z.array(windowResponse),
    fri: z.array(windowResponse),
    sat: z.array(windowResponse),
    sun: z.array(windowResponse),
  }),
  minNoticeMinutes: z.number().int(),
  maxAdvanceDays: z.number().int(),
  bufferMinutes: z.number().int(),
  slotIntervalMinutes: z.number().int(),
});
export type BookingSettingsResponse = z.infer<typeof bookingSettingsResponse>;

export const bookableServiceResponse = z.object({
  id: uuid,
  siteId: uuid,
  name: z.string(),
  description: z.string().nullable(),
  durationMinutes: z.number().int(),
  priceAmount: z.number().int().nullable(),
  priceCurrency: z.string().nullable(),
  paymentUrl: z.string().nullable(),
  active: z.boolean(),
  position: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type BookableServiceResponse = z.infer<typeof bookableServiceResponse>;

export const bookingBlackoutResponse = z.object({
  id: uuid,
  siteId: uuid,
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  reason: z.string().nullable(),
  createdAt: isoDateTime,
});
export type BookingBlackoutResponse = z.infer<typeof bookingBlackoutResponse>;

/** Horarios libres por día local; cada hora es un instante ISO en UTC. */
export const bookingAvailabilityResponse = z.object({
  timeZone: z.string(),
  days: z.array(z.object({ date: z.string(), slots: z.array(z.string()) })),
});
export type BookingAvailabilityResponse = z.infer<typeof bookingAvailabilityResponse>;
