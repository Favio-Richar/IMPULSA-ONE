import type {
  AcceptOwnerInvitationResponse,
  AgencyBillingResponse,
  AgencyClientResponse,
  AgencyDashboardResponse,
  AgencyDuplicateResponse,
  AgencyImportDetailResponse,
  AgencyImportListResponse,
  AgencyImportSummary,
  AgencyIncomingTransfersResponse,
  AgencyLinkResponse,
  AgencyMemberScopeResponse,
  AgencyTeamResponse,
  AgencyOverviewResponse,
  AgencyTransferResponse,
  AgencyStatusResponse,
} from "@impulza/contracts";
import type { AgencyClientAction, AgencyClientStatusValue, AgencyScopeDto, AgencyOverviewQuery, CreateAgencyClientDto, CreateTransferDto, DuplicateClientDto, LinkAgencyClientDto } from "@impulza/validation";
import { apiFetch, apiFetchText } from "../api-client";

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

// ---- panel (F9.4) ------------------------------------------------------------------------------------------------------

export type AgencyOverviewParams = Partial<Pick<AgencyOverviewQuery, "days" | "sort" | "order" | "page" | "pageSize">> & {
  search?: string;
  status?: AgencyClientStatusValue;
};

export function getAgencyDashboard(organizationId: string, days: number): Promise<AgencyDashboardResponse> {
  return apiFetch<AgencyDashboardResponse>(`${agencyPath(organizationId)}/dashboard?days=${days}`);
}

export function getAgencyOverview(organizationId: string, params: AgencyOverviewParams): Promise<AgencyOverviewResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return apiFetch<AgencyOverviewResponse>(`${agencyPath(organizationId)}/overview?${query.toString()}`);
}

// ---- quién paga el plan (F9.5a) ---------------------------------------------------------------------------------------

type BillingMode = "CLIENT_PAYS" | "AGENCY_PAYS";

export function getAgencyClientBilling(organizationId: string, relationId: string): Promise<AgencyBillingResponse> {
  return apiFetch<AgencyBillingResponse>(`${agencyPath(organizationId)}/clients/${relationId}/billing`);
}

export function proposeAgencyBilling(organizationId: string, relationId: string, billingMode: BillingMode): Promise<AgencyBillingResponse> {
  return apiFetch<AgencyBillingResponse>(`${agencyPath(organizationId)}/clients/${relationId}/billing`, { method: "POST", body: { billingMode } });
}

export function cancelAgencyBilling(organizationId: string, relationId: string): Promise<AgencyBillingResponse> {
  return apiFetch<AgencyBillingResponse>(`${agencyPath(organizationId)}/clients/${relationId}/billing/cancel`, { method: "POST" });
}

export function getOwnerBilling(organizationId: string): Promise<AgencyBillingResponse> {
  return apiFetch<AgencyBillingResponse>(`${linkPath(organizationId)}/billing`);
}

export function confirmOwnerBilling(organizationId: string): Promise<AgencyBillingResponse> {
  return apiFetch<AgencyBillingResponse>(`${linkPath(organizationId)}/billing/confirm`, { method: "POST" });
}

export function rejectOwnerBilling(organizationId: string): Promise<AgencyBillingResponse> {
  return apiFetch<AgencyBillingResponse>(`${linkPath(organizationId)}/billing/reject`, { method: "POST" });
}

export function changeOwnerBilling(organizationId: string, billingMode: BillingMode): Promise<AgencyBillingResponse> {
  return apiFetch<AgencyBillingResponse>(`${linkPath(organizationId)}/billing`, { method: "POST", body: { billingMode } });
}

// ---- traspaso de un cliente (F9.5b) -----------------------------------------------------------------------------------

export function startAgencyTransfer(organizationId: string, relationId: string, body: CreateTransferDto): Promise<AgencyTransferResponse> {
  return apiFetch<AgencyTransferResponse>(`${agencyPath(organizationId)}/clients/${relationId}/transfer`, { method: "POST", body });
}

export function cancelAgencyTransfer(organizationId: string, relationId: string): Promise<AgencyTransferResponse> {
  return apiFetch<AgencyTransferResponse>(`${agencyPath(organizationId)}/clients/${relationId}/transfer/cancel`, { method: "POST" });
}

export function listIncomingTransfers(organizationId: string): Promise<AgencyIncomingTransfersResponse> {
  return apiFetch<AgencyIncomingTransfersResponse>(`${agencyPath(organizationId)}/transfers`);
}

export function acceptIncomingTransfer(organizationId: string, transferId: string): Promise<AgencyIncomingTransfersResponse> {
  return apiFetch<AgencyIncomingTransfersResponse>(`${agencyPath(organizationId)}/transfers/${transferId}/accept`, { method: "POST" });
}

export function rejectIncomingTransfer(organizationId: string, transferId: string): Promise<AgencyIncomingTransfersResponse> {
  return apiFetch<AgencyIncomingTransfersResponse>(`${agencyPath(organizationId)}/transfers/${transferId}/reject`, { method: "POST" });
}

export function getOwnerTransfer(organizationId: string): Promise<AgencyTransferResponse> {
  return apiFetch<AgencyTransferResponse>(`${linkPath(organizationId)}/transfer`);
}

export function acceptOwnerTransfer(organizationId: string): Promise<AgencyTransferResponse> {
  return apiFetch<AgencyTransferResponse>(`${linkPath(organizationId)}/transfer/accept`, { method: "POST" });
}

export function rejectOwnerTransfer(organizationId: string): Promise<AgencyTransferResponse> {
  return apiFetch<AgencyTransferResponse>(`${linkPath(organizationId)}/transfer/reject`, { method: "POST" });
}

// ---- duplicar un cliente (F9.5c) --------------------------------------------------------------------------------------

/** Crea un cliente NUEVO con el contenido del sitio del origen (en borrador, sin datos personales). Idempotente por `idempotencyKey`. */
export function duplicateAgencyClient(organizationId: string, relationId: string, body: DuplicateClientDto): Promise<AgencyDuplicateResponse> {
  return apiFetch<AgencyDuplicateResponse>(`${agencyPath(organizationId)}/clients/${relationId}/duplicate`, { method: "POST", body });
}

// ---- importar clientes por CSV (F9.5d) --------------------------------------------------------------------------------

const importsPath = (organizationId: string) => `${agencyPath(organizationId)}/clients`;

/** El texto de la plantilla CSV (con BOM y separado por punto y coma). */
export function downloadImportTemplate(organizationId: string): Promise<string> {
  return apiFetchText(`${importsPath(organizationId)}/import/template`);
}

/** Sube el archivo: el servidor lo valida fila por fila y lo encola; el worker crea los clientes. Responde al instante. */
export function uploadAgencyImport(organizationId: string, body: { csv: string; fileName?: string }): Promise<AgencyImportSummary> {
  return apiFetch<AgencyImportSummary>(`${importsPath(organizationId)}/import`, { method: "POST", body });
}

export function listAgencyImports(organizationId: string): Promise<AgencyImportListResponse> {
  return apiFetch<AgencyImportListResponse>(`${importsPath(organizationId)}/imports`);
}

export function getAgencyImport(organizationId: string, importId: string, params: { page: number; pageSize: number; onlyErrors: boolean }): Promise<AgencyImportDetailResponse> {
  const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize), onlyErrors: String(params.onlyErrors) });
  return apiFetch<AgencyImportDetailResponse>(`${importsPath(organizationId)}/imports/${importId}?${query.toString()}`);
}

/** El informe de errores como CSV seguro (sin fórmulas ejecutables), listo para corregir y volver a subir. */
export function downloadImportErrors(organizationId: string, importId: string): Promise<string> {
  return apiFetchText(`${importsPath(organizationId)}/imports/${importId}/errors.csv`);
}

// ---- equipo de la agencia: acceso por cliente y módulo (F9.6b) ---------------------------------------------------------

export function getAgencyTeam(organizationId: string): Promise<AgencyTeamResponse> {
  return apiFetch<AgencyTeamResponse>(`${agencyPath(organizationId)}/team`);
}

export function setAgencyMemberScope(organizationId: string, userId: string, body: AgencyScopeDto): Promise<AgencyMemberScopeResponse> {
  return apiFetch<AgencyMemberScopeResponse>(`${agencyPath(organizationId)}/team/${userId}/scope`, { method: "PUT", body });
}
