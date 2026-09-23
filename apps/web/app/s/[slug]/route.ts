import { redirect } from "next/navigation";
import { env } from "../../../lib/env";

/**
 * Enlace corto (F3.5): el visitante nunca ve `apps/api` — esta ruta la consulta server-to-server,
 * y solo entonces redirige de verdad. `apps/api` ya contó el clic y registró el evento antes de
 * responder acá (mismo principio que F3.2/F3.4: el navegador nunca llama a la API directo).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;

  const response = await fetch(`${env.API_BASE_URL}/public/short-links/${encodeURIComponent(slug)}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    redirect("/");
  }

  const data = (await response.json()) as { destinationUrl: string };
  redirect(data.destinationUrl);
}
