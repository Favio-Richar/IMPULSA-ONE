import {
  RICH_TEXT_ALLOWED_SCHEMES,
  RICH_TEXT_ALLOWED_TAGS,
  RICH_TEXT_LINK_ATTRIBUTES,
} from "@impulza/validation";
import sanitizeHtml from "sanitize-html";

// Segunda pasada de saneo, en el punto de mayor exposición del producto: una página pública, sin
// sesión, con el HTML de texto enriquecido de un tenant renderizado vía `dangerouslySetInnerHTML`.
//
// `apps/api` ya sanea al guardar (`modules/blocks/sanitize.ts`) — esta llamada no debería cambiar
// nunca el resultado en un sistema sano. Existe como defensa en profundidad: si algún día un bug
// deja pasar HTML sin sanear hasta la base (una migración manual, un camino de escritura nuevo que
// se olvide de llamar al sanitizador), esta segunda pasada sigue sin dejarlo ejecutar nada, en el
// único lugar del producto que un visitante anónimo puede alcanzar.
//
// Misma lista blanca que el servidor de escritura (`@impulza/validation`, para que no puedan
// divergir) — ver ese archivo para por qué es tan corta.
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
  allowedAttributes: {
    a: [...RICH_TEXT_LINK_ATTRIBUTES],
  },
  allowedSchemes: [...RICH_TEXT_ALLOWED_SCHEMES],
  allowedSchemesAppliedToAttributes: ["href"],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: "noopener noreferrer nofollow" },
    }),
  },
  disallowedTagsMode: "discard",
};

export function sanitizeRichText(value: string): string {
  return sanitizeHtml(value, SANITIZE_OPTIONS);
}
