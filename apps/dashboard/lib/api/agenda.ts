import type { BookingResponse } from "@impulza/contracts";
import type { BookingStatusValue, ManualBookingInput } from "@impulza/validation";
import { apiFetch } from "../api-client";

export interface AgendaQuery {
  from: string;
  to: string;
  siteId?: string;
  status?: BookingStatusValue;
}

export function listBookings(organizationId: string, query: AgendaQuery): Promise<BookingResponse[]> {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.siteId) params.set("siteId", query.siteId);
  if (query.status) params.set("status", query.status);
  return apiFetch<BookingResponse[]>(`/organizations/${organizationId}/bookings?${params.toString()}`);
}

export function createManualBooking(organizationId: string, body: ManualBookingInput): Promise<BookingResponse> {
  return apiFetch<BookingResponse>(`/organizations/${organizationId}/bookings`, { method: "POST", body });
}

export function updateBookingStatus(organizationId: string, bookingId: string, status: BookingStatusValue): Promise<BookingResponse> {
  return apiFetch<BookingResponse>(`/organizations/${organizationId}/bookings/${bookingId}`, { method: "PATCH", body: { status } });
}
