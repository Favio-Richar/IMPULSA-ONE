import type { CreateAbTestInput } from "@impulza/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applyAbTest, createAbTest, listAbTests, stopAbTest } from "../api/ab-tests";

function testsKey(organizationId: string, siteId: string) {
  return ["ab-tests", organizationId, siteId] as const;
}

/** Pruebas A/B del sitio (F6.5), con resultados. Se refrescan cada minuto mientras la pantalla está abierta. */
export function useAbTests(organizationId: string, siteId: string) {
  return useQuery({ queryKey: testsKey(organizationId, siteId), queryFn: () => listAbTests(organizationId, siteId), refetchInterval: 60_000 });
}

export function useCreateAbTest(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAbTestInput) => createAbTest(organizationId, siteId, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: testsKey(organizationId, siteId) }),
  });
}

export function useStopAbTest(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (testId: string) => stopAbTest(organizationId, siteId, testId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: testsKey(organizationId, siteId) }),
  });
}

/** Aplicar B cambia el borrador del bloque: también se refrescan los bloques de esa página. */
export function useApplyAbTest(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ testId, variant }: { testId: string; variant: "a" | "b" }) => applyAbTest(organizationId, siteId, testId, variant),
    onSuccess: (test) => {
      void queryClient.invalidateQueries({ queryKey: testsKey(organizationId, siteId) });
      void queryClient.invalidateQueries({ queryKey: ["blocks", organizationId, siteId, test.pageId] });
    },
  });
}
