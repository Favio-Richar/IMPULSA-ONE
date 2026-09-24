import { z } from "zod";

/** Rango máximo consultable de una vez: un año más un día (bisiesto). Acota el trabajo de una
 *  sola petición del panel; para períodos más largos se consulta por tramos. */
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

export const analyticsOverviewQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    // Opcional: sin sitio, toda la organización. El servidor verifica que el sitio sea de esta
    // organización — un `siteId` ajeno en la query no revela nada (404, ADR-002).
    siteId: z.uuid().optional(),
  })
  .superRefine((value, ctx) => {
    const from = Date.parse(`${value.from}T00:00:00.000Z`);
    const to = Date.parse(`${value.to}T00:00:00.000Z`);
    if (to < from) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "La fecha final no puede ser anterior a la inicial." });
      return;
    }
    if ((to - from) / DAY_MS + 1 > MAX_RANGE_DAYS) {
      ctx.addIssue({ code: "custom", path: ["to"], message: `El rango no puede superar ${MAX_RANGE_DAYS} días.` });
    }
  });

export type AnalyticsOverviewQuery = z.infer<typeof analyticsOverviewQuerySchema>;
