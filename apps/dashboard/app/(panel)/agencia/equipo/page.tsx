"use client";

import { EmptyState } from "@impulza/ui";
import Link from "next/link";
import { AgencyTeamCard } from "../../../../components/agency/agency-team-card";
import { useActiveOrgStore } from "../../../../lib/active-org-store";
import { useAgencyStatus } from "../../../../lib/hooks/use-agency";

/** Agencia › Equipo: hasta dónde llega cada persona de la agencia en los negocios de los clientes (F9.6b, ADR-028 §3). */
export default function AgenciaEquipoPage(): React.JSX.Element {
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!organizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige tu agencia arriba para ver su equipo." />;
  }
  return <View organizationId={organizationId} />;
}

function View({ organizationId }: { organizationId: string }): React.JSX.Element {
  const status = useAgencyStatus(organizationId);
  if (status.data && status.data.kind !== "AGENCY") {
    return <EmptyState title="Esta organización no es una agencia" description="Activa el modo agencia en Configuración › Agencia." />;
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Equipo de la agencia</h1>
        <p className="text-sm text-muted-foreground">
          <Link href="/agencia" className="text-primary underline underline-offset-2">
            ← Volver a Agencia
          </Link>
        </p>
      </header>
      <AgencyTeamCard organizationId={organizationId} />
    </div>
  );
}
