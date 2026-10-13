"use client";

import { EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SubscribePagePanel } from "../../../../../components/subscribe-page/subscribe-page-panel";
import { useActiveOrgStore } from "../../../../../lib/active-org-store";
import { ApiError } from "../../../../../lib/api-client";
import { useSite } from "../../../../../lib/hooks/use-sites";

// Página de suscripción del sitio (extra F10, ADR-029): a donde lleva el botón «Suscribirme» del portal.

export default function SuscripcionPage(): React.JSX.Element {
  const params = useParams<{ siteId: string }>();
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!organizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para administrar su página de suscripción." />;
  }
  return <Subscription organizationId={organizationId} siteId={params.siteId} />;
}

function Subscription({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const site = useSite(organizationId, siteId);
  if (site.isPending) return <LoadingState label="Cargando el sitio…" />;
  if (site.isError) {
    const notFound = site.error instanceof ApiError && site.error.status === 404;
    return notFound ? <ErrorState title="Sitio no encontrado" description="No existe, o es de otra organización." /> : <ErrorState onRetry={() => site.refetch()} />;
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href={`/sitios/${siteId}`} className="w-fit text-sm text-muted-foreground hover:text-foreground">
          ← {site.data.name}
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Suscripción</h1>
        <p className="text-sm text-muted-foreground">
          Tu portal lleva un solo botón «Suscribirme». Al tocarlo, la persona llega a esta página, que tú personalizas, y se suscribe gratis o elige uno de tus planes de pago.
        </p>
      </header>
      <SubscribePagePanel organizationId={organizationId} siteId={siteId} />
    </div>
  );
}
