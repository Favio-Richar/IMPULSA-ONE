import type {
  AdminAuditListResponse,
  AdminIdentityResponse,
  AdminLoginResponse,
  AdminOrganizationDetailResponse,
  AdminOrganizationListResponse,
  AdminOverviewResponse,
  AdminUserListResponse,
  PlanLimitsResponse,
  PlanResponse,
} from "@impulza/contracts";
import { apiFetch } from "./api-client";

// Un archivo, una función por endpoint de `/api/v1/admin` (F4.4). Los tipos salen de
// `@impulza/contracts`, los mismos que las pruebas e2e de la API validan contra respuestas reales.

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const adminApi = {
  login: (body: { email: string; password: string; code: string }) =>
    apiFetch<AdminLoginResponse>("/admin/auth/login", { method: "POST", body }),
  logout: () => apiFetch<void>("/admin/auth/logout", { method: "POST" }),
  me: () => apiFetch<AdminIdentityResponse>("/admin/auth/me"),

  overview: () => apiFetch<AdminOverviewResponse>("/admin/overview"),

  organizations: (params: { search?: string; status?: "ACTIVE" | "BLOCKED"; page: number; pageSize: number }) =>
    apiFetch<AdminOrganizationListResponse>(`/admin/organizations${query(params)}`),
  organization: (id: string) => apiFetch<AdminOrganizationDetailResponse>(`/admin/organizations/${id}`),
  changePlan: (id: string, body: { planId: string | null; reason: string }) =>
    apiFetch<AdminOrganizationDetailResponse>(`/admin/organizations/${id}/plan`, { method: "PUT", body }),
  block: (id: string, reason: string) =>
    apiFetch<AdminOrganizationDetailResponse>(`/admin/organizations/${id}/block`, { method: "POST", body: { reason } }),
  unblock: (id: string, reason: string) =>
    apiFetch<AdminOrganizationDetailResponse>(`/admin/organizations/${id}/unblock`, { method: "POST", body: { reason } }),

  users: (params: { search?: string; page: number; pageSize: number }) =>
    apiFetch<AdminUserListResponse>(`/admin/users${query(params)}`),

  plans: () => apiFetch<PlanResponse[]>("/admin/plans"),
  updatePlan: (
    id: string,
    body: { name?: string; priceMonthly?: number; priceYearly?: number; currency?: string; limits?: PlanLimitsResponse; reason: string },
  ) => apiFetch<PlanResponse>(`/admin/plans/${id}`, { method: "PATCH", body }),

  audit: (params: { scope: "admin" | "all"; organizationId?: string; page: number; pageSize: number }) =>
    apiFetch<AdminAuditListResponse>(`/admin/audit-logs${query(params)}`),
};
