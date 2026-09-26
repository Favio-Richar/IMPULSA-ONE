"use client";

import { EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { AgendaView } from "../../../components/agenda/agenda-view";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { useSites } from "../../../lib/hooks/use-sites";

// Agenda de reservas del negocio (F5.3).

export default function ReservasAgendaPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver su agenda." />;
  }
  return <Agenda organizationId={activeOrganizationId} />;
}

function Agenda({ organizationId }: { organizationId: string }): React.JSX.Element {
  const sitesQuery = useSites(organizationId);
  if (sitesQuery.isPending) return <LoadingState label="Cargando agenda…" />;
  if (sitesQuery.isError) return <ErrorState onRetry={() => sitesQuery.refetch()} />;
  return <AgendaView organizationId={organizationId} sites={sitesQuery.data} />;
}
