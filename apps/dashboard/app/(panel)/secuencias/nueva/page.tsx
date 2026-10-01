"use client";

import { EmptyState } from "@impulza/ui";
import { SequenceEditor } from "../../../../components/sequences/sequence-editor";
import { useActiveOrgStore } from "../../../../lib/active-org-store";

// Nueva secuencia de correo (F7.5).

export default function NuevaSecuenciaPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para crear una secuencia." />;
  }
  return <SequenceEditor organizationId={activeOrganizationId} />;
}
