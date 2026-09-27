"use client";

import { EmptyState } from "@impulza/ui";
import { CampaignEditor } from "../../../../components/campaigns/campaign-editor";
import { useActiveOrgStore } from "../../../../lib/active-org-store";

// Nueva campaña (F5.6).

export default function NuevaCampanaPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para crear una campaña." />;
  }
  return <CampaignEditor organizationId={activeOrganizationId} />;
}
