import { z } from "zod";

// Embudos de conversión (F7.6, ADR-021). Isomorfo: el panel valida mientras se edita y la API
// vuelve a validar al guardar y al leer — el cliente nunca es la autoridad (ST §15).

/**
 * Eventos que pueden formar un paso. Todos son del catálogo de analítica salvo `payment`, que no es
 * un evento: son las visitas cuyo pedido o reserva quedó pagado (cruce al consultar, ADR-021 §4).
 */
export const FUNNEL_STEP_EVENTS = [
  "page_view",
  "block_click",
  "whatsapp_click",
  "form_submit",
  "lead_created",
  "booking_created",
  "order_created",
  "payment",
] as const;
export type FunnelStepEvent = (typeof FUNNEL_STEP_EVENTS)[number];

export const FUNNEL_STEP_EVENT_LABELS: Record<FunnelStepEvent, string> = {
  page_view: "Vista de página",
  block_click: "Clic en un bloque",
  whatsapp_click: "Clic en WhatsApp",
  form_submit: "Envío de formulario",
  lead_created: "Contacto nuevo",
  booking_created: "Reserva",
  order_created: "Pedido",
  payment: "Pago (pedido o seña)",
};

/** Eventos que admiten un sujeto concreto: una página o un bloque del mismo sitio. */
export const FUNNEL_SUBJECT_EVENTS = ["page_view", "block_click"] as const satisfies readonly FunnelStepEvent[];

export const FUNNEL_MIN_STEPS = 2;
export const FUNNEL_MAX_STEPS = 6;
export const FUNNEL_MAX_EVENTS_PER_STEP = 4;
export const FUNNEL_MAX_PER_SITE = 10;

export const funnelStepSchema = z
  .object({
    label: z.string().trim().min(1, "Ponle un nombre al paso.").max(60, "Máximo 60 caracteres."),
    events: z
      .array(z.enum(FUNNEL_STEP_EVENTS))
      .min(1, "Elige al menos un evento.")
      .max(FUNNEL_MAX_EVENTS_PER_STEP, `Máximo ${FUNNEL_MAX_EVENTS_PER_STEP} eventos por paso.`)
      .refine((events) => new Set(events).size === events.length, { message: "Hay eventos repetidos." }),
    // Página (vista) o bloque (clic) concreto. Sin él, cualquier página o cualquier bloque.
    subjectId: z.uuid().nullable().default(null),
  })
  .superRefine((step, ctx) => {
    const [only] = step.events;
    const filterable = step.events.length === 1 && (FUNNEL_SUBJECT_EVENTS as readonly string[]).includes(only ?? "");
    if (step.subjectId !== null && !filterable) {
      ctx.addIssue({
        code: "custom",
        path: ["subjectId"],
        message: "Solo un paso con una única vista de página o un único clic en bloque puede apuntar a una página o un bloque.",
      });
    }
  });
export type FunnelStep = z.infer<typeof funnelStepSchema>;

export const funnelStepsSchema = z
  .array(funnelStepSchema)
  .min(FUNNEL_MIN_STEPS, `Un embudo tiene al menos ${FUNNEL_MIN_STEPS} pasos.`)
  .max(FUNNEL_MAX_STEPS, `Un embudo tiene como máximo ${FUNNEL_MAX_STEPS} pasos.`);

export const funnelNameSchema = z.string().trim().min(2, "Mínimo 2 caracteres.").max(80, "Máximo 80 caracteres.");

// El sitio va en la ruta (`/sites/:siteId/funnels`), nunca en el cuerpo.
export const createFunnelSchema = z.object({
  name: funnelNameSchema,
  steps: funnelStepsSchema,
});
export type CreateFunnelInput = z.infer<typeof createFunnelSchema>;

export const updateFunnelSchema = z
  .object({ name: funnelNameSchema.optional(), steps: funnelStepsSchema.optional() })
  .refine((value) => value.name !== undefined || value.steps !== undefined, { message: "Envía al menos un campo a modificar." });
export type UpdateFunnelInput = z.infer<typeof updateFunnelSchema>;

export const FUNNEL_DEVICES = ["mobile", "tablet", "desktop"] as const;
export type FunnelDevice = (typeof FUNNEL_DEVICES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
/** Un año más un día (bisiesto), igual que el resto de los informes de analítica. */
export const FUNNEL_MAX_RANGE_DAYS = 366;

export const funnelReportQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    // Dispositivo de la visita al entrar al embudo (su primer paso).
    device: z.enum(FUNNEL_DEVICES).optional(),
  })
  .superRefine((value, ctx) => {
    const from = Date.parse(`${value.from}T00:00:00.000Z`);
    const to = Date.parse(`${value.to}T00:00:00.000Z`);
    if (to < from) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "La fecha final no puede ser anterior a la inicial." });
      return;
    }
    if ((to - from) / DAY_MS + 1 > FUNNEL_MAX_RANGE_DAYS) {
      ctx.addIssue({ code: "custom", path: ["to"], message: `El rango no puede superar ${FUNNEL_MAX_RANGE_DAYS} días.` });
    }
  });
export type FunnelReportQuery = z.infer<typeof funnelReportQuerySchema>;

/** Embudo sugerido: el "embudo completo" del plan maestro §14.3, sin la recurrencia (ADR-021 §6). */
export const SUGGESTED_FUNNEL: { name: string; steps: FunnelStep[] } = {
  name: "Visita a pago",
  steps: [
    { label: "Visita", events: ["page_view"], subjectId: null },
    { label: "Interacción", events: ["block_click", "whatsapp_click"], subjectId: null },
    { label: "Contacto, reserva o pedido", events: ["lead_created", "booking_created", "order_created"], subjectId: null },
    { label: "Pago", events: ["payment"], subjectId: null },
  ],
};
