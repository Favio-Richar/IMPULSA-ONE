import { forwardCatalogPost } from "../../../../../../lib/catalog-proxy";

// Pedido desde el carrito del sitio público (F7.8c, ADR-023). La API recalcula todo; aquí solo se reenvía.
export async function POST(request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;
  return forwardCatalogPost(request, siteSlug, "cart/orders", "No pudimos enviar tu pedido ahora. Intenta de nuevo en un momento.");
}
