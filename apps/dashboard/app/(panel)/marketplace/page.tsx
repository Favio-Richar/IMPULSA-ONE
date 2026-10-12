"use client";

import { EmptyState } from "@impulza/ui";
import { MarketplacePanel } from "../../../components/marketplace/marketplace-panel";
import { useActiveOrgStore } from "../../../lib/active-org-store";

// Marketplace de integraciones y plantillas (F10.6, ADR-029).

export default function MarketplacePage(): React.JSX.Element {
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!organizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver el marketplace." />;
  }
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Marketplace</h1>
        <p className="text-sm text-muted-foreground">Plantillas e integraciones de socios, revisadas por la plataforma. Instálalas y quítalas cuando quieras.</p>
      </header>
      <MarketplacePanel organizationId={organizationId} />
    </div>
  );
}
