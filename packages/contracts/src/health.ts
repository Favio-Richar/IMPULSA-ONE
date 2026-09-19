import { z } from "zod";
import { isoDateTime } from "./primitives.js";

/**
 * Reporte de `GET /health`. Es el único contrato que no describe un recurso de negocio: lo consume
 * infraestructura (load balancer, orquestador), no un cliente del producto.
 *
 * `degraded` y no `error`: el endpoint responde aunque una dependencia esté caída — por eso trae
 * el detalle por dependencia en `checks` y no solo un estado global. El código HTTP acompaña
 * (200 / 503), pero la razón exacta está en el cuerpo.
 */
export const healthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.string(),
  timestamp: isoDateTime,
  /** Una entrada por dependencia declarada (`database`, `redis`, …). */
  checks: z.record(z.string(), z.enum(["ok", "error"])),
});

export type HealthResponse = z.infer<typeof healthResponse>;
