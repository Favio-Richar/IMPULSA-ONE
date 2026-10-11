import { apiFetch } from "../api-client";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  planId: string | null;
  /** `BLOCKED` = bloqueada por superadministración: solo lectura (F4.4, ADR-005 §6). */
  status: "ACTIVE" | "BLOCKED";
  /** `AGENCY` = administra a otras organizaciones (F9.3, ADR-028). */
  kind: "BUSINESS" | "AGENCY";
  blockedAt: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** Cómo llegó el usuario a esta organización: propia, o delegada por una agencia (F9.3). Solo viene en la lista. */
  access?: { delegated: boolean; agencyOrganizationId: string | null; agencyName: string | null; readOnly: boolean; /** Módulos permitidos por la agencia (F9.6b); vacío = todos. */ modules: string[]; /** Visor del portal del cliente (F9.7e): solo ve Aprobaciones. */ clientViewer: boolean };
}

export interface Member {
  membershipId: string;
  userId: string;
  email: string;
  role: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
  /** `AGENCY` = acceso delegado por una agencia (F9.3). */
  source: "DIRECT" | "AGENCY";
  /** Rol personalizado de la organización (F9.6a): si lo tiene, `role` trae su nombre. */
  customRoleId: string | null;
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
