import type { OrganizationPlanResponse, PlanResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

export function listPlans(): Promise<PlanResponse[]> {
  return apiFetch<PlanResponse[]>("/plans");
}

export function getOrganizationPlan(organizationId: string): Promise<OrganizationPlanResponse> {
  return apiFetch<OrganizationPlanResponse>(`/organizations/${organizationId}/plan`);
}
