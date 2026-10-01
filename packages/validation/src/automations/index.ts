import { z } from "zod";
import { plainTextSchema } from "../blocks/primitives.js";
import { contactCommercialStatusSchema, type ContactCommercialStatus } from "../contacts/index.js";

// Automatizaciones básicas (F6.7): disparador → acción, de un catálogo cerrado. La API guarda las
// reglas y encola un evento cuando pasa algo; el worker lo procesa (idempotente, con registro por
// ejecución). Isomorfo: el panel valida con estos mismos esquemas.

export const AUTOMATION_TRIGGERS = ["contact_created", "booking_created", "order_created", "newsletter_subscribed"] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  contact_created: "Llega un contacto nuevo",
  booking_created: "Se crea una reserva",
  order_created: "Llega un pedido",
  // F7.4/F7.5: la persona confirmó desde su correo (doble confirmación, ADR-019).
  newsletter_subscribed: "Alguien confirma su suscripción a la newsletter",
};

export const AUTOMATION_ACTION_TYPES = ["tag_contact", "set_commercial_status", "notify_team"] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export const AUTOMATION_ACTION_LABELS: Record<AutomationActionType, string> = {
  tag_contact: "Etiquetar al contacto",
  set_commercial_status: "Cambiar el estado comercial",
  notify_team: "Avisar al equipo por correo",
};

export const COMMERCIAL_STATUS_LABELS: Record<ContactCommercialStatus, string> = {
  NEW: "Nuevo",
  CONTACTED: "Contactado",
  QUALIFIED: "Calificado",
  WON: "Ganado",
  LOST: "Perdido",
};

export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tag_contact"), tag: plainTextSchema(40) }),
  z.object({ type: z.literal("set_commercial_status"), status: contactCommercialStatusSchema }),
  z.object({ type: z.literal("notify_team") }),
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const MAX_AUTOMATIONS_PER_ORGANIZATION = 20;

export const createAutomationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  action: automationActionSchema,
});
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;

export const updateAutomationSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    enabled: z.boolean().optional(),
    action: automationActionSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Indica al menos un cambio." });
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;

// --- cola ---------------------------------------------------------------------------------------

/** Nombre de la cola BullMQ: API → esta cola → worker. */
export const AUTOMATION_EVENTS_QUEUE = "automation-events";

/**
 * Lo que viaja por la cola: solo ids, nunca datos personales (el worker los lee de la base al
 * procesar, así un contacto borrado entre medio no se "resucita" desde Redis).
 */
export interface AutomationEventJob {
  organizationId: string;
  trigger: AutomationTrigger;
  /** Contacto, reserva o pedido que disparó el evento. */
  subjectId: string;
  /** Contacto al que aplican las acciones (el mismo `subjectId` si el disparador es un contacto). */
  contactId: string | null;
  occurredAt: string;
}

/** Clave de idempotencia de un evento: una automatización corre a lo sumo una vez por evento. */
export function automationEventKey(trigger: AutomationTrigger, subjectId: string): string {
  return `${trigger}:${subjectId}`;
}

/** Id del trabajo en BullMQ para un evento (sin `:`, que BullMQ no admite en ids propios). */
export function automationJobId(trigger: AutomationTrigger, subjectId: string): string {
  return `automation-${trigger}-${subjectId}`;
}

// --- aviso al equipo ------------------------------------------------------------------------------

export interface AutomationNoticeData {
  organizationName: string;
  automationName: string;
  trigger: AutomationTrigger;
  contact: { name: string | null; email: string | null; phone: string | null } | null;
  /** Una línea de detalle: "Corte de pelo · martes 29 de septiembre, 10:00" o "Pedido de $12.000". */
  detail: string | null;
  /** Enlace al panel para ver el contacto, si la instalación tiene la URL configurada. */
  dashboardUrl: string | null;
}

/** Quita saltos de línea de un texto que va en el asunto (nunca un encabezado inyectado). */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

const NOTICE_TITLES: Record<AutomationTrigger, string> = {
  contact_created: "Nuevo contacto",
  booking_created: "Nueva reserva",
  order_created: "Nuevo pedido",
  newsletter_subscribed: "Nuevo suscriptor de la newsletter",
};

/** Correo de texto plano para el equipo (ningún HTML de nadie se interpreta). */
export function automationNoticeEmail(data: AutomationNoticeData): { subject: string; text: string } {
  const who = data.contact ? (data.contact.name ?? data.contact.email ?? data.contact.phone ?? "Sin nombre") : null;
  return {
    subject: oneLine(`${NOTICE_TITLES[data.trigger]}${who ? `: ${who}` : ""} · ${data.organizationName}`),
    text: [
      `${NOTICE_TITLES[data.trigger]} en ${data.organizationName}.`,
      "",
      ...(data.detail ? [data.detail] : []),
      ...(data.contact
        ? [
            ...(data.contact.name ? [`Nombre: ${data.contact.name}`] : []),
            ...(data.contact.email ? [`Correo: ${data.contact.email}`] : []),
            ...(data.contact.phone ? [`Teléfono: ${data.contact.phone}`] : []),
          ]
        : []),
      ...(data.dashboardUrl ? ["", `Verlo en el panel: ${data.dashboardUrl}`] : []),
      "",
      `Te llega este aviso por la automatización «${oneLine(data.automationName)}». Puedes apagarla desde Automatizaciones en el panel.`,
    ].join("\n"),
  };
}
