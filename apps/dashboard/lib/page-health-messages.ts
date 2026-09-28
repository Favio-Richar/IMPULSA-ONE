import type { HealthFindingCode } from "@impulza/validation";

/**
 * Qué puede hacer el usuario para corregir un hallazgo (F6.1):
 * - `block`: abrir el bloque afectado en el constructor.
 * - `publish`: publicar la página.
 * - `seo`: ir a la configuración SEO de la página.
 * - `theme`: ir a la apariencia del sitio.
 * - `add_block`: agregar un bloque desde la biblioteca (no hay uno concreto que abrir).
 */
export type HealthFix = "block" | "publish" | "seo" | "theme" | "add_block";

export interface HealthMessage {
  title: string;
  /** Por qué importa y cómo arreglarlo, en una frase. */
  detail: string;
  fix: HealthFix | null;
}

// Un mensaje por código estable del servidor. `Record` sobre el tipo del catálogo: si el servidor
// agrega un código nuevo, este archivo no compila hasta que tenga su texto.
export const HEALTH_MESSAGES: Record<HealthFindingCode, HealthMessage> = {
  page_not_published: {
    title: "La página no está publicada",
    detail: "Tus visitantes todavía no la ven. Publícala cuando esté lista.",
    fix: "publish",
  },
  unpublished_changes: {
    title: "Tienes cambios sin publicar",
    detail: "Lo que ves en el constructor aún no está en tu página pública.",
    fix: "publish",
  },
  page_empty: {
    title: "La página está vacía",
    detail: "No hay ningún bloque visible. Agrega tu perfil y al menos un botón de contacto.",
    fix: "add_block",
  },
  no_heading: {
    title: "Falta el encabezado",
    detail: "Agrega un bloque de perfil o portada para que se sepa de quién es la página.",
    fix: "add_block",
  },
  no_action: {
    title: "No hay ninguna forma de contactarte",
    detail: "Agrega un botón de WhatsApp, un enlace, un formulario, reservas o tu tienda.",
    fix: "add_block",
  },
  no_primary_action: {
    title: "Elige tu acción principal",
    detail: "Marca el botón más importante: se destaca y queda fijo abajo en el teléfono.",
    fix: "block",
  },
  block_unrenderable: {
    title: "Un bloque no se puede mostrar",
    detail: "Su configuración quedó incompleta y la página lo omite. Ábrelo y revísalo.",
    fix: "block",
  },
  block_schedule_ended: {
    title: "Un bloque ya terminó su programación",
    detail: "Dejó de mostrarse por su fecha de fin. Quítalo o cambia las fechas.",
    fix: "block",
  },
  form_not_configured: {
    title: "Un formulario no está configurado",
    detail: "El bloque no tiene un formulario elegido, o el formulario se borró.",
    fix: "block",
  },
  booking_without_services: {
    title: "Reservas sin servicios disponibles",
    detail: "El botón de reservas no tiene ningún servicio activo que ofrecer.",
    fix: "block",
  },
  catalog_without_products: {
    title: "Tienda sin productos disponibles",
    detail: "El bloque de catálogo no tiene ningún producto activo que mostrar.",
    fix: "block",
  },
  seo_title_generic: {
    title: "El título en Google será genérico",
    detail: "Escribe un título SEO o agrega tu nombre en el perfil.",
    fix: "seo",
  },
  seo_description_missing: {
    title: "Falta la descripción para buscadores",
    detail: "Escribe una descripción SEO o una frase en tu perfil.",
    fix: "seo",
  },
  seo_home_noindex: {
    title: "Tu página de inicio está oculta para Google",
    detail: "La configuración SEO pide no indexarla. Cámbialo si quieres que te encuentren.",
    fix: "seo",
  },
  seo_canonical_missing: {
    title: "La URL canónica apunta a una página que no existe",
    detail: "Esa página se borró o no está publicada. Elige otra o déjala en blanco.",
    fix: "seo",
  },
  image_alt_missing: {
    title: "Imágenes sin descripción",
    detail: "Descríbelas o márcalas como decorativas para quienes usan lector de pantalla.",
    fix: "block",
  },
  theme_contrast: {
    title: "El tema no se lee bien",
    detail: "Algunos colores del tema no alcanzan el contraste mínimo. Elige otro tema.",
    fix: "theme",
  },
  insecure_link: {
    title: "Enlace sin conexión segura",
    detail: "Empieza con http://. Si el sitio lo permite, cámbialo a https://.",
    fix: "block",
  },
  duplicate_link: {
    title: "Enlace repetido",
    detail: "Otro botón ya lleva a la misma dirección. Quita uno para no confundir.",
    fix: "block",
  },
  heavy_media: {
    title: "Demasiados videos o imágenes",
    detail: "La página puede tardar en cargar con datos móviles. Deja solo lo esencial.",
    fix: null,
  },
  too_many_blocks: {
    title: "Demasiados bloques",
    detail: "Una página corta convierte mejor. Considera ocultar lo menos importante.",
    fix: null,
  },
};

const FALLBACK: HealthMessage = { title: "Revisa esta página", detail: "Encontramos algo que se puede mejorar.", fix: null };

/** Un código que este panel todavía no conoce (servidor más nuevo) se muestra de forma genérica. */
export function healthMessage(code: string): HealthMessage {
  return (HEALTH_MESSAGES as Record<string, HealthMessage>)[code] ?? FALLBACK;
}

export function scoreLabel(score: number): { label: string; tone: "good" | "fair" | "poor" } {
  if (score >= 90) {
    return { label: "Buena", tone: "good" };
  }
  if (score >= 60) {
    return { label: "Mejorable", tone: "fair" };
  }
  return { label: "Necesita atención", tone: "poor" };
}
