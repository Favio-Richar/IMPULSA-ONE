import { z } from "zod";

/**
 * Estado del asistente de IA para una organización (F6.2): si hay modelos configurados para cada
 * tarea y cuánto queda de la cuota del mes. El panel lo usa para mostrar u ocultar las funciones de
 * IA; nunca expone proveedores, modelos ni URLs (son configuración interna de la plataforma).
 */
export const aiStatusResponse = z.object({
  /** Tareas con al menos una conexión activa. Vacío = asistente no disponible. */
  availableTasks: z.array(z.string()),
  quota: z.object({
    /** `null` = sin límite en el plan. */
    limit: z.number().int().nullable(),
    used: z.number().int(),
    /** Mes calendario UTC de la cuota, `AAAA-MM`. */
    period: z.string(),
  }),
});

export type AiStatusResponse = z.infer<typeof aiStatusResponse>;
