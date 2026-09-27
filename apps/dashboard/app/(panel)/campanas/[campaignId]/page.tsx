"use client";

import { EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { useParams } from "next/navigation";
import { CampaignEditor } from "../../../../components/campaigns/campaign-editor";
import { CampaignReport } from "../../../../components/campaigns/campaign-report";
import { useActiveOrgStore } from "../../../../lib/active-org-store";
import { ApiError } from "../../../../lib/api-client";
import { useCampaign } from "../../../../lib/hooks/use-campaigns";

// Una campaña (F5.6): en borrador se edita; enviada o enviándose, se ve su informe.

export default function CampanaPage(): React.JSX.Element {
  const params = useParams<{ campaignId: string }>();
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver esta campaña." />;
  }
  return <Campaign organizationId={activeOrganizationId} campaignId={params.campaignId} />;
}

function Campaign({ organizationId, campaignId }: { organizationId: string; campaignId: string }): React.JSX.Element {
  const campaignQuery = useCampaign(organizationId, campaignId);
  if (campaignQuery.isPending) return <LoadingState label="Cargando campaña…" />;
  if (campaignQuery.isError) {
    if (campaignQuery.error instanceof ApiError && campaignQuery.error.status === 404) {
      return <ErrorState title="Campaña no encontrada" description="No existe, o es de otra organización." />;
    }
    return <ErrorState onRetry={() => campaignQuery.refetch()} />;
  }
  const campaign = campaignQuery.data;
  // `key`: al pasar de borrador a envío, el informe reemplaza al editor sin arrastrar su estado.
  return campaign.status === "DRAFT" ? (
    <CampaignEditor key={`${campaign.id}-draft`} organizationId={organizationId} campaign={campaign} />
  ) : (
    <CampaignReport key={`${campaign.id}-report`} organizationId={organizationId} campaign={campaign} />
  );
}
