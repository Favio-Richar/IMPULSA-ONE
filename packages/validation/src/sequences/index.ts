import { z } from "zod";
import { plainTextSchema, richTextSchema } from "../blocks/primitives.js";
import { AUTOMATION_TRIGGERS } from "../automations/index.js";
import { campaignEmail, type CampaignEmail } from "../campaigns/index.js";

// Secuencias de correo (F7.5, ADR-020): una serie de correos en el tiempo que arranca con un evento
// del catálogo de las automatizaciones. Isomorfo: el panel valida con estos mismos esquemas; la API
// revalida y sanea el cuerpo; el worker inscribe y envía.

export const MAX_SEQUENCES_PER_ORGANIZATION = 10;
export const MAX_SEQUENCE_STEPS = 10;
/** Espera máxima de un paso respecto del anterior: un año. */
export const MAX_SEQUENCE_DELAY_HOURS = 24 * 365;
/** Concesión del reclamo de un envío: si el proceso muere, el paso se reintenta después de esto. */
export const SEQUENCE_CLAIM_LEASE_MS = 15 * 60_000;

export const sequenceTriggerSchema = z.enum(AUTOMATION_TRIGGERS);

export const sequenceStepSchema = z.object({
  delayHours: z.number().int("Usa horas enteras.").min(0).max(MAX_SEQUENCE_DELAY_HOURS, "La espera máxima es de un año."),
  subject: plainTextSchema(150),
  bodyHtml: richTextSchema.refine((value) => value.replace(/<[^>]*>/g, "").trim().length > 0, "Escribe el contenido del correo."),
});
export type SequenceStepInput = z.infer<typeof sequenceStepSchema>;

const stepsSchema = z.array(sequenceStepSchema).min(1, "Agrega al menos un correo.").max(MAX_SEQUENCE_STEPS, `Hasta ${MAX_SEQUENCE_STEPS} correos por secuencia.`);

export const createEmailSequenceSchema = z.object({
  name: plainTextSchema(80),
  trigger: sequenceTriggerSchema,
  steps: stepsSchema,
});
export type CreateEmailSequenceInput = z.infer<typeof createEmailSequenceSchema>;

export const updateEmailSequenceSchema = z
  .object({
    name: plainTextSchema(80).optional(),
    enabled: z.boolean().optional(),
    steps: stepsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Indica al menos un cambio." });
export type UpdateEmailSequenceInput = z.infer<typeof updateEmailSequenceSchema>;

export const SEQUENCE_ENROLLMENT_STATUSES = ["ACTIVE", "COMPLETED", "STOPPED"] as const;
export type SequenceEnrollmentStatusValue = (typeof SEQUENCE_ENROLLMENT_STATUSES)[number];
export const SEQUENCE_ENROLLMENT_STATUS_LABELS: Record<SequenceEnrollmentStatusValue, string> = {
  ACTIVE: "En curso",
  COMPLETED: "Completada",
  STOPPED: "Detenida",
};

/** Motivos de detención (sin datos personales). */
export const SEQUENCE_STOP_REASONS = ["unsubscribed", "no_consent", "no_email", "manual"] as const;
export type SequenceStopReason = (typeof SEQUENCE_STOP_REASONS)[number];
export const SEQUENCE_STOP_REASON_LABELS: Record<SequenceStopReason, string> = {
  unsubscribed: "Se dio de baja",
  no_consent: "Sin consentimiento de marketing",
  no_email: "El contacto ya no tiene correo",
  manual: "Detenida por el equipo",
};

// --- personalización ---------------------------------------------------------------------------

const NAME_TOKEN = /\{\{\s*nombre\s*\}\}/gi;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Primer nombre para saludar ("Ana María Pérez" → "Ana"); vacío si no hay. */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * Reemplaza `{{nombre}}`. En HTML el nombre va **escapado** (lo escribió el visitante: no puede
 * meter marcado en el correo). Sin nombre, el marcador desaparece y se limpia el espacio o la coma
 * que lo acompañaba ("Hola {{nombre}}," → "Hola,").
 */
export function personalize(template: string, name: string | null | undefined, mode: "html" | "text"): string {
  const value = firstName(name);
  if (value) {
    const safe = mode === "html" ? escapeHtml(value) : value;
    return template.replace(NAME_TOKEN, safe);
  }
  return (
    template
      // Al inicio de un texto o de un párrafo ("{{nombre}}, tu reserva" → "Tu reserva").
      .replace(/(^|>)([ \t]*)\{\{\s*nombre\s*\}\}[ \t]*[,;:][ \t]*(\S)/gi, (_match, start: string, space: string, letter: string) => `${start}${space}${letter.toLocaleUpperCase("es")}`)
      // En medio de la frase, con la puntuación que lo seguía ("Hola {{nombre}}," → "Hola,").
      .replace(/[ \t]*\{\{\s*nombre\s*\}\}[ \t]*(?=[,.!?;:])/gi, "")
      .replace(NAME_TOKEN, "")
      .replace(/[ \t]{2,}/g, " ")
  );
}

/** Correo de un paso: el formato de las campañas (pie con el porqué y la baja) con `{{nombre}}` resuelto. */
export function sequenceEmail(input: {
  organizationName: string;
  subject: string;
  bodyHtml: string;
  name: string | null | undefined;
  unsubscribeUrl: string | null;
  test?: boolean;
}): CampaignEmail {
  return campaignEmail({
    organizationName: input.organizationName,
    subject: personalize(input.subject, input.name, "text"),
    bodyHtml: personalize(input.bodyHtml, input.name, "html"),
    unsubscribeUrl: input.unsubscribeUrl,
    test: input.test,
  });
}

/** "Al instante", "2 horas", "3 días", "1 día y 4 horas": cómo se lee una espera en el panel. */
export function describeDelay(hours: number): string {
  if (hours === 0) return "al instante";
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const dayText = days > 0 ? `${days} ${days === 1 ? "día" : "días"}` : "";
  const hourText = rest > 0 ? `${rest} ${rest === 1 ? "hora" : "horas"}` : "";
  return [dayText, hourText].filter(Boolean).join(" y ");
}
