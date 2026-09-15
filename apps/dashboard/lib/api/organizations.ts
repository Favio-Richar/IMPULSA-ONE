import { apiFetch } from "../api-client";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  planId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  membershipId: string;
  userId: string;
  email: string;
  role: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
}

export function listMyOrganizations(): Promise<Organization[]> {
  return apiFetch<Organization[]>("/organizations");
}

export function createOrganization(name: string, slug: string): Promise<Organization> {
  return apiFetch<Organization>("/organizations", { method: "POST", body: { name, slug } });
}

export function listMembers(organizationId: string): Promise<Member[]> {
  return apiFetch<Member[]>(`/organizations/${organizationId}/members`);
}

export function inviteMember(organizationId: string, email: string, role: string): Promise<{ membershipId: string }> {
  return apiFetch(`/organizations/${organizationId}/members`, {
    method: "POST",
    body: { email, role },
  });
}
