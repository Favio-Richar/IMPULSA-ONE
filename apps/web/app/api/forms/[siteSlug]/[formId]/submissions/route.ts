import { env } from "../../../../../../lib/env";

/**
 * Único punto por el que un envío de formulario del visitante llega a `apps/api` (F3.2): el
 * navegador solo conoce esta ruta, propia de `apps/web`, nunca `API_BASE_URL` — mismo principio
 * documentado en `lib/env.ts` para el resto del render público ("el navegador del visitante nunca
 * llama a la API directamente"). Reenvía el cuerpo tal cual; la validación real (contra los campos
 * del formulario, antispam, límite de tasa) vive en `apps/api` — acá no se duplica esa lógica.
 *
 * Deuda declarada: el límite de tasa de `apps/api` cuenta por IP de quien llama — que acá es
 * siempre este proceso de `apps/web`, no la IP del visitante, porque este servidor no reenvía
 * `X-Forwarded-For` ni `apps/api` lo consulta (no hay `trust proxy` configurado, ST §15). El límite
 * sigue activo pero deja de distinguir visitantes entre sí; corresponde a la misma tarea pendiente
 * de "rate limiting parcial" ya declarada en `docs/BACKLOG_FASE_2.md`, no a algo nuevo de F3.2.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ siteSlug: string; formId: string }> },
): Promise<Response> {
  const { siteSlug, formId } = await params;

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return Response.json({ message: "Cuerpo inválido." }, { status: 400 });
  }

  const upstream = await fetch(
    `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/forms/${encodeURIComponent(formId)}/submissions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one" },
      body: JSON.stringify(body),
    },
  );

  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status });
}
