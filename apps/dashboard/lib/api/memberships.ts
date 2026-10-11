import type { MembershipPlanListResponse, MembershipPlanResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

// Planes de membresía de un sitio (F10.2, ADR-029).

const base = (organizationId: string, siteId: string): string => `/organizations/${organizationId}/sites/${siteId}/members/plans`;

export interface PlanInput {
  name: string;
  description?: string;
  priceAmount: number;
  priceCurrency?: string;
  period: "MONTHLY" | "YEARLY";
}

export function listMembershipPlans(organizationId: string, siteId: string): Promise<MembershipPlanListResponse> {
  return apiFetch<MembershipPlanListResponse>(base(organizationId, siteId));
}

export function createMembershipPlan(organizationId: string, siteId: string, body: PlanInput): Promise<MembershipPlanResponse> {
  return apiFetch<MembershipPlanResponse>(base(organizationId, siteId), { method: "POST", body });
}

export function updateMembershipPlan(organizationId: string, siteId: string, planId: string, body: Partial<PlanInput> & { description?: string | null }): Promise<MembershipPlanResponse> {
  return apiFetch<MembershipPlanResponse>(`${base(organizationId, siteId)}/${planId}`, { method: "PUT", body });
}

export function setMembershipPlanStatus(organizationId: string, siteId: string, planId: string, action: "archive" | "restore"): Promise<MembershipPlanResponse> {
  return apiFetch<MembershipPlanResponse>(`${base(organizationId, siteId)}/${planId}/${action}`, { method: "POST" });
}
