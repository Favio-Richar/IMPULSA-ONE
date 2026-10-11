import type { AuditListResponse } from "@impulza/contracts";
import { apiFetch, apiFetchText } from "../api-client";

// Auditoría navegable (F9.6d, ADR-028 §3). Los filtros los valida y aplica el servidor.

export interface AuditFilters {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  /** Solo en la vista de agencia: la organización del cliente. */
  client?: string;
}

function path(organizationId: string, view: "organization" | "agency"): string {
  return view === "agency" ? `/organizations/${organizationId}/agency/audit-logs` : `/organizations/${organizationId}/audit-logs`;
}

function queryString(filters: AuditFilters, extra: Record<string, string | number> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function listAudit(organizationId: string, view: "organization" | "agency", filters: AuditFilters, limit: number, offset: number): Promise<AuditListResponse> {
  return apiFetch<AuditListResponse>(`${path(organizationId, view)}${queryString(filters, { limit, offset })}`);
}

export function exportAudit(organizationId: string, view: "organization" | "agency", filters: AuditFilters): Promise<string> {
  return apiFetchText(`${path(organizationId, view)}/export${queryString(filters)}`);
}
