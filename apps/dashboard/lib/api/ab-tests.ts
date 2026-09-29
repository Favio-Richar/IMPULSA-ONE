import type { AbTestResponse } from "@impulza/contracts";
import type { CreateAbTestInput } from "@impulza/validation";
import { apiFetch } from "../api-client";

function testsPath(organizationId: string, siteId: string): string {
  return `/organizations/${organizationId}/sites/${siteId}/ab-tests`;
}

export function listAbTests(organizationId: string, siteId: string): Promise<AbTestResponse[]> {
  return apiFetch<AbTestResponse[]>(testsPath(organizationId, siteId));
}

export function createAbTest(organizationId: string, siteId: string, body: CreateAbTestInput): Promise<AbTestResponse> {
  return apiFetch<AbTestResponse>(testsPath(organizationId, siteId), { method: "POST", body });
}

export function stopAbTest(organizationId: string, siteId: string, testId: string): Promise<AbTestResponse> {
  return apiFetch<AbTestResponse>(`${testsPath(organizationId, siteId)}/${testId}/stop`, { method: "POST" });
}

export function applyAbTest(organizationId: string, siteId: string, testId: string, variant: "a" | "b"): Promise<AbTestResponse> {
  return apiFetch<AbTestResponse>(`${testsPath(organizationId, siteId)}/${testId}/apply`, { method: "POST", body: { variant } });
}
