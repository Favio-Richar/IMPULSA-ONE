"use client";

import { EmptyState } from "@impulza/ui";
import { ModerationPanel } from "../../../../components/moderation/moderation-panel";
import { useActiveOrgStore } from "../../../../lib/active-org-store";

/** Configuración › Moderación: medidas aplicadas a tu negocio tras un reporte, y cómo apelarlas (F9.9d, ADR-028 §7). */
export default function ConfiguracionModeracionPage(): React.JSX.Element {
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!organizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver sus medidas de moderación." />;
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Moderación</h1>
        <p className="text-sm text-muted-foreground">
          Cualquier persona puede reportar una página pública. Ninguna página se despublica de forma automática: una persona del equipo revisa cada caso, te explica su
          decisión y puedes apelarla.
        </p>
      </header>
      <ModerationPanel organizationId={organizationId} />
    </div>
  );
}
