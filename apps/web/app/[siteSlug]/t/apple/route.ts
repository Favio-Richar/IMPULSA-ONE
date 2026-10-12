import { cardApiUrl } from "../../../../lib/card";
import { fetchUpstream } from "../../../../lib/upstream";

/** Pase de Apple Wallet de la tarjeta (F10.4): la API lo firma; acá solo se entrega. Sin credenciales, una página corta clara. */
export async function GET(_request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;
  const response = await fetchUpstream("digital-card-apple", cardApiUrl(siteSlug, "wallet/apple"), { headers: { "X-Requested-With": "impulza-one" }, cache: "no-store" });
  if (!response) return new Response("No pudimos conectarnos. Intenta de nuevo.", { status: 502 });
  if (response.status === 404) return new Response("Tarjeta no encontrada.", { status: 404 });
  if (!response.ok) return new Response("Apple Wallet no está disponible ahora. Puedes guardar el contacto con la vCard.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(await response.arrayBuffer(), {
    status: 200,
    headers: {
      "content-type": "application/vnd.apple.pkpass",
      "content-disposition": response.headers.get("content-disposition") ?? 'attachment; filename="tarjeta.pkpass"',
      "cache-control": "no-store",
    },
  });
}
