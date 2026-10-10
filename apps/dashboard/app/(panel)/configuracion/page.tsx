"use client";

import { EmptyState } from "@impulza/ui";
import Link from "next/link";
import { InviteCard } from "../../../components/team/invite-card";
import { PublishSettingsCard } from "../../../components/publish/settings-card";
import { MembersCard } from "../../../components/team/members-card";
import { useActiveOrgStore } from "../../../lib/active-org-store";

/** Configuración › Equipo: quién trabaja en la organización, con qué rol, e invitar a más gente. */
export default function ConfiguracionPage(): React.JSX.Element {
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!organizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para administrar sus miembros." />;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Equipo</h1>
        <p className="text-sm text-muted-foreground">
          Invita a tu equipo y elige qué puede hacer cada persona. ¿Necesitas un rol a medida? Créalo en{" "}
          <Link href="/configuracion/roles" className="text-primary underline underline-offset-2">
            Roles
          </Link>
          .
        </p>
      </header>
      <MembersCard organizationId={organizationId} />
      <InviteCard organizationId={organizationId} />
      <PublishSettingsCard organizationId={organizationId} />
    </div>
  );
}
