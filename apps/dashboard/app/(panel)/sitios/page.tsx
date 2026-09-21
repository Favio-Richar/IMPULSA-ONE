"use client";

import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@impulza/ui";
import Link from "next/link";
import { ConfirmButton } from "../../../components/confirm-button";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { useArchiveSite, useSites } from "../../../lib/hooks/use-sites";

const SITE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  PUBLISHED: "Publicado",
  ARCHIVED: "Archivado",
};

export default function SitiosPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return (
      <EmptyState
        title="Selecciona una organización"
        description="Elige una organización arriba para ver sus sitios."
      />
    );
  }

  return <SitesList organizationId={activeOrganizationId} />;
}

function SitesList({ organizationId }: { organizationId: string }): React.JSX.Element {
  const sitesQuery = useSites(organizationId);

  if (sitesQuery.isPending) {
    return <LoadingState label="Cargando tus sitios…" />;
  }

  if (sitesQuery.isError) {
    return <ErrorState onRetry={() => sitesQuery.refetch()} />;
  }

  const sites = sitesQuery.data.filter((site) => site.status !== "ARCHIVED");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Sitios</h1>
        <Button asChild>
          <Link href="/sitios/nuevo">Crear sitio</Link>
        </Button>
      </div>

      {sites.length === 0 ? (
        <EmptyState
          title="Todavía no tienes ningún sitio"
          description="Crea el primero para empezar a construir tu página pública."
          action={
            <Button asChild size="sm">
              <Link href="/sitios/nuevo">Crear sitio</Link>
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sites.map((site) => (
              <TableRow key={site.id}>
                <TableCell>
                  <Link href={`/sitios/${site.id}`} className="font-medium text-primary hover:underline">
                    {site.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{site.slug}</TableCell>
                <TableCell className="text-muted-foreground">
                  {SITE_STATUS_LABEL[site.status] ?? site.status}
                </TableCell>
                <TableCell>
                  <SiteRowActions organizationId={organizationId} siteId={site.id} siteName={site.name} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function SiteRowActions({
  organizationId,
  siteId,
  siteName,
}: {
  organizationId: string;
  siteId: string;
  siteName: string;
}): React.JSX.Element {
  const archiveMutation = useArchiveSite(organizationId, siteId);

  return (
    <div className="flex items-center justify-end gap-2">
      {archiveMutation.isError ? <span className="text-xs text-danger">No se pudo archivar.</span> : null}
      <ConfirmButton
        variant="ghost"
        size="sm"
        confirmLabel={`¿Archivar "${siteName}"?`}
        loading={archiveMutation.isPending}
        onConfirm={() => archiveMutation.mutate()}
      >
        Archivar
      </ConfirmButton>
    </div>
  );
}
