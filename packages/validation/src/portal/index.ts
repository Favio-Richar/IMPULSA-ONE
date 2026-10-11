import { z } from "zod";
import { segmentsAfterOrganization } from "../agency/index.js";

/**
 * Portal del cliente (F9.7e, ADR-028 §5). `CLIENT_VIEWER` es el rol de quien, del lado del negocio, solo revisa y aprueba lo que su
 * agencia o su equipo prepara: ver, aprobar o rechazar publicaciones y comentar. Se limita con una **lista de rutas permitidas** (todo lo
 * demás se niega) en la puerta de entrada de las rutas de organización, no con una lista de prohibidas: una ruta nueva queda cerrada para
 * este rol hasta que alguien la abra a propósito.
 */

export const CLIENT_VIEWER_ROLE = "CLIENT_VIEWER";

export const PUBLISH_COMMENT_BODY_MAX = 1000;

export const createPublishCommentSchema = z.object({
  body: z.string().trim().min(1, "Escribe un comentario.").max(PUBLISH_COMMENT_BODY_MAX, `Máximo ${PUBLISH_COMMENT_BODY_MAX} caracteres.`),
});
export type CreatePublishCommentDto = z.infer<typeof createPublishCommentSchema>;

export type ClientViewerVerdict = { allowed: true } | { allowed: false; code: "CLIENT_VIEWER_LIMIT"; message: string };

const DENIED: ClientViewerVerdict = {
  allowed: false,
  code: "CLIENT_VIEWER_LIMIT",
  message: "Tu acceso es para revisar y aprobar publicaciones: esta sección no está disponible para ti.",
};

/** Segmentos de una página que un visor puede LEER (para ver qué se le pide aprobar), nunca modificar. */
const PAGE_READ_SEGMENTS = new Set(["publish-status", "versions", "blocks", "health"]);

/**
 * ¿Puede un `CLIENT_VIEWER` hacer esta petición? Permitido:
 * - leer la organización misma y su marca de panel (`panel-brand`), y la opción de aprobación (`publish-settings`, solo lectura);
 * - leer los sitios y las páginas (lista, detalle, estado de publicación, versiones y bloques) para ver lo que se le pide aprobar;
 * - leer el informe del cliente (`reports/summary`, solo cifras agregadas);
 * - ver solicitudes de publicación, aprobarlas o rechazarlas, y leer y escribir sus comentarios.
 * Todo lo demás (equipo, facturación, contactos, analítica, configuración, medios, cobros…) se niega. Los permisos del rol
 * (`publish.approve`, `publish.comment`) siguen aplicándose en cada ruta: esta es una barrera previa, no la única.
 */
export function clientViewerVerdict(input: { method: string; path: string }): ClientViewerVerdict {
  const method = input.method.toUpperCase();
  const read = method === "GET" || method === "HEAD";
  const segments = segmentsAfterOrganization(input.path);
  const [first, second, third, fourth, fifth, sixth] = segments;

  // La organización misma.
  if (first === undefined) return read ? { allowed: true } : DENIED;

  if (first === "panel-brand" || first === "publish-settings") {
    return read && second === undefined ? { allowed: true } : DENIED;
  }

  // Informe del cliente (F9.8): solo lectura de cifras agregadas.
  if (first === "reports") {
    return read && (second === "summary" || second === "summary.csv") && third === undefined ? { allowed: true } : DENIED;
  }

  if (first === "sites") {
    if (!read) return DENIED;
    // sites · sites/:id
    if (third === undefined) return second === undefined || segments.length === 2 ? { allowed: true } : DENIED;
    // sites/:id/pages · sites/:id/pages/:pageId · sites/:id/pages/:pageId/<lectura>
    if (third === "pages") {
      if (fourth === undefined) return { allowed: true };
      if (fifth === undefined) return { allowed: true };
      if (PAGE_READ_SEGMENTS.has(fifth)) return sixth === undefined || fifth === "versions" || fifth === "blocks" ? { allowed: true } : DENIED;
    }
    return DENIED;
  }

  if (first === "publish-requests") {
    // publish-requests · publish-requests/:id
    if (second === undefined || third === undefined) return read ? { allowed: true } : DENIED;
    if (fourth !== undefined) return DENIED;
    if (third === "comments") return read || method === "POST" ? { allowed: true } : DENIED;
    if ((third === "approve" || third === "reject") && method === "POST") return { allowed: true };
    return DENIED;
  }

  return DENIED;
}
