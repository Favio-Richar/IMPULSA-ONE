"use client";

import { EmptyState } from "@impulza/ui";
import { SequencesList } from "../../../components/sequences/sequences-list";
import { useActiveOrgStore } from "../../../lib/active-org-store";

// Secuencias de correo (F7.5, ADR-020).

export default function SecuenciasPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver sus secuencias." />;
  }
  return <SequencesList organizationId={activeOrganizationId} />;
}
