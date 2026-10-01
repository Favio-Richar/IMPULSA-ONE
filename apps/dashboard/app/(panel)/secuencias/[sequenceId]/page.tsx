"use client";

import { EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { useParams } from "next/navigation";
import { SequenceEditor } from "../../../../components/sequences/sequence-editor";
import { useActiveOrgStore } from "../../../../lib/active-org-store";
import { useSequences } from "../../../../lib/hooks/use-sequences";

// Una secuencia de correo (F7.5): se edita en el mismo lugar donde se creó.

export default function SecuenciaPage(): React.JSX.Element {
  const params = useParams<{ sequenceId: string }>();
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver esta secuencia." />;
  }
  return <Sequence organizationId={activeOrganizationId} sequenceId={params.sequenceId} />;
}

function Sequence({ organizationId, sequenceId }: { organizationId: string; sequenceId: string }): React.JSX.Element {
  const query = useSequences(organizationId);
  if (query.isPending) return <LoadingState label="Cargando secuencia…" />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
  const sequence = query.data.find((candidate) => candidate.id === sequenceId);
  if (!sequence) return <ErrorState title="Secuencia no encontrada" description="No existe, o es de otra organización." />;
  // `key` con la fecha de actualización: si otra persona la cambia, el editor se recarga limpio.
  return <SequenceEditor key={`${sequence.id}-${sequence.updatedAt}`} organizationId={organizationId} sequence={sequence} />;
}
