import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Automatizaciones básicas (F6.7). La forma de la acción vive en `automationActionSchema`
// (`@impulza/validation`); acá va suelta para no duplicar el catálogo.

const runStatus = z.enum(["PENDING", "SUCCEEDED", "FAILED", "SKIPPED"]);

export const automationResponse = z.object({
  id: uuid,
  name: z.string(),
  trigger: z.string(),
  action: z.record(z.string(), z.unknown()),
  /** `false` si lo guardado ya no cumple el catálogo (el worker no la ejecuta). */
  actionValid: z.boolean(),
  enabled: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const automationListItemResponse = automationResponse.extend({
  runsLast30Days: z.object({ succeeded: z.number().int(), failed: z.number().int() }),
  lastRun: z.object({ createdAt: isoDateTime, status: runStatus }).nullable(),
});

/** Una ejecución: estado y motivo técnico, sin datos del contacto. */
export const automationRunResponse = z.object({
  id: uuid,
  trigger: z.string(),
  subjectId: uuid,
  status: runStatus,
  attempts: z.number().int(),
  detail: z.string().nullable(),
  createdAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
});

export type AutomationResponse = z.infer<typeof automationResponse>;
export type AutomationListItemResponse = z.infer<typeof automationListItemResponse>;
export type AutomationRunResponse = z.infer<typeof automationRunResponse>;
