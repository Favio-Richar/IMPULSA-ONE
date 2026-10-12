/**
 * «Mi sistema» (F10): lo que el negocio puede administrar en su sitio, calculado de lo que sus páginas realmente
 * contienen — así cada plantilla (fotografía, café, profesional…) muestra sus propias áreas sin que el sitio tenga
 * que declarar un «tipo». Lógica pura: sin red ni React.
 */

export type WorkspaceBlock = { type: string; visible: boolean };
export type WorkspacePage = { id: string; slug: string; isHome: boolean; status: "DRAFT" | "PUBLISHED"; blocks: WorkspaceBlock[] };

export type WorkspaceArea = {
  id: string;
  title: string;
  /** Qué se administra aquí, en una frase. */
  description: string;
  /** Cuántos bloques de esta área hay en el sitio. */
  count: number;
  /** `ok` = ya tiene contenido; `suggest` = el sitio todavía no lo usa. */
  state: "ok" | "suggest";
  href: string;
  cta: string;
};

type AreaDefinition = {
  id: string;
  title: string;
  description: string;
  types: readonly string[];
  /** Pantalla propia del área (reservas, catálogo…); sin ella se abre el editor de la página que la contiene. */
  screen?: (siteId: string) => string;
  cta: string;
  suggestion: string;
};

const AREAS: readonly AreaDefinition[] = [
  {
    id: "photos",
    title: "Fotos y álbumes",
    description: "Sube varias fotos a la vez, ordénalas y arma álbumes y portafolios con visor.",
    types: ["album", "gallery", "showcase", "works_wheel", "image"],
    cta: "Administrar fotos",
    suggestion: "Agrega un álbum o una galería para mostrar tu trabajo.",
  },
  {
    id: "services",
    title: "Servicios y precios",
    description: "Tus servicios, planes y precios, con su botón de contacto o reserva.",
    types: ["service", "pricing", "feature", "steps"],
    cta: "Editar servicios",
    suggestion: "Agrega tus servicios o una tabla de precios.",
  },
  {
    id: "videos",
    title: "Videos y música",
    description: "Videos incrustados y reproductores, con su portada y descripción.",
    types: ["video", "music"],
    cta: "Administrar videos",
    suggestion: "Suma un video o un reproductor para que te conozcan mejor.",
  },
  {
    id: "booking",
    title: "Reservas",
    description: "Horarios de atención, servicios con duración y seña, y la agenda de citas.",
    types: ["booking"],
    screen: (siteId) => `/sitios/${siteId}/reservas`,
    cta: "Configurar reservas",
    suggestion: "Activa reservas para que te agenden sin escribirte.",
  },
  {
    id: "shop",
    title: "Tienda y pedidos",
    description: "Productos con foto, precio y stock, cupones y los pedidos que llegan.",
    types: ["catalog"],
    screen: (siteId) => `/sitios/${siteId}/catalogo`,
    cta: "Administrar tienda",
    suggestion: "Publica tu catálogo para vender en línea.",
  },
  {
    id: "contact",
    title: "Contacto y mensajes",
    description: "Formulario, WhatsApp y botones de contacto; los mensajes llegan a tus contactos.",
    types: ["contact_form", "contact_actions", "whatsapp", "newsletter"],
    cta: "Editar contacto",
    suggestion: "Agrega un formulario o un botón de WhatsApp para recibir mensajes.",
  },
  {
    id: "events",
    title: "Eventos, mapa y fechas",
    description: "Próximos eventos, ubicación en el mapa y cuentas regresivas.",
    types: ["events", "map", "countdown"],
    cta: "Editar eventos",
    suggestion: "Indica dónde estás o cuándo es tu próximo evento.",
  },
  {
    id: "trust",
    title: "Opiniones y preguntas",
    description: "Testimonios, preguntas frecuentes y cifras que generan confianza.",
    types: ["testimonials", "faq", "stats"],
    cta: "Editar confianza",
    suggestion: "Suma opiniones de clientes y preguntas frecuentes.",
  },
];

function editorHref(siteId: string, page: WorkspacePage): string {
  return `/sitios/${siteId}/paginas/${page.id}/editor`;
}

/**
 * Áreas administrables del sitio, primero las que ya tienen contenido (en el orden del catálogo) y después las sugeridas.
 * `extras.courses`: cursos del sitio (no son bloques); `null`/`undefined` = no se sabe (p. ej. sin permiso), y el área no se muestra.
 */
export function buildWorkspaceAreas(siteId: string, pages: readonly WorkspacePage[], extras: { courses?: number | null } = {}): WorkspaceArea[] {
  const home = pages.find((page) => page.isHome) ?? pages[0];
  const areas = AREAS.map((area): WorkspaceArea => {
    let count = 0;
    let firstPage: WorkspacePage | undefined;
    for (const page of pages) {
      const here = page.blocks.filter((block) => block.visible && area.types.includes(block.type)).length;
      if (here > 0) {
        count += here;
        firstPage ??= page;
      }
    }
    const target = firstPage ?? home;
    const href = area.screen ? area.screen(siteId) : target ? editorHref(siteId, target) : `/sitios/${siteId}`;
    return { id: area.id, title: area.title, description: count > 0 ? area.description : area.suggestion, count, state: count > 0 ? "ok" : "suggest", href, cta: area.cta };
  });
  if (extras.courses !== undefined && extras.courses !== null) {
    const count = extras.courses;
    areas.push({
      id: "courses",
      title: "Cursos",
      description: count > 0 ? "Módulos y lecciones de texto o video, con avance por alumno y acceso por membresía." : "Crea un curso con módulos y lecciones para enseñar lo que sabes.",
      count,
      state: count > 0 ? "ok" : "suggest",
      href: `/sitios/${siteId}/cursos`,
      cta: "Administrar cursos",
    });
  }
  return [...areas.filter((area) => area.state === "ok"), ...areas.filter((area) => area.state === "suggest")];
}

/** Resumen de publicación para el encabezado de «Mi sistema». */
export function summarizePublication(pages: readonly WorkspacePage[]): { total: number; published: number; drafts: number } {
  const published = pages.filter((page) => page.status === "PUBLISHED").length;
  return { total: pages.length, published, drafts: pages.length - published };
}
