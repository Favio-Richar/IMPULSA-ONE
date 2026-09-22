import type { FormResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

function formsPath(organizationId: string, siteId: string): string {
  return `/organizations/${organizationId}/sites/${siteId}/forms`;
}

export function listForms(organizationId: string, siteId: string): Promise<FormResponse[]> {
  return apiFetch<FormResponse[]>(formsPath(organizationId, siteId));
}

export interface CreateFormFieldBody {
  type: "TEXT" | "TEXTAREA" | "EMAIL" | "PHONE" | "NUMBER" | "SELECT" | "CHECKBOX" | "CONSENT";
  label: string;
  required?: boolean;
  options?: string[];
}

export function createForm(
  organizationId: string,
  siteId: string,
  body: { name: string; fields?: CreateFormFieldBody[] },
): Promise<FormResponse> {
  return apiFetch<FormResponse>(formsPath(organizationId, siteId), { method: "POST", body });
}
