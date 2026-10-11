import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// ---- auditoría navegable (F9.6d, ADR-028 §3) --------------------------------------------------------------------------
// Los filtros viven en `@impulza/validation` (`audit/`).

export const auditEntryResponse = z.object({
  id: uuid,
  /** Código estable de la acción (`publish_request.approved`, `page.published`…). */
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  /** Quien actuó; `null` si no hubo una persona (un proceso) o la cuenta ya no existe. */
  actor: z.object({ id: uuid, email: z.string() }).nullable(),
  /** La organización donde ocurrió: en la vista de agencia, el cliente. */
  organization: z.object({ id: uuid, name: z.string() }).nullable(),
  /** Si la acción la hizo una persona de una agencia con acceso delegado: qué agencia. */
  delegatedBy: z.object({ agencyOrganizationId: uuid, agencyName: z.string().nullable() }).nullable(),
  /** Datos de la acción (nunca secretos; ST §16). Sin la marca de delegación, que va en `delegatedBy`. */
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: isoDateTime,
});

export const auditListResponse = z.object({
  items: z.array(auditEntryResponse),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export type AuditEntryResponse = z.infer<typeof auditEntryResponse>;
export type AuditListResponse = z.infer<typeof auditListResponse>;
