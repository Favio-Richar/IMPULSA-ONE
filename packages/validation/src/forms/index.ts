import { z } from "zod";
import { emailSchema, phoneSchema, plainTextSchema, safeUrlSchema } from "../blocks/primitives.js";

// Formularios (F3.2) — isomorfo a propósito, mismo criterio que packages/validation/src/blocks:
// el constructor valida mientras se edita y la API vuelve a aplicar exactamente lo mismo al
// guardar (ST §15, el cliente nunca es la autoridad).

export const FORM_TYPES = ["CONTACT", "QUOTE", "REGISTRATION", "SURVEY", "ORDER"] as const;
export type FormType = (typeof FORM_TYPES)[number];
export const formTypeSchema = z.enum(FORM_TYPES);

export const FORM_FIELD_TYPES = [
  "TEXT",
  "TEXTAREA",
  "EMAIL",
  "PHONE",
  "NUMBER",
  "SELECT",
  "CHECKBOX",
  // Ver docs/decisions/ADR-004-privacidad-retencion-datos.md punto 3: tipo propio para que el
  // servidor detecte consentimiento sin adivinar por el texto de la etiqueta.
  "CONSENT",
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];
export const formFieldTypeSchema = z.enum(FORM_FIELD_TYPES);

export const formFieldOptionsSchema = z.array(plainTextSchema(120)).min(1).max(20);

export const successActionSchema = z.object({
  message: plainTextSchema(300),
  redirectUrl: safeUrlSchema.optional(),
});

export const createFormFieldSchema = z
  .object({
    type: formFieldTypeSchema,
    label: plainTextSchema(160),
    required: z.boolean().default(false),
    options: formFieldOptionsSchema.optional(),
  })
  .refine((field) => field.type !== "SELECT" || (field.options?.length ?? 0) > 0, {
    message: "Un campo de selección necesita al menos una opción.",
    path: ["options"],
  });

export type CreateFormFieldInput = z.infer<typeof createFormFieldSchema>;

export const updateFormFieldSchema = z
  .object({
    label: plainTextSchema(160).optional(),
    required: z.boolean().optional(),
    options: formFieldOptionsSchema.optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "El cuerpo no puede estar vacío." });

export type UpdateFormFieldInput = z.infer<typeof updateFormFieldSchema>;

export const createFormSchema = z.object({
  name: plainTextSchema(160),
  type: formTypeSchema.default("CONTACT"),
  successAction: successActionSchema.default({ message: "¡Gracias! Te responderemos pronto." }),
  // Atajo para crear un formulario ya usable en una sola llamada (sin esto, agregar campos exige
  // N peticiones más antes de que el bloque público tenga algo real que mostrar).
  fields: z.array(createFormFieldSchema).max(30).optional(),
});

export type CreateFormInput = z.infer<typeof createFormSchema>;

export const updateFormSchema = z
  .object({
    name: plainTextSchema(160).optional(),
    type: formTypeSchema.optional(),
    successAction: successActionSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "El cuerpo no puede estar vacío." });

export type UpdateFormInput = z.infer<typeof updateFormSchema>;

// --- Envío público -----------------------------------------------------------------------------

/** Campo invisible para humanos: si un envío lo trae con contenido, es un bot (F3.2 antispam). */
export const HONEYPOT_FIELD_KEY = "_hp";

export interface SubmittableFormField {
  id: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  options: string[] | null;
}

/**
 * No hay "el" esquema de un envío: cada formulario define el suyo según sus propios campos
 * guardados. Se arma en el servidor a partir de eso, nunca se confía en lo que declare el cliente
 * (ST §15) — el mismo criterio que `parseStoredBlock`, una capa más adentro.
 */
export function buildFormSubmissionSchema(fields: readonly SubmittableFormField[]) {
  const shape: Record<string, z.ZodTypeAny> = {
    [HONEYPOT_FIELD_KEY]: z.string().max(200).optional(),
  };

  for (const field of fields) {
    let schema: z.ZodTypeAny;

    switch (field.type) {
      case "EMAIL":
        schema = emailSchema;
        break;
      case "PHONE":
        schema = phoneSchema;
        break;
      case "NUMBER":
        schema = z.coerce.number();
        break;
      case "CHECKBOX":
      case "CONSENT":
        schema = z.boolean();
        break;
      case "SELECT":
        schema =
          field.options && field.options.length > 0
            ? z.enum(field.options as [string, ...string[]])
            : z.never();
        break;
      case "TEXTAREA":
        schema = plainTextSchema(5000);
        break;
      case "TEXT":
      default:
        schema = plainTextSchema(500);
        break;
    }

    shape[field.id] = field.required ? schema : schema.optional();
  }

  return z.object(shape).strict();
}

/**
 * Señales de contacto extraídas del envío según el **tipo** de cada campo, no por adivinar el
 * texto de la etiqueta: el primer campo `EMAIL`/`PHONE` presente es el correo/teléfono del
 * contacto, y el primer campo `TEXT` presente es su nombre (convención documentada del
 * constructor de formularios — no hay un campo dedicado "es el nombre" para no inventar más
 * estructura de la que el MVP necesita). `CONSENT` decide si el envío puede crear/actualizar un
 * `Contact` con seguimiento en absoluto (ADR-004 punto 3): sin un campo de ese tipo en el
 * formulario, o presente pero sin marcar, no hay consentimiento y no se crea contacto — solo
 * queda el `FormSubmission` crudo.
 */
export function extractContactSignals(
  fields: readonly SubmittableFormField[],
  payload: Record<string, unknown>,
): { name?: string; email?: string; phone?: string; hasConsentField: boolean; consentGranted: boolean } {
  let name: string | undefined;
  let email: string | undefined;
  let phone: string | undefined;
  let hasConsentField = false;
  let consentGranted = false;

  for (const field of fields) {
    const value = payload[field.id];

    if (field.type === "TEXT" && name === undefined && typeof value === "string" && value.length > 0) {
      name = value;
    }
    if (field.type === "EMAIL" && email === undefined && typeof value === "string" && value.length > 0) {
      email = value;
    }
    if (field.type === "PHONE" && phone === undefined && typeof value === "string" && value.length > 0) {
      phone = value;
    }
    if (field.type === "CONSENT") {
      hasConsentField = true;
      if (value === true) {
        consentGranted = true;
      }
    }
  }

  return { name, email, phone, hasConsentField, consentGranted };
}
