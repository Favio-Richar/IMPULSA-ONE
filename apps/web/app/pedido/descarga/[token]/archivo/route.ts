import { env } from "../../../../../lib/env";
import { fetchUpstream } from "../../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../../lib/visitor-headers";

// Botón "Descargar" de la página de descarga (F5.11b, ADR-015). Es un POST de formulario a
// propósito: un GET lo dispararían la precarga del navegador o la vista previa de un enlace en un
// chat, y cada llamada cuenta una descarga. La API verifica el pago y devuelve una URL firmada de 5
// minutos del bucket privado; acá solo se redirige a ella (303: el navegador la pide con GET).

const ERROR_CODES = new Set(["awaiting_payment", "revoked", "limit_reached", "unavailable"]);

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const back = (error: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `/pedido/descarga/${encodeURIComponent(token)}?error=${error}`, "Cache-Control": "no-store" },
    });

  const upstream = await fetchUpstream("download-url", `${env.API_BASE_URL}/public/downloads/${encodeURIComponent(token)}/url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
    body: "{}",
  });
  if (!upstream) return back("upstream");
  const payload = (await upstream.json().catch(() => null)) as { url?: unknown; code?: unknown } | null;
  if (upstream.ok && typeof payload?.url === "string") {
    return new Response(null, {
      status: 303,
      headers: { Location: payload.url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  }
  if (upstream.status === 404) return back("invalid");
  if (upstream.status === 429) return back("rate_limited");
  return back(typeof payload?.code === "string" && ERROR_CODES.has(payload.code) ? payload.code : "upstream");
}
