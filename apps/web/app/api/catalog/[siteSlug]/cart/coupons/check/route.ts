import { forwardCatalogPost } from "../../../../../../../lib/catalog-proxy";

// Probar un código de descuento con el carrito (F7.8c, ADR-023). La API calcula; aquí solo se reenvía.
export async function POST(request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;
  return forwardCatalogPost(request, siteSlug, "cart/coupons/check", "No pudimos revisar el código ahora. Intenta de nuevo en un momento.");
}
