import { cardApiUrl } from "../../../../../lib/card";
import { fetchUpstream } from "../../../../../lib/upstream";

/** Pide la dirección «Guardar en Google Wallet» de la tarjeta (F10.4). Exige la cabecera anti-CSRF propia. */
export async function POST(request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  if (request.headers.get("x-requested-with") !== "impulza-one") return Response.json({ message: "Petición no válida." }, { status: 403 });
  const { siteSlug } = await params;
  const response = await fetchUpstream("digital-card-google", cardApiUrl(siteSlug, "wallet/google"), {
    method: "POST",
    headers: { "X-Requested-With": "impulza-one" },
    cache: "no-store",
  });
  if (!response) return Response.json({ message: "No pudimos conectarnos. Intenta de nuevo." }, { status: 502 });
  return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
