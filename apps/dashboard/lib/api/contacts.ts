import type { ContactDetailResponse, ContactResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

export interface ContactFilters {
  tag?: string;
  commercialStatus?: string;
  consentStatus?: string;
  search?: string;
}

function contactsPath(organizationId: string): string {
  return `/organizations/${organizationId}/contacts`;
}

export function listContacts(organizationId: string, filters: ContactFilters): Promise<ContactResponse[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return apiFetch<ContactResponse[]>(`${contactsPath(organizationId)}${query ? `?${query}` : ""}`);
}

export function getContact(organizationId: string, contactId: string): Promise<ContactDetailResponse> {
  return apiFetch<ContactDetailResponse>(`${contactsPath(organizationId)}/${contactId}`);
}

export function createContact(
  organizationId: string,
  body: { name?: string; email?: string; phone?: string; tags?: string[] },
): Promise<ContactResponse> {
  return apiFetch<ContactResponse>(contactsPath(organizationId), { method: "POST", body });
}

export function updateContact(
  organizationId: string,
  contactId: string,
  changes: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    tags?: string[];
    commercialStatus?: string;
    assignedToId?: string | null;
  },
): Promise<ContactDetailResponse> {
  return apiFetch<ContactDetailResponse>(`${contactsPath(organizationId)}/${contactId}`, {
    method: "PATCH",
    body: changes,
  });
}

export function addContactNote(
  organizationId: string,
  contactId: string,
  note: string,
): Promise<ContactDetailResponse> {
  return apiFetch<ContactDetailResponse>(`${contactsPath(organizationId)}/${contactId}/notes`, {
    method: "POST",
    body: { note },
  });
}

export function deleteContact(organizationId: string, contactId: string): Promise<void> {
  return apiFetch<void>(`${contactsPath(organizationId)}/${contactId}`, { method: "DELETE" });
}

export function exportContact(organizationId: string, contactId: string): Promise<ContactDetailResponse> {
  return apiFetch<ContactDetailResponse>(`${contactsPath(organizationId)}/${contactId}/export`);
}
