"use client";

import { EmptyState } from "@impulza/ui";
import { AuditPanel } from "../../../../components/audit/audit-panel";
import { useActiveOrgStore } from "../../../../lib/active-org-store";

/** Configuración › Auditoría: quién hizo qué y cuándo, con filtros y exportación (F9.6d, ADR-028 §3). */
export default function ConfiguracionAuditoriaPage(): React.JSX.Element {
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!organizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver su actividad." />;
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Auditoría</h1>
        <p className="text-sm text-muted-foreground">Un registro de lo que pasa en tu organización. Solo lo ven el propietario y los administradores.</p>
      </header>
      <AuditPanel organizationId={organizationId} view="organization" />
    </div>
  );
}
