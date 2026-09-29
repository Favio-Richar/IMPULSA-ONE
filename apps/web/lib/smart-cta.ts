import type { PublicPageResponse } from "@impulza/contracts";
import {
  evaluateSmartCta,
  needsBookingAvailability,
  smartCtaConditionSchema,
  weeklyHoursSchema,
  type PublicSmartCtaRule,
  type SmartCtaContext,
} from "@impulza/validation";

// Smart CTA en el sitio público (F6.6). Las reglas llegan con la página (en caché hasta publicar o
// cambiarlas); lo que cambia en cada visita —la hora, el dispositivo, la campaña de la URL— se
// evalúa acá en el servidor, así el botón correcto ya viene en el HTML.

type SmartCtaData = NonNullable<PublicPageResponse["smartCta"]>;

/** Reglas revalidadas contra el catálogo: una condición desconocida (API más nueva) se ignora. */
export function parseSmartCtaRules(data: SmartCtaData): PublicSmartCtaRule[] {
  return data.rules.flatMap((rule) => {
    const condition = smartCtaConditionSchema.safeParse(rule.condition);
    return condition.success ? [{ condition: condition.data, position: rule.position }] : [];
  });
}

export function smartCtaNeedsBookings(data: SmartCtaData | undefined): boolean {
  return data ? needsBookingAvailability(parseSmartCtaRules(data)) : false;
}

/**
 * Bloques con la acción principal que corresponde a esta visita: la de la primera regla que se
 * cumple, o la de siempre si ninguna. Solo cambia la marca `primary`; el contenido no se toca.
 */
export function applySmartCta<T extends { position: number; primary?: boolean }>(
  blocks: T[],
  data: SmartCtaData | undefined,
  context: Omit<SmartCtaContext, "hours">,
): T[] {
  if (!data) {
    return blocks;
  }
  const hours = data.hours ? weeklyHoursSchema.safeParse(data.hours.weeklyHours) : null;
  const position = evaluateSmartCta(parseSmartCtaRules(data), {
    ...context,
    hours: data.hours && hours?.success ? { timeZone: data.hours.timeZone, weeklyHours: hours.data } : null,
  });
  if (position === null || !blocks.some((block) => block.position === position)) {
    return blocks;
  }
  return blocks.map((block) => ({ ...block, primary: block.position === position }));
}
