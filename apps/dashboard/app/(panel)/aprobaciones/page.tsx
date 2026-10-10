"use client";

import { EmptyState } from "@impulza/ui";
import { PublishRequestsPanel } from "../../../components/publish/requests-panel";
import { useActiveOrgStore } from "../../../lib/active-org-store";

/** Aprobaciones: la cola y el historial de solicitudes de publicación del equipo (F9.6c, ADR-028 §3). */
export default function AprobacionesPage(): React.JSX.Element {
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!organizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver sus solicitudes de publicación." />;
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Aprobaciones</h1>
        <p className="text-sm text-muted-foreground">
          Revisa lo que tu equipo pide publicar. Nada sale al público sin que lo apruebe alguien con permiso.
        </p>
      </header>
      <PublishRequestsPanel organizationId={organizationId} />
    </div>
  );
}
