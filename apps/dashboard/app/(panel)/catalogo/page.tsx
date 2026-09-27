"use client";

import type { SiteResponse } from "@impulza/contracts";
import { buttonVariants, EmptyState, ErrorState, LoadingState, Select } from "@impulza/ui";
import Link from "next/link";
import { useState } from "react";
import { ProductCategories } from "../../../components/catalog/product-categories";
import { ProductsManager } from "../../../components/catalog/products-manager";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { useSites } from "../../../lib/hooks/use-sites";

// Catálogo desde el menú (F5.5): el mismo administrador de productos que Sitios → Catálogo, con un
// selector de sitio cuando la organización tiene más de uno.

export default function CatalogoMenuPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para administrar su catálogo." />;
  }
  return <CatalogForOrganization organizationId={activeOrganizationId} />;
}

function CatalogForOrganization({ organizationId }: { organizationId: string }): React.JSX.Element {
  const sitesQuery = useSites(organizationId);
  if (sitesQuery.isPending) return <LoadingState label="Cargando catálogo…" />;
  if (sitesQuery.isError) return <ErrorState onRetry={() => sitesQuery.refetch()} />;
  const active = sitesQuery.data.filter((site) => site.status !== "ARCHIVED");
  if (active.length === 0) {
    return (
      <EmptyState
        title="Todavía no tienes sitios"
        description="Crea tu sitio para empezar a vender desde tu página."
        action={
          <Link href="/sitios" className={buttonVariants({ size: "sm" })}>
            Ir a Sitios
          </Link>
        }
      />
    );
  }
  return <Catalog organizationId={organizationId} sites={active} />;
}

function Catalog({ organizationId, sites }: { organizationId: string; sites: readonly SiteResponse[] }): React.JSX.Element {
  const [siteId, setSiteId] = useState(sites[0]!.id);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Catálogo</h1>
          <p className="text-sm text-muted-foreground">
            Lo que vendes desde tu página. Para mostrarlo, agrega el bloque «Tienda» en el constructor: cada producto aparece como un botón.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-end gap-3 sm:w-auto">
          {sites.length > 1 ? (
            <div className="w-full sm:w-64">
              <Select label="Sitio" options={sites.map((site) => ({ value: site.id, label: site.name }))} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
            </div>
          ) : null}
          <Link href="/pedidos" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Ver pedidos
          </Link>
        </div>
      </div>
      <ProductsManager key={`p-${siteId}`} organizationId={organizationId} siteId={siteId} />
      <ProductCategories key={`c-${siteId}`} organizationId={organizationId} siteId={siteId} />
    </div>
  );
}
