import { cardApiUrl } from "../../../../lib/card";
import { fetchUpstream } from "../../../../lib/upstream";

/** Descarga la vCard de la tarjeta (F10.4): la arma la API; acá solo se entrega como archivo. */
export async function GET(_request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;
  const response = await fetchUpstream("digital-card-vcard", cardApiUrl(siteSlug, "vcard"), { headers: { "X-Requested-With": "impulza-one" }, cache: "no-store" });
  if (!response) return new Response("No pudimos conectarnos. Intenta de nuevo.", { status: 502 });
  if (!response.ok) return new Response("Tarjeta no encontrada.", { status: response.status === 404 ? 404 : 502 });
  return new Response(await response.text(), {
    status: 200,
    headers: {
      "content-type": "text/vcard; charset=utf-8",
      "content-disposition": response.headers.get("content-disposition") ?? 'attachment; filename="contacto.vcf"',
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}
