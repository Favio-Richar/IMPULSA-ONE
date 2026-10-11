"use client";

import { EmptyState } from "@impulza/ui";
import { ReportView } from "../../../components/reports/report-view";
import { useActiveOrgStore } from "../../../lib/active-org-store";

/** Reportes: el informe del negocio con comparación de periodos, descargable e imprimible (F9.8a, ADR-028 §6). */
export default function ReportesPage(): React.JSX.Element {
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!organizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver su informe." />;
  }
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1 print:hidden">
        <h1 className="text-xl font-semibold text-foreground">Reportes</h1>
        <p className="text-sm text-muted-foreground">Cómo le fue a tu página: visitas, contactos, reservas y ventas, comparadas con el periodo anterior y con el año pasado.</p>
      </header>
      <ReportView organizationId={organizationId} />
    </div>
  );
}
