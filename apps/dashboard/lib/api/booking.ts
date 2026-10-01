import type {
  BookableServiceResponse,
  BookingAvailabilityResponse,
  BookingBlackoutResponse,
  BookingBranchResponse,
  BookingSettingsResponse,
  BookingStaffResponse,
  GoogleCalendarStatusResponse,
} from "@impulza/contracts";
import type {
  AssignStaffToServiceInput,
  BookableServiceInput,
  BookingBlackoutInput,
  BookingBranchInput,
  BookingSettingsInput,
  BookingStaffInput,
  UpdateBookableServiceInput,
  UpdateBookingBranchInput,
  UpdateBookingStaffInput,
} from "@impulza/validation";
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

export function listBookingBranches(organizationId: string, siteId: string): Promise<BookingBranchResponse[]> {
  return apiFetch<BookingBranchResponse[]>(`${base(organizationId, siteId)}/branches`);
}

export function createBookingBranch(organizationId: string, siteId: string, body: BookingBranchInput): Promise<BookingBranchResponse> {
  return apiFetch<BookingBranchResponse>(`${base(organizationId, siteId)}/branches`, { method: "POST", body });
}

export function updateBookingBranch(
  organizationId: string,
  siteId: string,
  branchId: string,
  body: UpdateBookingBranchInput,
): Promise<BookingBranchResponse> {
  return apiFetch<BookingBranchResponse>(`${base(organizationId, siteId)}/branches/${branchId}`, { method: "PATCH", body });
}

export function deleteBookingBranch(organizationId: string, siteId: string, branchId: string): Promise<void> {
  return apiFetch<void>(`${base(organizationId, siteId)}/branches/${branchId}`, { method: "DELETE" });
}

export function listBookingStaff(organizationId: string, siteId: string): Promise<BookingStaffResponse[]> {
  return apiFetch<BookingStaffResponse[]>(`${base(organizationId, siteId)}/staff`);
}

export function createBookingStaff(organizationId: string, siteId: string, body: BookingStaffInput): Promise<BookingStaffResponse> {
  return apiFetch<BookingStaffResponse>(`${base(organizationId, siteId)}/staff`, { method: "POST", body });
}

export function updateBookingStaff(
  organizationId: string,
  siteId: string,
  staffId: string,
  body: UpdateBookingStaffInput,
): Promise<BookingStaffResponse> {
  return apiFetch<BookingStaffResponse>(`${base(organizationId, siteId)}/staff/${staffId}`, { method: "PATCH", body });
}

export function deleteBookingStaff(organizationId: string, siteId: string, staffId: string): Promise<void> {
  return apiFetch<void>(`${base(organizationId, siteId)}/staff/${staffId}`, { method: "DELETE" });
}

export function assignStaffToService(
  organizationId: string,
  siteId: string,
  serviceId: string,
  body: AssignStaffToServiceInput,
): Promise<void> {
  return apiFetch<void>(`${base(organizationId, siteId)}/services/${serviceId}/staff`, { method: "PUT", body });
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
  query: { serviceId: string; from: string; days: number; staffId?: string; branchId?: string },
): Promise<BookingAvailabilityResponse> {
  const params = new URLSearchParams({
    serviceId: query.serviceId,
    from: query.from,
    days: String(query.days),
    ...(query.staffId ? { staffId: query.staffId } : {}),
    ...(query.branchId ? { branchId: query.branchId } : {}),
  });
  return apiFetch<BookingAvailabilityResponse>(`${base(organizationId, siteId)}/availability?${params.toString()}`);
}

export function rotateSiteCalendarFeed(organizationId: string, siteId: string): Promise<BookingSettingsResponse> {
  return apiFetch<BookingSettingsResponse>(`${base(organizationId, siteId)}/settings/rotate-calendar-feed`, { method: "POST" });
}

export function rotateStaffCalendarFeed(organizationId: string, siteId: string, staffId: string): Promise<BookingStaffResponse> {
  return apiFetch<BookingStaffResponse>(`${base(organizationId, siteId)}/staff/${staffId}/rotate-calendar-feed`, { method: "POST" });
}

export function getGoogleCalendarStatus(organizationId: string, siteId: string): Promise<GoogleCalendarStatusResponse> {
  return apiFetch<GoogleCalendarStatusResponse>(`${base(organizationId, siteId)}/google-calendar`);
}

export function getGoogleCalendarAuthUrl(
  organizationId: string,
  siteId: string,
  redirectUri: string,
  staffId?: string,
): Promise<{ url: string }> {
  const params = new URLSearchParams({ redirectUri, ...(staffId ? { staffId } : {}) });
  return apiFetch<{ url: string }>(`${base(organizationId, siteId)}/google-calendar/auth-url?${params.toString()}`);
}

export function disconnectGoogleCalendar(organizationId: string, siteId: string, staffId?: string): Promise<void> {
  const params = staffId ? `?staffId=${encodeURIComponent(staffId)}` : "";
  return apiFetch<void>(`${base(organizationId, siteId)}/google-calendar${params}`, { method: "DELETE" });
}

