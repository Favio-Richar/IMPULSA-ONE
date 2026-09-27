"use client";

import { EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { OrdersView } from "../../../components/orders/orders-view";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { useSites } from "../../../lib/hooks/use-sites";

// Pedidos del negocio (F5.5).

export default function PedidosPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver sus pedidos." />;
  }
  return <Orders organizationId={activeOrganizationId} />;
}

function Orders({ organizationId }: { organizationId: string }): React.JSX.Element {
  const sitesQuery = useSites(organizationId);
  if (sitesQuery.isPending) return <LoadingState label="Cargando pedidos…" />;
  if (sitesQuery.isError) return <ErrorState onRetry={() => sitesQuery.refetch()} />;
  return <OrdersView organizationId={organizationId} sites={sitesQuery.data} />;
}
