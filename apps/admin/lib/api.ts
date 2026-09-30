import type {
  AdminAiConnectionResponse,
  AdminAiConnectionTestResponse,
  AdminAiRoutesResponse,
  AdminAiUsageResponse,
  AdminAuditListResponse,
  AdminBillingSummaryResponse,
  AdminIdentityResponse,
  AdminLoginResponse,
  AdminOrganizationDetailResponse,
  AdminOrganizationListResponse,
  AdminOverviewResponse,
  AdminPaymentListResponse,
  AdminPaymentResponse,
  AdminRefundResponse,
  AdminSupportTicketDetailResponse,
  AdminSupportTicketListResponse,
  AdminUserListResponse,
  PlanLimitsResponse,
  PlanResponse,
} from "@impulza/contracts";
import type { AiRoutesInput, CreateAiConnectionInput, UpdateAiConnectionInput } from "@impulza/validation";
import { apiDownload, apiFetch } from "./api-client";

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

  supportTickets: (params: { status?: "OPEN" | "ANSWERED" | "CLOSED"; organizationId?: string; page: number; pageSize: number }) =>
    apiFetch<AdminSupportTicketListResponse>(`/admin/support-tickets${query(params)}`),
  supportTicket: (id: string) => apiFetch<AdminSupportTicketDetailResponse>(`/admin/support-tickets/${id}`),
  replySupportTicket: (id: string, body: string) =>
    apiFetch<AdminSupportTicketDetailResponse>(`/admin/support-tickets/${id}/messages`, { method: "POST", body: { body } }),
  closeSupportTicket: (id: string) => apiFetch<AdminSupportTicketDetailResponse>(`/admin/support-tickets/${id}/close`, { method: "POST" }),

  audit: (params: { scope: "admin" | "all"; organizationId?: string; page: number; pageSize: number }) =>
    apiFetch<AdminAuditListResponse>(`/admin/audit-logs${query(params)}`),

  // IA (F6.2b, ADR-010): el token se envía al crear o editar y nunca vuelve.
  aiConnections: () => apiFetch<AdminAiConnectionResponse[]>("/admin/ai/connections"),
  createAiConnection: (body: CreateAiConnectionInput) =>
    apiFetch<AdminAiConnectionResponse>("/admin/ai/connections", { method: "POST", body }),
  updateAiConnection: (id: string, body: UpdateAiConnectionInput) =>
    apiFetch<AdminAiConnectionResponse>(`/admin/ai/connections/${id}`, { method: "PATCH", body }),
  deleteAiConnection: (id: string) => apiFetch<void>(`/admin/ai/connections/${id}`, { method: "DELETE" }),
  testAiConnection: (id: string) => apiFetch<AdminAiConnectionTestResponse>(`/admin/ai/connections/${id}/test`, { method: "POST" }),
  aiRoutes: () => apiFetch<AdminAiRoutesResponse>("/admin/ai/routes"),
  setAiRoutes: (body: AiRoutesInput) => apiFetch<AdminAiRoutesResponse>("/admin/ai/routes", { method: "PUT", body }),
  aiUsage: () => apiFetch<AdminAiUsageResponse>("/admin/ai/usage"),

  // Ingresos (F4.6d, ADR-012).
  billingSummary: (month?: string) => apiFetch<AdminBillingSummaryResponse>(`/admin/billing/summary${query({ month })}`),
  payments: (params: {
    month?: string;
    status?: "PENDING" | "APPROVED" | "REJECTED" | "REFUNDED";
    taxDocument?: "PENDING" | "ISSUED" | "NOT_REQUIRED";
    page: number;
    pageSize: number;
  }) => apiFetch<AdminPaymentListResponse>(`/admin/billing/payments${query(params)}`),
  markTaxDocument: (id: string, documentNumber: string) =>
    apiFetch<AdminPaymentResponse>(`/admin/billing/payments/${id}/tax-document`, { method: "POST", body: { documentNumber } }),
  refundPayment: (id: string, reason: string) => apiFetch<AdminRefundResponse>(`/admin/billing/payments/${id}/refund`, { method: "POST", body: { reason } }),
  downloadPaymentsCsv: (month: string) => apiDownload(`/admin/billing/payments.csv${query({ month })}`, `impulza-cobros-${month}.csv`),
};
