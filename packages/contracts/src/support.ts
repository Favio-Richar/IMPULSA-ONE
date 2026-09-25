import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Soporte mínimo (F4.5). El cliente nunca ve el correo de quien le respondió del equipo: los
// mensajes del equipo llegan firmados como "Equipo de Impulza One" (`authorEmail: null`).

export const supportTicketStatus = z.enum(["OPEN", "ANSWERED", "CLOSED"]);
export const supportAuthorRole = z.enum(["CUSTOMER", "STAFF"]);

export const supportMessageResponse = z.object({
  id: uuid,
  authorRole: supportAuthorRole,
  /** Correo del autor si es del cliente (o, en la administración, también del equipo). */
  authorEmail: z.string().nullable(),
  body: z.string(),
  createdAt: isoDateTime,
});

export const supportTicketSummaryResponse = z.object({
  id: uuid,
  subject: z.string(),
  status: supportTicketStatus,
  openedByEmail: z.string().nullable(),
  messageCount: z.number().int(),
  createdAt: isoDateTime,
  /** Última actividad: último mensaje o cambio de estado. */
  updatedAt: isoDateTime,
  closedAt: isoDateTime.nullable(),
});

export const supportTicketDetailResponse = supportTicketSummaryResponse.extend({
  messages: z.array(supportMessageResponse),
});

/** En la administración, cada solicitud además dice de qué organización es. */
export const adminSupportTicketSummaryResponse = supportTicketSummaryResponse.extend({
  organizationId: uuid,
  organizationName: z.string(),
});

export const adminSupportTicketListResponse = z.object({
  items: z.array(adminSupportTicketSummaryResponse),
  total: z.number().int(),
  /** Conteos por estado, para las pestañas de la bandeja. */
  counts: z.object({ OPEN: z.number().int(), ANSWERED: z.number().int(), CLOSED: z.number().int() }),
});

export const adminSupportTicketDetailResponse = adminSupportTicketSummaryResponse.extend({
  messages: z.array(supportMessageResponse),
});

export type SupportTicketStatus = z.infer<typeof supportTicketStatus>;
export type SupportMessageResponse = z.infer<typeof supportMessageResponse>;
export type SupportTicketSummaryResponse = z.infer<typeof supportTicketSummaryResponse>;
export type SupportTicketDetailResponse = z.infer<typeof supportTicketDetailResponse>;
export type AdminSupportTicketSummaryResponse = z.infer<typeof adminSupportTicketSummaryResponse>;
export type AdminSupportTicketListResponse = z.infer<typeof adminSupportTicketListResponse>;
export type AdminSupportTicketDetailResponse = z.infer<typeof adminSupportTicketDetailResponse>;
