import type { ReportResponse } from "@impulza/contracts";
import { apiFetch, apiFetchText } from "../api-client";

// Informe por cliente (F9.8, ADR-028 §6): cifras agregadas de la organización activa, con su comparación de periodos.

const path = (organizationId: string, from: string, to: string, suffix = "summary") =>
  `/organizations/${organizationId}/reports/${suffix}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

export function getReport(organizationId: string, from: string, to: string): Promise<ReportResponse> {
  return apiFetch<ReportResponse>(path(organizationId, from, to));
}

export function getReportCsv(organizationId: string, from: string, to: string): Promise<string> {
  return apiFetchText(path(organizationId, from, to, "summary.csv"));
}
