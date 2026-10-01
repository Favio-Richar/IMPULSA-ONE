import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

const bookingStatus = z.enum(["CONFIRMED", "PENDING_PAYMENT", "CANCELLED", "COMPLETED", "NO_SHOW"]);

/** Seña cobrada con la cuenta de Mercado Pago del negocio (F5.10, ADR-013). */
const depositResponse = z.object({
  amount: z.number().int(),
  /** Último estado del pago en Mercado Pago (`approved`, `in_process`, `rejected`…), o `null` si aún no hay intento. */
  status: z.string().nullable(),
  paymentId: z.string().nullable(),
  /** Hasta cuándo se puede pagar; después la hora se libera. */
  deadline: isoDateTime.nullable(),
  paidAt: isoDateTime.nullable(),
  /** Cuánto se devolvió ya (F5.11a), según Mercado Pago. */
  refundedAmount: z.number().int(),
});

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
  calendarFeedToken: z.string().nullable().optional(),
  calendarFeedUrl: z.string().nullable().optional(),
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
  /** Seña que se cobra al reservar (F5.10), si el negocio tiene Mercado Pago conectado. */
  depositAmount: z.number().int().nullable(),
  active: z.boolean(),
  position: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type BookableServiceResponse = z.infer<typeof bookableServiceResponse>;

export const bookingBranchResponse = z.object({
  id: uuid,
  siteId: uuid,
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  active: z.boolean(),
  position: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type BookingBranchResponse = z.infer<typeof bookingBranchResponse>;

export const bookingStaffResponse = z.object({
  id: uuid,
  siteId: uuid,
  name: z.string(),
  title: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  branchId: uuid.nullable(),
  active: z.boolean(),
  position: z.number().int(),
  weeklyHours: z
    .object({
      mon: z.array(windowResponse),
      tue: z.array(windowResponse),
      wed: z.array(windowResponse),
      thu: z.array(windowResponse),
      fri: z.array(windowResponse),
      sat: z.array(windowResponse),
      sun: z.array(windowResponse),
    })
    .nullable(),
  serviceIds: z.array(uuid),
  calendarFeedToken: z.string().nullable().optional(),
  calendarFeedUrl: z.string().nullable().optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type BookingStaffResponse = z.infer<typeof bookingStaffResponse>;

export const calendarFeedInfoResponse = z.object({
  token: z.string(),
  feedUrl: z.string(),
});
export type CalendarFeedInfoResponse = z.infer<typeof calendarFeedInfoResponse>;

export const googleCalendarConnectionResponse = z.object({
  id: uuid,
  organizationId: uuid,
  siteId: uuid,
  staffId: uuid.nullable(),
  email: z.string(),
  calendarId: z.string(),
  status: z.string(),
  connectedAt: isoDateTime,
  lastSyncAt: isoDateTime.nullable(),
  lastError: z.string().nullable(),
});
export type GoogleCalendarConnectionResponse = z.infer<typeof googleCalendarConnectionResponse>;

export const googleCalendarStatusResponse = z.object({
  configured: z.boolean(),
  connection: googleCalendarConnectionResponse.nullable(),
  staffConnections: z.array(googleCalendarConnectionResponse),
});
export type GoogleCalendarStatusResponse = z.infer<typeof googleCalendarStatusResponse>;

export const bookingBlackoutResponse = z.object({
  id: uuid,
  siteId: uuid,
  staffId: uuid.nullable(),
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

/** Lo que la página pública necesita para ofrecer reservas (F5.2, F7.9a). */
export const publicBookingInfoResponse = z.object({
  timeZone: z.string(),
  maxAdvanceDays: z.number().int(),
  branches: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      address: z.string().nullable(),
      phone: z.string().nullable(),
    }),
  ),
  staff: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      title: z.string().nullable(),
      avatarUrl: z.string().nullable(),
      branchId: uuid.nullable(),
      serviceIds: z.array(uuid),
    }),
  ),
  services: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      description: z.string().nullable(),
      durationMinutes: z.number().int(),
      priceAmount: z.number().int().nullable(),
      priceCurrency: z.string().nullable(),
      hasPaymentLink: z.boolean(),
      /** Seña que se pagará al reservar (F5.10); `null` si este servicio no la cobra en línea. */
      depositAmount: z.number().int().nullable(),
      staffIds: z.array(uuid),
    }),
  ),
});
export type PublicBookingInfoResponse = z.infer<typeof publicBookingInfoResponse>;

/** Confirmación de una reserva pública: lo que el visitante ve (nunca ids internos del negocio). */
export const publicBookingConfirmationResponse = z.object({
  serviceName: z.string(),
  staffName: z.string().nullable(),
  branchName: z.string().nullable(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  timeZone: z.string(),
  priceAmount: z.number().int().nullable(),
  priceCurrency: z.string().nullable(),
  /** Enlace de pago del propio negocio, si lo configuró y la reserva no cobra seña en línea. */
  paymentUrl: z.string().nullable(),
  /** `PENDING_PAYMENT`: la hora queda guardada hasta `paymentDeadline` y se confirma al pagar la seña (F5.10). */
  status: z.enum(["CONFIRMED", "PENDING_PAYMENT"]),
  depositAmount: z.number().int().nullable(),
  paymentDeadline: isoDateTime.nullable(),
  /** Dónde pagar la seña con Mercado Pago. */
  checkoutUrl: z.string().nullable(),
});
export type PublicBookingConfirmationResponse = z.infer<typeof publicBookingConfirmationResponse>;

/** Una reserva en la agenda del negocio (F5.3, F7.9a). Datos del cliente: solo para miembros de la organización. */
export const bookingResponse = z.object({
  id: uuid,
  siteId: uuid,
  serviceId: uuid.nullable(),
  contactId: uuid.nullable(),
  staffId: uuid.nullable(),
  staffName: z.string().nullable(),
  branchId: uuid.nullable(),
  branchName: z.string().nullable(),
  serviceName: z.string(),
  durationMinutes: z.number().int(),
  priceAmount: z.number().int().nullable(),
  priceCurrency: z.string().nullable(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  timeZone: z.string(),
  customerName: z.string(),
  customerEmail: z.string(),
  customerPhone: z.string().nullable(),
  note: z.string().nullable(),
  status: bookingStatus,
  source: z.enum(["PUBLIC", "MANUAL"]),
  deposit: depositResponse.nullable(),
  cancelledAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type BookingResponse = z.infer<typeof bookingResponse>;

/** Página "gestiona tu reserva" (F5.4): lo que el cliente ve con su enlace; sin datos del negocio que no le correspondan. */
export const publicManagedBookingResponse = z.object({
  siteSlug: z.string(),
  siteName: z.string(),
  serviceName: z.string(),
  staffName: z.string().nullable(),
  branchName: z.string().nullable(),
  /** El servicio para buscar otra hora; `null` si ya no se ofrece (entonces no se puede cambiar la hora). */
  serviceId: uuid.nullable(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  timeZone: z.string(),
  status: bookingStatus,
  priceAmount: z.number().int().nullable(),
  priceCurrency: z.string().nullable(),
  paymentUrl: z.string().nullable(),
  /** Seña (F5.10), sin id del pago: el cliente no lo necesita. */
  deposit: z.object({ amount: z.number().int(), status: z.string().nullable(), deadline: isoDateTime.nullable(), paidAt: isoDateTime.nullable() }).nullable(),
  /** Dónde pagar la seña, solo mientras la reserva la espera y el plazo no venció. */
  checkoutUrl: z.string().nullable(),
  /** `false` si ya no está confirmada o falta menos que la anticipación mínima del negocio. */
  canChange: z.boolean(),
  /** Hasta cuándo se puede cancelar o cambiar. */
  changeDeadline: isoDateTime,
});
export type PublicManagedBookingResponse = z.infer<typeof publicManagedBookingResponse>;
