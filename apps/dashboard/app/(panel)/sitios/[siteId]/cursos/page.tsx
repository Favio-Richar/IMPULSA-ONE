"use client";

import { EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CoursesPanel } from "../../../../../components/courses/courses-panel";
import { useActiveOrgStore } from "../../../../../lib/active-org-store";
import { ApiError } from "../../../../../lib/api-client";
import { useSite } from "../../../../../lib/hooks/use-sites";

// Cursos del sitio (F10.3, ADR-029).

export default function CursosPage(): React.JSX.Element {
  const params = useParams<{ siteId: string }>();
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!organizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para administrar sus cursos." />;
  }
  return <Courses organizationId={organizationId} siteId={params.siteId} />;
}

function Courses({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const site = useSite(organizationId, siteId);
  if (site.isPending) return <LoadingState label="Cargando el sitio…" />;
  if (site.isError) {
    const notFound = site.error instanceof ApiError && site.error.status === 404;
    return notFound ? <ErrorState title="Sitio no encontrado" description="No existe, o es de otra organización." /> : <ErrorState onRetry={() => site.refetch()} />;
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href={`/sitios/${siteId}`} className="w-fit text-sm text-muted-foreground hover:text-foreground">
          ← {site.data.name}
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Cursos</h1>
        <p className="text-sm text-muted-foreground">Enseña lo que sabes: módulos y lecciones de texto o video, con avance por alumno y acceso por membresía.</p>
      </header>
      <CoursesPanel organizationId={organizationId} siteId={siteId} />
    </div>
  );
}
