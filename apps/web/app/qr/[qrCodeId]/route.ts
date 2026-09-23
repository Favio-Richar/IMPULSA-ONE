import { redirect } from "next/navigation";
import { env } from "../../../lib/env";

/** Código QR (F3.5): mismo patrón que `app/s/[slug]/route.ts` — `apps/api` ya contó el escaneo y
 *  registró `qr_visit` antes de responder acá. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ qrCodeId: string }> },
): Promise<Response> {
  const { qrCodeId } = await params;

  const response = await fetch(`${env.API_BASE_URL}/public/qr/${encodeURIComponent(qrCodeId)}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    redirect("/");
  }

  const data = (await response.json()) as { destinationUrl: string };
  redirect(data.destinationUrl);
}
