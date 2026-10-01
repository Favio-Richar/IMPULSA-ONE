import type { EmailSequenceEnrollmentResponse, EmailSequenceResponse } from "@impulza/contracts";
import type { CreateEmailSequenceInput, UpdateEmailSequenceInput } from "@impulza/validation";
import { apiFetch } from "../api-client";

function sequencesPath(organizationId: string): string {
  return `/organizations/${organizationId}/email-sequences`;
}

export function listSequences(organizationId: string): Promise<EmailSequenceResponse[]> {
  return apiFetch<EmailSequenceResponse[]>(sequencesPath(organizationId));
}

export function createSequence(organizationId: string, body: CreateEmailSequenceInput): Promise<EmailSequenceResponse> {
  return apiFetch<EmailSequenceResponse>(sequencesPath(organizationId), { method: "POST", body });
}

export function updateSequence(organizationId: string, sequenceId: string, body: UpdateEmailSequenceInput): Promise<EmailSequenceResponse> {
  return apiFetch<EmailSequenceResponse>(`${sequencesPath(organizationId)}/${sequenceId}`, { method: "PATCH", body });
}

export function deleteSequence(organizationId: string, sequenceId: string): Promise<void> {
  return apiFetch<void>(`${sequencesPath(organizationId)}/${sequenceId}`, { method: "DELETE" });
}

export function listSequenceEnrollments(organizationId: string, sequenceId: string): Promise<EmailSequenceEnrollmentResponse[]> {
  return apiFetch<EmailSequenceEnrollmentResponse[]>(`${sequencesPath(organizationId)}/${sequenceId}/enrollments`);
}

export function stopSequenceEnrollment(organizationId: string, sequenceId: string, enrollmentId: string): Promise<void> {
  return apiFetch<void>(`${sequencesPath(organizationId)}/${sequenceId}/enrollments/${enrollmentId}/stop`, { method: "POST" });
}

export function sendSequenceStepTest(organizationId: string, sequenceId: string, position: number): Promise<void> {
  return apiFetch<void>(`${sequencesPath(organizationId)}/${sequenceId}/steps/${position}/test`, { method: "POST" });
}
