import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeasurementSettingsInput } from "@impulza/validation";
import {
  archiveSite,
  assignSiteTheme,
  createSite,
  getSite,
  getSiteBackground,
  getSiteMeasurement,
  getSiteTheme,
  listSites,
  setSiteBackground,
  setSiteMeasurement,
  updateSite,
} from "../api/sites";

// `organizationId` en cada queryKey (F2.9): cambiar de organización activa invalida el caché de la
// anterior en vez de arrastrarlo — el servidor ya aísla por su cuenta (ADR-002), esto es solo para
// que la UI nunca muestre, ni por un instante, sitios de la organización equivocada.
//
// Todos estos hooks piden `organizationId` ya resuelto (no `| null`): el mismo criterio que
// `InviteMemberForm` en configuracion/page.tsx — el componente que llama resuelve primero el caso
// "sin organización activa" con un `EmptyState`, así el hook nunca tiene que decidir qué hacer con
// un id ausente.

export function useSites(organizationId: string) {
  return useQuery({
    queryKey: ["sites", organizationId],
    queryFn: () => listSites(organizationId),
  });
}

export function useSite(organizationId: string, siteId: string) {
  return useQuery({
    queryKey: ["sites", organizationId, siteId],
    queryFn: () => getSite(organizationId, siteId),
  });
}

export function useCreateSite(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, slug }: { name: string; slug: string }) => createSite(organizationId, name, slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sites", organizationId] });
    },
  });
}

export function useUpdateSite(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: { name?: string; slug?: string }) => updateSite(organizationId, siteId, changes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sites", organizationId] });
    },
  });
}

export function useArchiveSite(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => archiveSite(organizationId, siteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sites", organizationId] });
    },
  });
}

export function useSiteTheme(organizationId: string, siteId: string) {
  return useQuery({
    queryKey: ["sites", organizationId, siteId, "theme"],
    queryFn: () => getSiteTheme(organizationId, siteId),
  });
}

export function useAssignSiteTheme(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (themeId: string | null) => assignSiteTheme(organizationId, siteId, themeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sites", organizationId, siteId] });
    },
  });
}

export function useSiteBackground(organizationId: string, siteId: string) {
  return useQuery({
    queryKey: ["sites", organizationId, siteId, "background"],
    queryFn: () => getSiteBackground(organizationId, siteId),
  });
}

export function useSetSiteBackground(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (background: unknown) => setSiteBackground(organizationId, siteId, background),
    onSuccess: (data) => {
      queryClient.setQueryData(["sites", organizationId, siteId, "background"], data);
    },
  });
}

export function useSiteMeasurement(organizationId: string, siteId: string) {
  return useQuery({
    queryKey: ["sites", organizationId, siteId, "measurement"],
    queryFn: () => getSiteMeasurement(organizationId, siteId),
  });
}

export function useSetSiteMeasurement(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MeasurementSettingsInput) => setSiteMeasurement(organizationId, siteId, body),
    onSuccess: (data) => {
      queryClient.setQueryData(["sites", organizationId, siteId, "measurement"], data);
    },
  });
}
