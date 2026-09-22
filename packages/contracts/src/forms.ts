import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Contratos de formularios (F3.2). Mismo criterio que `sites.ts`/`public.ts`: este paquete no
// depende de `@impulza/validation`, así que los catálogos cerrados se repiten acá a propósito. Si
// el catálogo de `@impulza/validation` cambia, este también tiene que cambiar.
export const FORM_TYPE_VALUES = ["CONTACT", "QUOTE", "REGISTRATION", "SURVEY", "ORDER"] as const;
export const formType = z.enum(FORM_TYPE_VALUES);

export const FORM_FIELD_TYPE_VALUES = [
  "TEXT",
  "TEXTAREA",
  "EMAIL",
  "PHONE",
  "NUMBER",
  "SELECT",
  "CHECKBOX",
  "CONSENT",
] as const;
export const formFieldType = z.enum(FORM_FIELD_TYPE_VALUES);

export const successActionResponse = z.object({
  message: z.string(),
  redirectUrl: z.string().optional(),
});

export const formFieldResponse = z.object({
  id: uuid,
  formId: uuid,
  type: formFieldType,
  label: z.string(),
  required: z.boolean(),
  /** Solo tiene sentido para `SELECT`; `null` en cualquier otro tipo. */
  options: z.array(z.string()).nullable(),
  position: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const formResponse = z.object({
  id: uuid,
  siteId: uuid,
  name: z.string(),
  type: formType,
  successAction: successActionResponse,
  fields: z.array(formFieldResponse),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

// --- Público (sin sesión) -----------------------------------------------------------------------
//
// Mismo criterio de minimización que `public.ts`: sin `siteId`, sin timestamps, sin nada que un
// visitante anónimo no necesite para pintar el formulario y enviarlo.

export const publicFormFieldResponse = z.object({
  id: uuid,
  type: formFieldType,
  label: z.string(),
  required: z.boolean(),
  options: z.array(z.string()).nullable(),
  position: z.number().int(),
});

export const publicFormResponse = z.object({
  id: uuid,
  name: z.string(),
  fields: z.array(publicFormFieldResponse),
});

/** Lo que responde un envío exitoso: el `success_action` resuelto, nunca el payload de vuelta. */
export const formSubmissionAckResponse = successActionResponse;

export type FormType = z.infer<typeof formType>;
export type FormFieldType = z.infer<typeof formFieldType>;
export type SuccessActionResponse = z.infer<typeof successActionResponse>;
export type FormFieldResponse = z.infer<typeof formFieldResponse>;
export type FormResponse = z.infer<typeof formResponse>;
export type PublicFormFieldResponse = z.infer<typeof publicFormFieldResponse>;
export type PublicFormResponse = z.infer<typeof publicFormResponse>;
export type FormSubmissionAckResponse = z.infer<typeof formSubmissionAckResponse>;
