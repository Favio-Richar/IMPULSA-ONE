import type { AutomationListItemResponse, AutomationResponse, AutomationRunResponse } from "@impulza/contracts";
import type { CreateAutomationInput, UpdateAutomationInput } from "@impulza/validation";
import { apiFetch } from "../api-client";

function automationsPath(organizationId: string): string {
  return `/organizations/${organizationId}/automations`;
}

export function listAutomations(organizationId: string): Promise<AutomationListItemResponse[]> {
  return apiFetch<AutomationListItemResponse[]>(automationsPath(organizationId));
}

export function createAutomation(organizationId: string, body: CreateAutomationInput): Promise<AutomationListItemResponse> {
  return apiFetch<AutomationListItemResponse>(automationsPath(organizationId), { method: "POST", body });
}

export function updateAutomation(organizationId: string, automationId: string, body: UpdateAutomationInput): Promise<AutomationResponse> {
  return apiFetch<AutomationResponse>(`${automationsPath(organizationId)}/${automationId}`, { method: "PATCH", body });
}

export function deleteAutomation(organizationId: string, automationId: string): Promise<void> {
  return apiFetch<void>(`${automationsPath(organizationId)}/${automationId}`, { method: "DELETE" });
}

export function listAutomationRuns(organizationId: string, automationId: string): Promise<AutomationRunResponse[]> {
  return apiFetch<AutomationRunResponse[]>(`${automationsPath(organizationId)}/${automationId}/runs`);
}
