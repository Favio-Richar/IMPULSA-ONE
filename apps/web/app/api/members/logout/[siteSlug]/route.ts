import { memberCookieName } from "@impulza/validation";
import { cookies } from "next/headers";
import { env } from "../../../../../lib/env";
import { fetchUpstream } from "../../../../../lib/upstream";

/** Cierra la sesión de miembro (F10.1): se revoca del lado del servidor y se borra la cookie de este sitio. */
export async function POST(_request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;
  const store = await cookies();
  const token = store.get(memberCookieName(siteSlug))?.value;

  if (token) {
    await fetchUpstream("members-logout", `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/members/logout`, {
      method: "POST",
      headers: { "X-Requested-With": "impulza-one", "x-member-session": token },
    });
  }
  store.delete(memberCookieName(siteSlug));
  return new Response(null, { status: 204 });
}
