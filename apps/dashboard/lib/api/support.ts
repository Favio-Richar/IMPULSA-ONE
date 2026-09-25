import type { SupportTicketDetailResponse, SupportTicketSummaryResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

export function listSupportTickets(organizationId: string): Promise<SupportTicketSummaryResponse[]> {
  return apiFetch<SupportTicketSummaryResponse[]>(`/organizations/${organizationId}/support-tickets`);
}

export function getSupportTicket(organizationId: string, ticketId: string): Promise<SupportTicketDetailResponse> {
  return apiFetch<SupportTicketDetailResponse>(`/organizations/${organizationId}/support-tickets/${ticketId}`);
}

export function openSupportTicket(organizationId: string, body: { subject: string; body: string }): Promise<SupportTicketDetailResponse> {
  return apiFetch<SupportTicketDetailResponse>(`/organizations/${organizationId}/support-tickets`, { method: "POST", body });
}

export function replySupportTicket(organizationId: string, ticketId: string, body: string): Promise<SupportTicketDetailResponse> {
  return apiFetch<SupportTicketDetailResponse>(`/organizations/${organizationId}/support-tickets/${ticketId}/messages`, {
    method: "POST",
    body: { body },
  });
}
