"use client";

import { ShieldAlert } from "lucide-react";
import { useActiveOrgStore } from "../lib/active-org-store";
import type { Organization } from "../lib/api/organizations";

/**
 * Aviso permanente cuando la organización activa está bloqueada por superadministración (F4.4,
 * ADR-005 §6). El servidor ya rechaza toda escritura (`403 ORGANIZATION_BLOCKED`); esto explica
 * **por qué** antes de que el usuario choque con un error en cada formulario, y deja claro que
 * puede seguir viendo y exportando sus datos.
 */
export function BlockedOrganizationBanner({ organizations }: { organizations: Organization[] }): React.JSX.Element | null {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  const active = organizations.find((org) => org.id === activeOrganizationId);

  if (!active || active.status !== "BLOCKED") {
    return null;
  }

  return (
    <div role="alert" className="flex gap-3 border-b border-danger/30 bg-danger/5 px-4 py-3 text-sm md:px-6">
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium text-foreground">{active.name} está bloqueada: tu sitio no está visible y el panel está en solo lectura.</p>
        <p className="text-muted-foreground">
          {active.blockedReason ? <>Motivo: {active.blockedReason}. </> : null}
          Puedes seguir viendo y exportando tus datos. Para resolverlo, contacta a soporte de Impulza One.
        </p>
      </div>
    </div>
  );
}
