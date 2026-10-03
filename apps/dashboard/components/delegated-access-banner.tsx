"use client";

import { Briefcase } from "lucide-react";
import { useActiveOrgStore } from "../lib/active-org-store";
import type { Organization } from "../lib/api/organizations";

/**
 * Aviso permanente cuando se está dentro del negocio de un cliente a través de una agencia (F9.3, ADR-028 §2): deja
 * claro de quién es el espacio y, si el cliente está en pausa, que solo se puede mirar. El servidor es quien aplica
 * la regla (cada acción queda a nombre de la persona y de la agencia); esto solo explica el porqué.
 */
export function DelegatedAccessBanner({ organizations }: { organizations: Organization[] }): React.JSX.Element | null {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  const active = organizations.find((org) => org.id === activeOrganizationId);

  if (!active?.access?.delegated) {
    return null;
  }

  return (
    <div role="status" data-testid="delegated-banner" className="flex gap-3 border-b border-info/30 bg-info/5 px-4 py-3 text-sm md:px-6">
      <Briefcase className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium text-foreground">
          Estás en el espacio de {active.name} como parte de {active.access.agencyName ?? "tu agencia"}.
        </p>
        <p className="text-muted-foreground">
          {active.access.readOnly
            ? "Este cliente está en pausa: puedes ver, pero no hacer cambios."
            : "Todo lo que hagas queda registrado a tu nombre y al de tu agencia. Su equipo, sus cobros y la exportación de sus contactos los decide su propietario."}
        </p>
      </div>
    </div>
  );
}
