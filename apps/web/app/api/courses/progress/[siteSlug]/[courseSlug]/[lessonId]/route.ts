import { memberCookieName } from "@impulza/validation";
import { cookies } from "next/headers";
import { env } from "../../../../../../../lib/env";
import { fetchUpstream } from "../../../../../../../lib/upstream";

type Context = { params: Promise<{ siteSlug: string; courseSlug: string; lessonId: string }> };

async function forward(method: "PUT" | "DELETE", request: Request, { params }: Context): Promise<Response> {
  // Anti-CSRF: un formulario o enlace de otro sitio no puede poner esta cabecera propia.
  if (request.headers.get("x-requested-with") !== "impulza-one") return Response.json({ message: "Petición no válida." }, { status: 403 });
  const { siteSlug, courseSlug, lessonId } = await params;
  const token = (await cookies()).get(memberCookieName(siteSlug))?.value;
  if (!token) return Response.json({ message: "Necesitas iniciar sesión como miembro." }, { status: 401 });
  const url = `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/courses/${encodeURIComponent(courseSlug)}/lessons/${encodeURIComponent(lessonId)}/progress`;
  const response = await fetchUpstream("course-progress", url, {
    method,
    headers: { "X-Requested-With": "impulza-one", "x-member-session": token },
    cache: "no-store",
  });
  if (!response) return Response.json({ message: "No pudimos conectarnos. Intenta de nuevo." }, { status: 502 });
  return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/** Marca la lección como completada (F10.3): la sesión de miembro sale de la cookie `HttpOnly`, nunca del navegador. */
export function PUT(request: Request, context: Context): Promise<Response> {
  return forward("PUT", request, context);
}

/** Desmarca la lección. */
export function DELETE(request: Request, context: Context): Promise<Response> {
  return forward("DELETE", request, context);
}
