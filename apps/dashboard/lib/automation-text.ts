import {
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_TRIGGER_LABELS,
  COMMERCIAL_STATUS_LABELS,
  automationActionSchema,
  type AutomationTrigger,
} from "@impulza/validation";

/** La regla en una frase: "Cuando llega un contacto nuevo → etiquetar con «lead-web»". */
export function automationSentence(trigger: string, action: unknown): { when: string; then: string } {
  const when = AUTOMATION_TRIGGER_LABELS[trigger as AutomationTrigger] ?? "Evento desconocido";
  const parsed = automationActionSchema.safeParse(action);
  if (!parsed.success) {
    return { when, then: "Acción no válida (no se ejecuta)" };
  }
  const value = parsed.data;
  if (value.type === "tag_contact") {
    return { when, then: `Etiquetar al contacto con «${value.tag}»` };
  }
  if (value.type === "set_commercial_status") {
    return { when, then: `Cambiar su estado comercial a «${COMMERCIAL_STATUS_LABELS[value.status]}»` };
  }
  return { when, then: AUTOMATION_ACTION_LABELS.notify_team };
}

export const RUN_STATUS_LABELS: Record<string, string> = {
  PENDING: "En curso",
  SUCCEEDED: "Hecha",
  FAILED: "Falló",
  SKIPPED: "Omitida",
};
