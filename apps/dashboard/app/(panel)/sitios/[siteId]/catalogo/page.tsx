"use client";

import { buttonVariants, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProductCategories } from "../../../../../components/catalog/product-categories";
import { ProductsManager } from "../../../../../components/catalog/products-manager";
import { useActiveOrgStore } from "../../../../../lib/active-org-store";
import { ApiError } from "../../../../../lib/api-client";
import { useSite } from "../../../../../lib/hooks/use-sites";

// Catálogo del sitio (F5.5): productos con foto, precio, stock y enlace de pago, y sus categorías.

export default function CatalogoPage(): React.JSX.Element {
  const params = useParams<{ siteId: string }>();
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para administrar su catálogo." />;
  }
  return <Catalog organizationId={activeOrganizationId} siteId={params.siteId} />;
}

function Catalog({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const siteQuery = useSite(organizationId, siteId);

  if (siteQuery.isPending) {
    return <LoadingState label="Cargando catálogo…" />;
  }
  if (siteQuery.isError) {
    if (siteQuery.error instanceof ApiError && siteQuery.error.status === 404) {
      return <ErrorState title="Sitio no encontrado" description="No existe, o es de otra organización." />;
    }
    return <ErrorState onRetry={() => siteQuery.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/sitios/${siteId}`} className="text-sm text-muted-foreground hover:underline">
            ← {siteQuery.data.name}
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-foreground">Catálogo</h1>
          <p className="text-sm text-muted-foreground">
            Lo que vendes desde tu página. Para mostrarlo, agrega el bloque «Tienda» en el constructor: cada producto aparece como un botón.
          </p>
        </div>
        <Link href="/pedidos" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Ver pedidos
        </Link>
      </div>
      <ProductsManager organizationId={organizationId} siteId={siteId} />
      <ProductCategories organizationId={organizationId} siteId={siteId} />
    </div>
  );
}
