"use client";

import { EmptyState } from "@impulza/ui";
import { CampaignsList } from "../../../components/campaigns/campaigns-list";
import { useActiveOrgStore } from "../../../lib/active-org-store";

// Campañas de email (F5.6).

export default function CampanasPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver sus campañas." />;
  }
  return <CampaignsList organizationId={activeOrganizationId} />;
}
