import { memberSessionResponse } from "@impulza/contracts";
import { memberCookieName } from "@impulza/validation";
import { cookies } from "next/headers";
import { env } from "../../../../lib/env";
import { fetchUpstream } from "../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../lib/visitor-headers";

/**
 * Canje del enlace de acceso de un miembro (F10.1). Es el único lugar donde la sesión del miembro toca el navegador: se
 * guarda en una cookie `HttpOnly` de este origen (nunca en el cuerpo de la página ni en `localStorage`) y una por sitio.
 * El token del enlace viaja por POST, nunca por la URL de la API.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ message: "Cuerpo inválido." }, { status: 400 });
  }

  const upstream = await fetchUpstream("members-verify", `${env.API_BASE_URL}/public/members/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
    body: JSON.stringify(body),
  });
  if (!upstream) {
    return Response.json({ message: "No pudimos validar tu enlace ahora. Intenta de nuevo en un momento." }, { status: 502 });
  }
  if (!upstream.ok) {
    const status = upstream.status === 429 ? 429 : upstream.status === 400 ? 400 : 401;
    return Response.json({ message: status === 429 ? "Demasiados intentos. Espera unos minutos." : "Este enlace no es válido o ya venció. Pide uno nuevo." }, { status });
  }

  const session = memberSessionResponse.safeParse(await upstream.json().catch(() => null));
  if (!session.success) {
    return Response.json({ message: "Respuesta inesperada del servidor." }, { status: 502 });
  }

  (await cookies()).set(memberCookieName(session.data.siteSlug), session.data.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(session.data.expiresAt),
  });
  // El navegador solo necesita saber a qué sitio volver; el token no sale de la cookie.
  return Response.json({ siteSlug: session.data.siteSlug });
}
