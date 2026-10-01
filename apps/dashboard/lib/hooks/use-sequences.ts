import type { CreateEmailSequenceInput, UpdateEmailSequenceInput } from "@impulza/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSequence,
  deleteSequence,
  listSequenceEnrollments,
  listSequences,
  sendSequenceStepTest,
  stopSequenceEnrollment,
  updateSequence,
} from "../api/sequences";

function sequencesKey(organizationId: string) {
  return ["email-sequences", organizationId] as const;
}

/** Secuencias de correo de la organización (F7.5), con sus pasos y avance. */
export function useSequences(organizationId: string) {
  return useQuery({ queryKey: sequencesKey(organizationId), queryFn: () => listSequences(organizationId), refetchInterval: 60_000 });
}

export function useSequenceEnrollments(organizationId: string, sequenceId: string | null) {
  return useQuery({
    queryKey: [...sequencesKey(organizationId), sequenceId, "enrollments"] as const,
    queryFn: () => listSequenceEnrollments(organizationId, sequenceId!),
    enabled: sequenceId !== null,
  });
}

function useInvalidate(organizationId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: sequencesKey(organizationId) });
}

export function useCreateSequence(organizationId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({ mutationFn: (body: CreateEmailSequenceInput) => createSequence(organizationId, body), onSuccess: () => void invalidate() });
}

export function useUpdateSequence(organizationId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({
    mutationFn: ({ sequenceId, changes }: { sequenceId: string; changes: UpdateEmailSequenceInput }) => updateSequence(organizationId, sequenceId, changes),
    // Pendiente hasta tener la lista nueva: el interruptor no parpadea.
    onSuccess: () => invalidate(),
  });
}

export function useDeleteSequence(organizationId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({ mutationFn: (sequenceId: string) => deleteSequence(organizationId, sequenceId), onSuccess: () => void invalidate() });
}

export function useStopEnrollment(organizationId: string, sequenceId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({ mutationFn: (enrollmentId: string) => stopSequenceEnrollment(organizationId, sequenceId, enrollmentId), onSuccess: () => void invalidate() });
}

export function useSendStepTest(organizationId: string, sequenceId: string) {
  return useMutation({ mutationFn: (position: number) => sendSequenceStepTest(organizationId, sequenceId, position) });
}
