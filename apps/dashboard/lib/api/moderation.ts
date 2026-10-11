import type { ModerationCaseResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

// Medidas de moderación del negocio y su apelación (F9.9c, ADR-028 §7).

export function listModerationCases(organizationId: string): Promise<ModerationCaseResponse[]> {
  return apiFetch<ModerationCaseResponse[]>(`/organizations/${organizationId}/moderation/cases`);
}

export function appealModerationCase(organizationId: string, caseId: string, text: string): Promise<ModerationCaseResponse> {
  return apiFetch<ModerationCaseResponse>(`/organizations/${organizationId}/moderation/cases/${caseId}/appeal`, { method: "POST", body: { text } });
}
