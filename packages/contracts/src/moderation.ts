import { z } from "zod";

// Moderación y reportes de abuso (F9.9, ADR-028 §7).

/** Respuesta del reporte público. Idéntica exista o no un reporte previo del mismo visitante: no se le dice nada que sirva para sondear. */
export const abuseReportAckResponse = z.object({
  received: z.literal(true),
});

export type AbuseReportAckResponse = z.infer<typeof abuseReportAckResponse>;
