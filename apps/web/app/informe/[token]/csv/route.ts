import { getSharedReportCsv } from "../../../../lib/shared-report";

// CSV del informe compartido (F9.8b): se sirve desde este mismo origen (la página no llama a la API desde el navegador). Mismos 404 y 410
// que el enlace; sin caché y sin referer, porque el enlace es una credencial.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const result = await getSharedReportCsv(token);
  if (result.status !== 200) {
    return new Response(result.status === 410 ? "Este enlace ya no está disponible." : result.status === 404 ? "No encontrado." : "No disponible por ahora.", {
      status: result.status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return new Response(result.body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="informe.csv"',
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
