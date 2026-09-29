"use client";

import { EmptyState, ErrorState, LoadingState, buttonVariants } from "@impulza/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AbTestCard } from "../../../../../components/ab-tests/ab-test-card";
import { useActiveOrgStore } from "../../../../../lib/active-org-store";
import { ApiError } from "../../../../../lib/api-client";
import { useAbTests } from "../../../../../lib/hooks/use-ab-tests";
import { useSite } from "../../../../../lib/hooks/use-sites";

// Pruebas A/B del sitio (F6.5): en curso primero, con resultados, veredicto y "Aplicar".

export default function PruebasPage(): React.JSX.Element {
  const params = useParams<{ siteId: string }>();
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver sus pruebas." />;
  }
  return <AbTests organizationId={activeOrganizationId} siteId={params.siteId} />;
}

function AbTests({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const siteQuery = useSite(organizationId, siteId);
  const testsQuery = useAbTests(organizationId, siteId);

  if (siteQuery.isPending || testsQuery.isPending) {
    return <LoadingState label="Cargando pruebas…" />;
  }
  if (siteQuery.isError || testsQuery.isError) {
    const error = siteQuery.error ?? testsQuery.error;
    if (error instanceof ApiError && error.status === 404) {
      return <ErrorState title="Sitio no encontrado" description="No existe, o es de otra organización." />;
    }
    return (
      <ErrorState
        onRetry={() => {
          void siteQuery.refetch();
          void testsQuery.refetch();
        }}
      />
    );
  }

  const running = testsQuery.data.filter((test) => test.status === "RUNNING");
  const ended = testsQuery.data.filter((test) => test.status === "ENDED");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/sitios/${siteId}`} className="text-sm text-muted-foreground hover:underline">
          ← {siteQuery.data.name}
        </Link>
        <h1 className="text-lg font-semibold text-foreground">Pruebas A/B</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Compara dos versiones de un botón o del encabezado con tus visitantes reales. La mitad ve cada una, siempre la misma, sin cookies de
          terceros ni datos personales. Solo se declara una ganadora con datos suficientes, y aplicarla es decisión tuya.
        </p>
      </div>

      {testsQuery.data.length === 0 ? (
        <EmptyState
          title="Todavía no hay pruebas"
          description="Abre el constructor, elige un botón (enlace, WhatsApp, reservas o tienda) o tu perfil, y usa «Probar una variante»."
          action={
            <Link href={`/sitios/${siteId}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Ir a las páginas del sitio
            </Link>
          }
        />
      ) : (
        <>
          <section aria-labelledby="pruebas-en-curso" className="flex flex-col gap-3">
            <h2 id="pruebas-en-curso" className="text-base font-semibold text-foreground">
              En curso ({running.length})
            </h2>
            {running.length === 0 ? <p className="text-sm text-muted-foreground">No hay pruebas en curso.</p> : null}
            {running.map((test) => (
              <AbTestCard key={test.id} organizationId={organizationId} siteId={siteId} test={test} />
            ))}
          </section>
          {ended.length > 0 ? (
            <section aria-labelledby="pruebas-terminadas" className="flex flex-col gap-3">
              <h2 id="pruebas-terminadas" className="text-base font-semibold text-foreground">
                Terminadas ({ended.length})
              </h2>
              {ended.map((test) => (
                <AbTestCard key={test.id} organizationId={organizationId} siteId={siteId} test={test} />
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
