import type {
  BookableServiceResponse,
  BookingAvailabilityResponse,
  BookingBlackoutResponse,
  BookingSettingsResponse,
} from "@impulza/contracts";
import type { BookableServiceInput, BookingBlackoutInput, BookingSettingsInput, UpdateBookableServiceInput } from "@impulza/validation";
import { apiFetch } from "../api-client";

function base(organizationId: string, siteId: string): string {
  return `/organizations/${organizationId}/sites/${siteId}/booking`;
}

export function getBookingSettings(organizationId: string, siteId: string): Promise<BookingSettingsResponse> {
  return apiFetch<BookingSettingsResponse>(`${base(organizationId, siteId)}/settings`);
}

export function saveBookingSettings(organizationId: string, siteId: string, body: BookingSettingsInput): Promise<BookingSettingsResponse> {
  return apiFetch<BookingSettingsResponse>(`${base(organizationId, siteId)}/settings`, { method: "PUT", body });
}

export function listBookableServices(organizationId: string, siteId: string): Promise<BookableServiceResponse[]> {
  return apiFetch<BookableServiceResponse[]>(`${base(organizationId, siteId)}/services`);
}

export function createBookableService(organizationId: string, siteId: string, body: BookableServiceInput): Promise<BookableServiceResponse> {
  return apiFetch<BookableServiceResponse>(`${base(organizationId, siteId)}/services`, { method: "POST", body });
}

export function updateBookableService(
  organizationId: string,
  siteId: string,
  serviceId: string,
  body: UpdateBookableServiceInput,
): Promise<BookableServiceResponse> {
  return apiFetch<BookableServiceResponse>(`${base(organizationId, siteId)}/services/${serviceId}`, { method: "PATCH", body });
}

export function deleteBookableService(organizationId: string, siteId: string, serviceId: string): Promise<void> {
  return apiFetch<void>(`${base(organizationId, siteId)}/services/${serviceId}`, { method: "DELETE" });
}

export function listBookingBlackouts(organizationId: string, siteId: string): Promise<BookingBlackoutResponse[]> {
  return apiFetch<BookingBlackoutResponse[]>(`${base(organizationId, siteId)}/blackouts`);
}

export function createBookingBlackout(organizationId: string, siteId: string, body: BookingBlackoutInput): Promise<BookingBlackoutResponse> {
  return apiFetch<BookingBlackoutResponse>(`${base(organizationId, siteId)}/blackouts`, { method: "POST", body });
}

export function deleteBookingBlackout(organizationId: string, siteId: string, blackoutId: string): Promise<void> {
  return apiFetch<void>(`${base(organizationId, siteId)}/blackouts/${blackoutId}`, { method: "DELETE" });
}

export function getBookingAvailability(
  organizationId: string,
  siteId: string,
  query: { serviceId: string; from: string; days: number },
): Promise<BookingAvailabilityResponse> {
  const params = new URLSearchParams({ serviceId: query.serviceId, from: query.from, days: String(query.days) });
  return apiFetch<BookingAvailabilityResponse>(`${base(organizationId, siteId)}/availability?${params.toString()}`);
}
