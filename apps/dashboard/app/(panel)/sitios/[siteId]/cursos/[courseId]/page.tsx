"use client";

import { EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CourseEditor } from "../../../../../../components/courses/course-editor";
import { useActiveOrgStore } from "../../../../../../lib/active-org-store";
import { ApiError } from "../../../../../../lib/api-client";
import { useSite } from "../../../../../../lib/hooks/use-sites";

// Editor de un curso: datos, acceso, módulos y lecciones (F10.3).

export default function CursoPage(): React.JSX.Element {
  const params = useParams<{ siteId: string; courseId: string }>();
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!organizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para editar el curso." />;
  }
  return <Course organizationId={organizationId} siteId={params.siteId} courseId={params.courseId} />;
}

function Course({ organizationId, siteId, courseId }: { organizationId: string; siteId: string; courseId: string }): React.JSX.Element {
  const site = useSite(organizationId, siteId);
  if (site.isPending) return <LoadingState label="Cargando el sitio…" />;
  if (site.isError) {
    const notFound = site.error instanceof ApiError && site.error.status === 404;
    return notFound ? <ErrorState title="Sitio no encontrado" description="No existe, o es de otra organización." /> : <ErrorState onRetry={() => site.refetch()} />;
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href={`/sitios/${siteId}/cursos`} className="w-fit text-sm text-muted-foreground hover:text-foreground">
          ← Cursos de {site.data.name}
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Editar curso</h1>
      </header>
      <CourseEditor organizationId={organizationId} siteId={siteId} courseId={courseId} />
    </div>
  );
}
