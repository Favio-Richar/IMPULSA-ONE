import type { FormResponse, FormSubmissionListResponse } from "@impulza/contracts";
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
  body: { name: string; type?: FormResponse["type"]; fields?: CreateFormFieldBody[] },
): Promise<FormResponse> {
  return apiFetch<FormResponse>(formsPath(organizationId, siteId), { method: "POST", body });
}

export interface UpdateFormBody {
  name?: string;
  type?: FormResponse["type"];
  successAction?: { message: string; redirectUrl?: string };
}

export function updateForm(organizationId: string, siteId: string, formId: string, body: UpdateFormBody): Promise<FormResponse> {
  return apiFetch<FormResponse>(`${formsPath(organizationId, siteId)}/${formId}`, { method: "PATCH", body });
}

export async function deleteForm(organizationId: string, siteId: string, formId: string): Promise<void> {
  await apiFetch<unknown>(`${formsPath(organizationId, siteId)}/${formId}`, { method: "DELETE" });
}

export function addFormField(organizationId: string, siteId: string, formId: string, body: CreateFormFieldBody): Promise<FormResponse> {
  return apiFetch<FormResponse>(`${formsPath(organizationId, siteId)}/${formId}/fields`, { method: "POST", body });
}

export function updateFormField(
  organizationId: string,
  siteId: string,
  formId: string,
  fieldId: string,
  body: { label?: string; required?: boolean; options?: string[]; position?: number },
): Promise<FormResponse> {
  return apiFetch<FormResponse>(`${formsPath(organizationId, siteId)}/${formId}/fields/${fieldId}`, { method: "PATCH", body });
}

export function deleteFormField(organizationId: string, siteId: string, formId: string, fieldId: string): Promise<FormResponse> {
  return apiFetch<FormResponse>(`${formsPath(organizationId, siteId)}/${formId}/fields/${fieldId}`, { method: "DELETE" });
}

export function listFormSubmissions(
  organizationId: string,
  siteId: string,
  formId: string,
  page: { limit: number; offset: number },
): Promise<FormSubmissionListResponse> {
  return apiFetch<FormSubmissionListResponse>(
    `${formsPath(organizationId, siteId)}/${formId}/submissions?limit=${page.limit}&offset=${page.offset}`,
  );
}
