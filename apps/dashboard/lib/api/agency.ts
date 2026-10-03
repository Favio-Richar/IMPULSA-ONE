import type {
  AcceptOwnerInvitationResponse,
  AgencyClientResponse,
  AgencyLinkResponse,
  AgencyStatusResponse,
} from "@impulza/contracts";
import type { AgencyClientAction, CreateAgencyClientDto, LinkAgencyClientDto } from "@impulza/validation";
import { apiFetch } from "../api-client";

// Modo agencia (F9.3, ADR-028 §2). Todo se resuelve en el servidor por la membresía real del usuario.

const agencyPath = (organizationId: string) => `/organizations/${organizationId}/agency`;
const linkPath = (organizationId: string) => `/organizations/${organizationId}/agency-link`;

export function getAgencyStatus(organizationId: string): Promise<AgencyStatusResponse> {
  return apiFetch<AgencyStatusResponse>(agencyPath(organizationId));
}

export function enableAgency(organizationId: string): Promise<AgencyStatusResponse> {
  return apiFetch<AgencyStatusResponse>(`${agencyPath(organizationId)}/enable`, { method: "POST" });
}

export function listAgencyClients(organizationId: string): Promise<AgencyClientResponse[]> {
  return apiFetch<AgencyClientResponse[]>(`${agencyPath(organizationId)}/clients`);
}

export function createAgencyClient(organizationId: string, body: CreateAgencyClientDto): Promise<AgencyClientResponse> {
  return apiFetch<AgencyClientResponse>(`${agencyPath(organizationId)}/clients`, { method: "POST", body });
}

export function requestAgencyLink(organizationId: string, body: LinkAgencyClientDto): Promise<AgencyClientResponse> {
  return apiFetch<AgencyClientResponse>(`${agencyPath(organizationId)}/clients/link`, { method: "POST", body });
}

/** `hidePublicSite` solo vale al pausar o archivar: `true` oculta el sitio público del cliente (reversible), `false` lo deja visible. */
export function actOnAgencyClient(
  organizationId: string,
  clientId: string,
  action: AgencyClientAction,
  hidePublicSite?: boolean,
): Promise<AgencyClientResponse> {
  return apiFetch<AgencyClientResponse>(`${agencyPath(organizationId)}/clients/${clientId}/actions`, {
    method: "POST",
    body: hidePublicSite === undefined ? { action } : { action, hidePublicSite },
  });
}

// ---- lado del negocio ------------------------------------------------------------------------------------

export function getAgencyLink(organizationId: string): Promise<AgencyLinkResponse> {
  return apiFetch<AgencyLinkResponse>(linkPath(organizationId));
}

export function acceptAgencyLink(organizationId: string): Promise<AgencyLinkResponse> {
  return apiFetch<AgencyLinkResponse>(`${linkPath(organizationId)}/accept`, { method: "POST" });
}

export function rejectAgencyLink(organizationId: string): Promise<void> {
  return apiFetch<void>(`${linkPath(organizationId)}/reject`, { method: "POST" });
}

export function revokeAgencyLink(organizationId: string): Promise<void> {
  return apiFetch<void>(linkPath(organizationId), { method: "DELETE" });
}

export function acceptOwnerInvitation(token: string): Promise<AcceptOwnerInvitationResponse> {
  return apiFetch<AcceptOwnerInvitationResponse>("/agency-invitations/accept", { method: "POST", body: { token } });
}
