import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { siteCacheTag } from "../../../lib/api";
import { env } from "../../../lib/env";

// Webhook llamado por `RevalidateWebService` (apps/api) justo después de publicar o restaurar una
// página (F2.6/F2.7) — es la única vía para invalidar la caché de este proceso desde afuera:
// `revalidateTag()` solo se puede llamar desde dentro del propio proceso Next.js.
//
// Protegido por un secreto compartido, no por sesión (quien llama es un servicio, no una persona).
// `timingSafeEqual` en vez de `===`: comparar el secreto con igualdad simple filtra, por el tiempo
// de respuesta, cuántos caracteres iniciales coinciden — de poco sirve un secreto de 32+ bytes si
// se puede reconstruir byte a byte cronometrando intentos.
const SECRET_HEADER = "x-revalidate-secret";

const bodySchema = z.object({ siteSlug: z.string().min(1) });

function isValidSecret(candidate: string | null): boolean {
  if (!candidate) {
    return false;
  }

  const expected = Buffer.from(env.REVALIDATE_SECRET);
  const received = Buffer.from(candidate);

  // Debe compararse igual de largo siempre: timingSafeEqual lanza si los buffers difieren en
  // tamaño, y ese lanzamiento en sí sería una fuga de tiempo más (rápida = tamaño distinto).
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function POST(request: Request): Promise<Response> {
  if (!isValidSecret(request.headers.get(SECRET_HEADER))) {
    // Genérico a propósito: ni confirma ni niega si el secreto estaba "casi bien".
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Cuerpo inválido: se espera { siteSlug: string }." }, { status: 400 });
  }

  // Sin ventana de contenido obsoleto: quien llama (una publicación real) necesita que la próxima
  // visita ya vea el cambio, no "eventualmente" (F2.7, "invalidación solo al publicar").
  revalidateTag(siteCacheTag(parsed.data.siteSlug), { expire: 0 });

  return Response.json({ revalidated: true, siteSlug: parsed.data.siteSlug });
}
