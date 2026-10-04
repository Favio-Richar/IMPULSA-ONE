"use client";

import { EmptyState } from "@impulza/ui";
import Link from "next/link";
import { RolesPanel } from "../../../../components/team/roles-panel";
import { useActiveOrgStore } from "../../../../lib/active-org-store";

/** Configuración › Roles: roles personalizados con permisos del catálogo cerrado (F9.6a, ADR-028 §3). */
export default function ConfiguracionRolesPage(): React.JSX.Element {
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!organizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver sus roles." />;
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Roles</h1>
        <p className="text-sm text-muted-foreground">
          Define qué puede hacer cada persona de tu equipo. Para asignar un rol, ve a{" "}
          <Link href="/configuracion" className="text-primary underline underline-offset-2">
            Equipo
          </Link>
          .
        </p>
      </header>
      <RolesPanel organizationId={organizationId} />
    </div>
  );
}
