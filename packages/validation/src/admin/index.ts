import { z } from "zod";

/**
 * Colas BullMQ reales del sistema (F7.11, ADR-026).
 * Cada cola debe existir en el código fuente de los workers y productores de la plataforma.
 */
export const BULLMQ_QUEUES = [
  "analytics-events",
  "analytics-maintenance",
  "automation-events",
  "media-process",
  "media-video",
  "webhook-deliveries",
  "billing-renewals",
  "booking-deposits",
  "booking-reminders",
  "campaign-dispatch",
  "newsletter-maintenance",
  "page-campaign-boundaries",
  "payment-accounts-refresh",
  "sequence-dispatch",
] as const;

export type BullMqQueueName = (typeof BULLMQ_QUEUES)[number];

export const bullMqQueueNameSchema = z.enum(BULLMQ_QUEUES);

export const QUEUE_ACTIONS = ["pause", "resume", "retry-failed", "clean"] as const;
export type QueueAction = (typeof QUEUE_ACTIONS)[number];

export const queueActionSchema = z.enum(QUEUE_ACTIONS);

export const queueActionBodySchema = z.object({
  action: queueActionSchema,
});
export type QueueActionBody = z.infer<typeof queueActionBodySchema>;

/**
 * Feature Flags del sistema (F7.11, ADR-026).
 * Banderas iniciales que controlan funciones críticas de la plataforma.
 */
export const SYSTEM_FEATURE_FLAGS = [
  {
    key: "registros_abiertos",
    name: "Registros abiertos",
    description: "Permite o bloquea el registro de nuevas cuentas de usuario en la plataforma.",
    defaultEnabled: true,
  },
  {
    key: "pagos_en_linea",
    name: "Pagos en línea",
    description: "Conmutador maestro de cobros, suscripciones y pasarelas de pago.",
    defaultEnabled: true,
  },
  {
    key: "ia_generativa",
    name: "IA generativa",
    description: "Habilita o pausa el asistente de IA y generación de contenido.",
    defaultEnabled: true,
  },
  {
    key: "campanas_correo",
    name: "Campañas por correo",
    description: "Permite la programación y despacho de campañas masivas por el worker.",
    defaultEnabled: true,
  },
  {
    key: "sincronizacion_calendarios",
    name: "Sincronización de calendarios",
    description: "Controla la integración con Google Calendar y feeds iCal.",
    defaultEnabled: true,
  },
  {
    key: "webhooks_salientes",
    name: "Webhooks salientes",
    description: "Habilita o deshabilita la emisión y entrega de webhooks hacia sistemas externos.",
    defaultEnabled: true,
  },
] as const;

export type SystemFeatureFlagKey = (typeof SYSTEM_FEATURE_FLAGS)[number]["key"];

export const featureFlagKeySchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9_]+$/, "Solo minúsculas, números y guiones bajos");

export const updateFeatureFlagSchema = z.object({
  enabled: z.boolean(),
  rules: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type UpdateFeatureFlagDto = z.infer<typeof updateFeatureFlagSchema>;

export const updateTemplateAdminSchema = z
  .object({
    isActive: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  })
  .refine(
    (data) => data.isActive !== undefined || data.isFeatured !== undefined || data.sortOrder !== undefined,
    { message: "Debe actualizar al menos un campo (isActive, isFeatured o sortOrder)" },
  );
export type UpdateTemplateAdminDto = z.infer<typeof updateTemplateAdminSchema>;
