import { NextResponse, type NextRequest } from "next/server";
import { DomainCache, hostnameOf, internalPathFor, isPlatformHost } from "./lib/custom-domain";
import { env } from "./lib/env";

// Dominios propios (F4.7): una visita que llega por un host que no es el de la plataforma se sirve
// con el sitio que tiene ese dominio **verificado** (lo decide la API, `GET /public/domains/:host`).
// Solo se reescribe la ruta — la URL que ve el visitante no cambia — y siempre dentro de ese sitio.

const cache = new DomainCache();
const LOOKUP_TIMEOUT_MS = 3000;

async function resolveSiteSlug(hostname: string): Promise<string | null | "error"> {
  const cached = cache.get(hostname);
  if (cached) {
    return cached.slug;
  }
  try {
    const response = await fetch(`${env.API_BASE_URL}/public/domains/${encodeURIComponent(hostname)}`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.status === 404) {
      cache.set(hostname, null);
      return null;
    }
    if (!response.ok) {
      return "error";
    }
    const body = (await response.json()) as { siteSlug?: unknown };
    if (typeof body.siteSlug !== "string") {
      return "error";
    }
    cache.set(hostname, body.siteSlug);
    return body.siteSlug;
  } catch {
    return "error";
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const hostname = hostnameOf(request.headers.get("host"));
  if (isPlatformHost(hostname, env.PUBLIC_WEB_BASE_URL)) {
    return NextResponse.next();
  }

  const siteSlug = await resolveSiteSlug(hostname);
  if (siteSlug === "error") {
    // Sin caché: el próximo intento vuelve a preguntar.
    return new NextResponse("El sitio no está disponible en este momento. Vuelve a intentarlo en unos minutos.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "30" },
    });
  }
  if (siteSlug === null) {
    return new NextResponse("Sitio no encontrado.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const url = request.nextUrl.clone();
  url.pathname = internalPathFor(siteSlug, request.nextUrl.pathname);
  return NextResponse.rewrite(url);
}

export const config = {
  // Ni los archivos del framework ni las rutas de API propias (analítica, formularios, invalidación):
  // esas se sirven igual en cualquier host.
  matcher: ["/((?!_next/static|_next/image|api/|favicon.ico).*)"],
};
