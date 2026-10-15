import type { TemplateBlockSeed, TemplateDefinition } from "./index.js";
import { PORTAL_CONTENT } from "./portal-content.js";
import { PORTAL_TEMPLATES_CREADORES } from "./portal-extra-creadores.js";
import { PORTAL_TEMPLATES_OFICIOS } from "./portal-extra-oficios.js";
import { PORTAL_TEMPLATES_PROFESIONALES } from "./portal-extra-profesionales.js";

/**
 * Catálogo de plantillas de la plataforma (PL3). Lo siembra `packages/database/prisma/seed.ts`,
 * que valida cada entrada con `templateSchema` antes de escribirla: una plantilla inválida detiene
 * el seed en vez de llegar a la base (y `catalog.test.ts` lo verifica antes, en CI).
 *
 * Todo el contenido es **ficticio y está marcado como ejemplo** (ADR-008, "Restricciones
 * asociadas"): los nombres empiezan con "Tu …", la bio dice que es un texto de ejemplo, los enlaces
 * van a `example.com` (dominio reservado para ejemplos, RFC 2606), las redes apuntan a la portada de
 * cada red (nunca a una cuenta) y el teléfono es un número de relleno. Ningún nombre, texto, logo ni
 * imagen de Linktree, Beacons, Stan ni de cuentas reales. Sin imágenes: el perfil muestra el
 * monograma del nombre (PP8) hasta que el cliente sube su foto.
 *
 * Criterios de composición (boceto + ADR-008, decisión 1 de `BACKLOG_PLANTILLAS.md`): perfil arriba,
 * **una sola acción principal** (WhatsApp en los rubros de contacto directo, el diferenciador del
 * producto), enlaces secundarios del mismo alto, y debajo tarjetas de servicio/precio, reseñas y
 * preguntas cuando el rubro las usa. Sin formulario de contacto: sin conectar se vería vacío en la
 * página publicada, y conectarlo es un paso del onboarding (checklist, PM §8.2 punto 11).
 */

const EXAMPLE_PHONE = "+56900000000";

/**
 * Destino de un botón de la plantilla. Todo botón lleva a una **página real del portal** (`page:<slug>`, ver
 * `companionPages`): ninguno apunta a un sitio de ejemplo que no existe. Un destino ya escrito como `page:…` o
 * `https://…` se respeta; cualquier otro nombre se toma como el slug de una página compañera, y los servicios con un
 * nombre que no sea una página compañera caen en la página de contacto.
 */
const PAGE_CONTACT = "page:contacto";
function internalTarget(path: string): string {
  if (path.startsWith("page:") || path.startsWith("https://")) return path;
  return path === "guia" || path === "carta" || path === "catalogo" || path === "lanzamiento" || path === "contacto" || path === "convenios" || path === "fechas" || path === "ubicacion" || path === "agenda" || path === "portafolio" || path === "cursos" || path === "horarios" || path === "album" || path === "perfil"
    ? `page:${path}`
    : PAGE_CONTACT;
}

function profile(name: string, headline: string, bio: string, layout?: "hero"): TemplateBlockSeed {
  return {
    type: "profile",
    configSchemaVersion: 1,
    // `hero` (PL7): portada de cuerpo entero; sin foto todavía, muestra las iniciales a lo alto.
    // PL8: las plantillas traen el botón para compartir la página.
    config: { name, headline, bio: `<p>${bio}</p>`, verified: false, shareButton: true, ...(layout ? { layout } : {}) },
  };
}

function whatsapp(label: string, prefilledMessage: string): TemplateBlockSeed {
  return {
    type: "whatsapp",
    configSchemaVersion: 1,
    isPrimary: true,
    config: { phone: EXAMPLE_PHONE, label, prefilledMessage },
  };
}

function link(label: string, path: string, options: { description?: string; primary?: boolean } = {}): TemplateBlockSeed {
  return {
    type: "link",
    configSchemaVersion: 1,
    ...(options.primary ? { isPrimary: true as const } : {}),
    config: {
      label,
      url: internalTarget(path),
      ...(options.description ? { description: options.description } : {}),
      style: options.primary ? "primary" : "secondary",
      // PL8: cada enlace de la plantilla se puede compartir.
      shareable: true,
    },
  };
}

function service(name: string, description: string, priceClp: number, ctaLabel: string, path: string): TemplateBlockSeed {
  return {
    type: "service",
    configSchemaVersion: 1,
    config: {
      name,
      description: `<p>${description}</p>`,
      priceAmount: priceClp,
      priceCurrency: "CLP",
      cta: { label: ctaLabel, url: internalTarget(path) },
    },
  };
}

/** Servicio sin botón propio: la página ya termina en la acción principal (WhatsApp), así que no hace falta otro destino. */
function serviceWithoutButton(name: string, description: string, priceClp: number): TemplateBlockSeed {
  return {
    type: "service",
    configSchemaVersion: 1,
    config: { name, description: `<p>${description}</p>`, priceAmount: priceClp, priceCurrency: "CLP" },
  };
}

function faq(items: [string, string][]): TemplateBlockSeed {
  return {
    type: "faq",
    configSchemaVersion: 1,
    config: {
      title: "Preguntas frecuentes",
      items: items.map(([question, answer]) => ({ question, answer: `<p>${answer}</p>` })),
    },
  };
}

function testimonials(items: [string, string][]): TemplateBlockSeed {
  return {
    type: "testimonials",
    configSchemaVersion: 1,
    config: {
      title: "Lo que dicen (reseñas de ejemplo)",
      items: items.map(([quote, author]) => ({ quote, author, rating: 5 })),
    },
  };
}

type SocialNetworkHome = "instagram" | "facebook" | "tiktok" | "youtube" | "linkedin" | "spotify";

const NETWORK_HOME: Record<SocialNetworkHome, string> = {
  instagram: "https://www.instagram.com/",
  facebook: "https://www.facebook.com/",
  tiktok: "https://www.tiktok.com/",
  youtube: "https://www.youtube.com/",
  linkedin: "https://www.linkedin.com/",
  spotify: "https://open.spotify.com/",
};

function social(networks: SocialNetworkHome[]): TemplateBlockSeed {
  return {
    type: "social",
    configSchemaVersion: 1,
    config: { links: networks.map((network) => ({ network, url: NETWORK_HOME[network] })), style: "buttons" },
  };
}

function booking(label = "Reservar hora"): TemplateBlockSeed {
  return {
    type: "booking",
    configSchemaVersion: 1,
    isPrimary: true,
    config: { label },
  };
}

function catalogBlock(label = "Ver catálogo"): TemplateBlockSeed {
  return {
    type: "catalog",
    configSchemaVersion: 1,
    config: { label },
  };
}

function pricing(
  title: string,
  plans: Array<{
    name: string;
    priceAmount: number;
    priceCurrency?: string;
    period: "once" | "month" | "year";
    description?: string;
    features: string[];
    badge?: string;
    highlighted?: boolean;
    cta?: { label: string; url: string };
  }>,
): TemplateBlockSeed {
  return {
    type: "pricing",
    configSchemaVersion: 1,
    config: {
      title,
      plans: plans.map((p) => ({
        priceCurrency: "CLP",
        highlighted: false,
        ...p,
        features: p.features ?? [],
      })),
    },
  };
}

function events(
  title: string,
  items: Array<{
    name: string;
    start: string;
    end?: string;
    venue?: string;
    address?: string;
    description?: string;
    ticketUrl?: string;
    ticketLabel?: string;
  }>,
  timeZone = "America/Santiago",
): TemplateBlockSeed {
  return {
    type: "events",
    configSchemaVersion: 1,
    config: {
      title,
      timeZone,
      items: items.map((item) => ({ soldOut: false, ...item })),
    },
  };
}

function music(
  musicItem: { provider: "spotify"; kind: "track" | "album" | "playlist" | "artist"; id: string },
  title?: string,
): TemplateBlockSeed {
  return {
    type: "music",
    configSchemaVersion: 1,
    config: {
      music: musicItem,
      ...(title ? { title } : {}),
    },
  };
}

function video(
  videoItem: { provider: "youtube" | "vimeo" | "tiktok"; videoId: string; vertical?: boolean },
  title?: string,
): TemplateBlockSeed {
  return {
    type: "video",
    configSchemaVersion: 1,
    config: {
      video: videoItem,
      ...(title ? { title } : {}),
    },
  };
}

function map(address: string, name?: string, note?: string): TemplateBlockSeed {
  return {
    type: "map",
    configSchemaVersion: 1,
    config: {
      address,
      ...(name ? { name } : {}),
      ...(note ? { note } : {}),
      showMap: true,
    },
  };
}

function gallery(
  images: Array<{ url: string; alt: string; decorative?: boolean }>,
  layout: "grid" | "carousel" = "grid",
): TemplateBlockSeed {
  return {
    type: "gallery",
    configSchemaVersion: 1,
    config: { images, layout },
  };
}

function newsletter(title: string, description: string, buttonLabel = "Suscribirme"): TemplateBlockSeed {
  return {
    type: "newsletter",
    configSchemaVersion: 1,
    config: {
      title,
      description,
      askName: true,
      buttonLabel,
      successMessage: "¡Gracias por suscribirte! Revisa tu correo para confirmar tu suscripción.",
    },
  };
}

/** Foto de ejemplo (Unsplash, licencia libre): el negocio la reemplaza por las suyas desde su biblioteca. */
const STOCK_URL = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80`;
const STOCK = (id: string, alt: string) => ({ url: STOCK_URL(id), alt });

function profileWithCover(name: string, headline: string, bio: string, cover: { url: string; alt: string }): TemplateBlockSeed {
  return {
    type: "profile",
    configSchemaVersion: 1,
    config: { name, headline, bio: `<p>${bio}</p>`, verified: false, shareButton: true, cover, layout: "hero" },
  };
}

function marquee(items: string[], speed: "slow" | "normal" | "fast" = "normal"): TemplateBlockSeed {
  return { type: "marquee", configSchemaVersion: 1, config: { items, speed } };
}

function worksWheel(label: string, items: Array<{ title: string; image: { url: string; alt: string }; path?: string }>): TemplateBlockSeed {
  return {
    type: "works_wheel",
    configSchemaVersion: 1,
    config: {
      label,
      actionLabel: "Ver",
      items: items.map((item) => ({ title: item.title, image: item.image, ...(item.path ? { link: internalTarget(item.path) } : {}) })),
    },
  };
}

function showcase(
  title: string,
  items: Array<{ title: string; subtitle: string; badge?: string; image: { url: string; alt: string }; path: string }>,
): TemplateBlockSeed {
  return {
    type: "showcase",
    configSchemaVersion: 1,
    config: {
      title,
      layout: "stack",
      actionLabel: "Ver",
      items: items.map((item) => ({
        title: item.title,
        subtitle: item.subtitle,
        ...(item.badge ? { badge: item.badge } : {}),
        image: item.image,
        link: internalTarget(item.path),
      })),
    },
  };
}

function textBlock(html: string): TemplateBlockSeed {
  return { type: "text", configSchemaVersion: 1, config: { html, alignment: "left" } };
}

function contactActions(): TemplateBlockSeed {
  return {
    type: "contact_actions",
    configSchemaVersion: 1,
    config: { email: "contacto@example.com", phone: EXAMPLE_PHONE, emailLabel: "Escríbeme por correo", phoneLabel: "Llámame" },
  };
}

/** Página de contacto estándar: texto de bienvenida, WhatsApp como acción principal, correo y teléfono, y preguntas. */
function contactPage(intro: string, waLabel: string, waMessage: string, extra: TemplateBlockSeed[] = []): TemplateBlockSeed[] {
  return [textBlock(`<h2>Contacto</h2><p>${intro}</p>`), whatsapp(waLabel, waMessage), contactActions(), ...extra];
}

const EXAMPLE_BIO = "Texto de ejemplo: reemplázalo por";

const BASE_TEMPLATES: readonly TemplateDefinition[] = [
  {
    code: "profesional-servicios",
    name: "Profesional de servicios",
    description: "Para asesores, consultores y profesionales independientes que captan clientes por WhatsApp.",
    industryTags: ["profesional", "emprendimiento"],
    objectiveTags: ["captar", "reservar"],
    themeCode: "ejecutivo-marino",
    family: "ejecutivo",
    background: null,
    previewImageUrl: null,
    sortOrder: 10,
    blocksSeed: [
      profile(
        "Tu Estudio Profesional",
        "Asesoría contable y tributaria para pymes",
        `${EXAMPLE_BIO} a quién ayudas, en qué te especializas y por qué confiar en ti.`,
      ),
      whatsapp("Agenda una asesoría", "Hola, quiero agendar una asesoría."),
      link("Descarga la guía de inicio de actividades", "guia"),
      service(
        "Asesoría inicial (ejemplo)",
        "Revisamos tu situación y te entregamos un plan de acción. Precio de ejemplo.",
        35000,
        "Reservar",
        "reservar",
      ),
      testimonials([
        ["Me ordenó la contabilidad en un mes. Reseña de ejemplo.", "Cliente de ejemplo"],
        ["Respuestas claras y a tiempo. Reseña de ejemplo.", "Otra clienta de ejemplo"],
      ]),
      faq([
        ["¿Atiendes en línea?", "Respuesta de ejemplo: sí, por videollamada o de forma presencial."],
        ["¿Cuánto demora una asesoría?", "Respuesta de ejemplo: alrededor de una hora."],
      ]),
      social(["linkedin", "instagram"]),
    ],
  },
  {
    code: "cafe-gastronomia",
    name: "Café y gastronomía",
    description: "Para cafés, restaurantes y cocinas: carta, pedidos y reservas desde un solo enlace.",
    industryTags: ["gastronomia", "servicios-locales"],
    objectiveTags: ["vender", "reservar", "captar"],
    themeCode: "editorial",
    family: "clasico",
    background: { kind: "gradient", gradient: "arena" },
    previewImageUrl: null,
    sortOrder: 20,
    blocksSeed: [
      profile(
        "Tu Café de Barrio",
        "Café de especialidad y pastelería de la casa",
        `${EXAMPLE_BIO} tu historia, tu horario y dónde encontrarte.`,
      ),
      whatsapp("Haz tu pedido por WhatsApp", "Hola, quiero hacer un pedido."),
      link("Ver la carta", "carta"),
      service(
        "Brunch del fin de semana (ejemplo)",
        "Café, jugo natural y plato del día. Precio de ejemplo.",
        12900,
        "Reservar",
        "brunch",
      ),
      testimonials([["El mejor café del barrio. Reseña de ejemplo.", "Cliente de ejemplo"]]),
      social(["instagram", "tiktok"]),
    ],
  },
  {
    code: "comercio-tienda",
    name: "Tienda y comercio",
    description: "Para tiendas y emprendimientos que venden por redes: catálogo, ofertas y ventas por WhatsApp.",
    industryTags: ["comercio", "emprendimiento"],
    objectiveTags: ["vender", "captar"],
    themeCode: "vibrante-coral",
    family: "vibrante",
    background: null,
    previewImageUrl: null,
    sortOrder: 30,
    blocksSeed: [
      profile(
        "Tu Tienda",
        "Accesorios hechos a mano, envíos a todo el país",
        `${EXAMPLE_BIO} qué vendes, cómo haces los envíos y tus medios de pago.`,
      ),
      whatsapp("Compra por WhatsApp", "Hola, quiero comprar un producto."),
      link("Ver el catálogo", "catalogo"),
      service("Producto destacado (ejemplo)", "Describe tu producto estrella. Precio de ejemplo.", 19990, "Lo quiero", "producto"),
      service("Pack regalo (ejemplo)", "Una combinación lista para regalar. Precio de ejemplo.", 29990, "Lo quiero", "pack"),
      faq([
        ["¿Hacen envíos?", "Respuesta de ejemplo: sí, a todo el país por courier."],
        ["¿Qué medios de pago aceptan?", "Respuesta de ejemplo: transferencia y tarjetas."],
      ]),
      social(["instagram", "facebook", "tiktok"]),
    ],
  },
  {
    code: "creador-personal",
    name: "Creador y marca personal",
    description: "Para creadores, artistas y músicos: tus enlaces, tu contenido y lo que vendes, sobre fondo oscuro.",
    industryTags: ["creador", "streaming", "tiktok-video-corto", "youtube", "contenido-suscripcion"],
    objectiveTags: ["compartir", "mostrar", "vender"],
    themeCode: "oscuro-noche",
    family: "oscuro",
    // `null`: el degradado del tema (`grafito`, PL2).
    background: null,
    previewImageUrl: null,
    sortOrder: 40,
    blocksSeed: [
      profile(
        "Tu Nombre",
        "Música, contenido y colaboraciones",
        `${EXAMPLE_BIO} quién eres y qué compartes con tu comunidad.`,
      ),
      link("Escucha mi nuevo lanzamiento", "lanzamiento", { primary: true }),
      link("Colaboraciones y prensa", "contacto", { description: "Escríbeme para marcas y medios" }),
      service("Clase online (ejemplo)", "Una sesión en vivo de una hora. Precio de ejemplo.", 15000, "Inscribirme", "clase"),
      social(["instagram", "tiktok", "youtube", "spotify"]),
    ],
  },
  {
    code: "salud-bienestar",
    name: "Salud y bienestar",
    description: "Para consultas, terapeutas y centros de bienestar: reserva de horas y preguntas frecuentes.",
    industryTags: ["salud", "belleza-bienestar"],
    objectiveTags: ["reservar", "captar"],
    themeCode: "oceano",
    family: "clasico",
    background: { kind: "gradient", gradient: "brisa" },
    previewImageUrl: null,
    sortOrder: 50,
    blocksSeed: [
      profile(
        "Tu Consulta",
        "Kinesiología y bienestar integral",
        `${EXAMPLE_BIO} tu especialidad, tus títulos y cómo atiendes.`,
      ),
      whatsapp("Reserva tu hora", "Hola, quiero reservar una hora."),
      link("Convenios y previsiones", "convenios"),
      service("Primera sesión (ejemplo)", "Evaluación y plan de tratamiento. Precio de ejemplo.", 25000, "Reservar", "sesion"),
      testimonials([["Me sentí escuchada desde la primera sesión. Reseña de ejemplo.", "Paciente de ejemplo"]]),
      faq([
        ["¿Necesito orden médica?", "Respuesta de ejemplo: no para la primera evaluación."],
        ["¿Atienden a domicilio?", "Respuesta de ejemplo: sí, dentro de la comuna."],
      ]),
      social(["instagram", "facebook"]),
    ],
  },
  {
    code: "eventos-turismo",
    name: "Eventos y turismo",
    description: "Para tours, experiencias y productoras de eventos: fechas, cupos y reservas.",
    industryTags: ["eventos", "turismo"],
    objectiveTags: ["reservar", "vender", "captar"],
    themeCode: "oscuro-indigo",
    family: "oscuro",
    // `null`: el degradado del tema (`medianoche`, PL2).
    background: null,
    previewImageUrl: null,
    sortOrder: 60,
    blocksSeed: [
      profile(
        "Tu Experiencia",
        "Tours y experiencias al aire libre",
        `${EXAMPLE_BIO} qué experiencias ofreces, dónde y para quién.`,
      ),
      whatsapp("Reserva tu cupo", "Hola, quiero reservar un cupo."),
      link("Próximas fechas", "fechas"),
      service("Tour de medio día (ejemplo)", "Traslado, guía y colación. Precio de ejemplo por persona.", 45000, "Reservar", "tour"),
      service("Experiencia privada (ejemplo)", "Para grupos de hasta 8 personas. Precio de ejemplo.", 180000, "Cotizar", "privado"),
      testimonials([["Una experiencia inolvidable. Reseña de ejemplo.", "Viajera de ejemplo"]]),
      faq([
        ["¿Qué pasa si llueve?", "Respuesta de ejemplo: reprogramamos sin costo."],
        ["¿Hay cupos para niños?", "Respuesta de ejemplo: sí, desde los 8 años."],
      ]),
      social(["instagram", "facebook", "youtube"]),
    ],
  },
  {
    // F10: portal futurista y elegante para fotógrafos, modelos y marcas de moda y belleza. Cinta de texto, rueda de
    // trabajos, colecciones (álbumes y segundos perfiles), servicios, reseñas y animaciones suaves al desplazarse.
    code: "fotografia-moda",
    name: "Fotógrafo, modelo y moda",
    description: "Portal editorial oscuro con rueda de trabajos, álbumes y animaciones elegantes. Para fotógrafos, modelos, maquillaje y marcas de moda y belleza.",
    industryTags: ["creador", "belleza-bienestar", "fotografia-video"],
    objectiveTags: ["mostrar", "captar", "reservar"],
    themeCode: "oscuro-atelier",
    family: "oscuro",
    background: { kind: "color", color: "#0b0a0a" },
    previewImageUrl: null,
    sortOrder: 65,
    blocksSeed: [
      profileWithCover(
        "Tu Nombre Artístico",
        "Fotografía de moda · Editorial · Retrato",
        `${EXAMPLE_BIO} tu estilo, tu trayectoria y con qué marcas o personas has trabajado.`,
        STOCK("photo-1445205170230-053b83016050", "Foto de ejemplo: perchero de una boutique"),
      ),
      marquee(["Fotografía", "Moda", "Editorial", "Retrato", "Belleza"]),
      whatsapp("Reserva tu sesión", "Hola, quiero reservar una sesión de fotos."),
      worksWheel("Portafolio 2026", [
        { title: "Editorial Otoño", image: STOCK("photo-1558769132-cb1aea458c5e", "Foto de ejemplo: prendas de otoño en un perchero"), path: "album" },
        { title: "Retrato", image: STOCK("photo-1531746020798-e6953c6e8e04", "Foto de ejemplo: retrato sobre fondo rosado"), path: "album" },
        { title: "Campaña urbana", image: STOCK("photo-1523381210434-271e8be1f52b", "Foto de ejemplo: camisetas verdes en perchas"), path: "album" },
        { title: "Belleza", image: STOCK("photo-1596462502278-27bfdc403348", "Foto de ejemplo: productos de maquillaje sobre fondo beige"), path: "album" },
        { title: "Estudio", image: STOCK("photo-1490481651871-ab68de25d43d", "Foto de ejemplo: vestidos blancos en un perchero"), path: "album" },
        { title: "Backstage", image: STOCK("photo-1558171813-4c088753af8f", "Foto de ejemplo: camisa sobre una silla en un estudio"), path: "album" },
      ]),
      showcase("Álbumes y perfiles", [
        {
          title: "Álbum completo",
          subtitle: "Todas las series en alta resolución",
          badge: "120 fotos",
          image: STOCK("photo-1445205170230-053b83016050", "Foto de ejemplo: perchero de una boutique"),
          path: "page:album",
        },
        {
          title: "Mi perfil de modelo",
          subtitle: "Medidas, experiencia y comp card",
          badge: "Book",
          image: STOCK("photo-1531746020798-e6953c6e8e04", "Foto de ejemplo: retrato para book de modelo"),
          path: "page:perfil",
        },
        {
          title: "Mi sitio web",
          subtitle: "Proyectos, prensa y contacto",
          image: STOCK("photo-1490481651871-ab68de25d43d", "Foto de ejemplo: vestidos blancos en un perchero"),
          path: "https://example.com/mi-sitio-web",
        },
      ]),
      service("Sesión de retrato (ejemplo)", "60 minutos, 15 fotos editadas. Precio de ejemplo.", 90000, "Reservar", "page:perfil"),
      service("Book de modelo (ejemplo)", "Tres looks y entrega en 7 días. Precio de ejemplo.", 180000, "Reservar", "page:perfil"),
      service("Campaña o cobertura de evento (ejemplo)", "Cotización según proyecto. Precio de ejemplo.", 350000, "Cotizar", "page:perfil"),
      testimonials([
        ["Entendió la marca desde la primera reunión. Reseña de ejemplo.", "Directora creativa de ejemplo"],
        ["Las fotos superaron lo que imaginaba. Reseña de ejemplo.", "Modelo de ejemplo"],
      ]),
      faq([
        ["¿En cuánto tiempo entregas las fotos?", "Respuesta de ejemplo: entre 5 y 10 días hábiles, según el proyecto."],
        ["¿Qué derechos de uso incluyen?", "Respuesta de ejemplo: uso personal y en redes; el uso comercial se cotiza aparte."],
        ["¿Viajas para sesiones?", "Respuesta de ejemplo: sí, dentro del país y al extranjero con viáticos."],
      ]),
      newsletter("Lookbook mensual", "Recibe mis nuevas series y fechas disponibles. Un correo al mes, sin spam."),
      map("Av. Providencia 1234, Providencia, Santiago", "Estudio (ejemplo)", "Sesiones solo con reserva previa."),
      social(["instagram", "tiktok", "youtube"]),
    ],
  },
  {
    code: "belleza-barberia",
    name: "Barbería y belleza",
    description: "Para barberías, peluquerías y estética: servicios con precio y reservas por WhatsApp.",
    industryTags: ["belleza-bienestar", "servicios-locales", "barberia-estetica"],
    objectiveTags: ["reservar", "captar"],
    themeCode: "ejecutivo-grafito",
    family: "ejecutivo",
    background: null,
    previewImageUrl: null,
    sortOrder: 70,
    blocksSeed: [
      profile(
        "Tu Barbería",
        "Cortes clásicos y perfilado de barba",
        `${EXAMPLE_BIO} tu estilo, tu equipo y tu horario.`,
      ),
      whatsapp("Reserva tu hora", "Hola, quiero reservar una hora."),
      link("Cómo llegar", "ubicacion"),
      service("Corte clásico (ejemplo)", "Lavado, corte y peinado. Precio de ejemplo.", 12000, "Reservar", "corte"),
      service("Corte y barba (ejemplo)", "El servicio completo. Precio de ejemplo.", 18000, "Reservar", "corte-barba"),
      testimonials([["Siempre salgo conforme. Reseña de ejemplo.", "Cliente de ejemplo"]]),
      social(["instagram", "tiktok"]),
    ],
  },
  {
    // PL7: la variante de la referencia de Favio — foto de cuerpo entero como cabecera y todos los
    // botones del mismo tono neutro (línea Minimal).
    code: "portada-minimal",
    name: "Portada de cuerpo entero",
    description: "Tu foto a lo alto y botones del mismo tono: elegante y minimalista. Para marcas personales, artistas y coaches.",
    industryTags: ["creador", "profesional", "tiktok-video-corto", "contenido-suscripcion"],
    objectiveTags: ["compartir", "mostrar", "captar"],
    themeCode: "minimal-perla",
    family: "minimal",
    background: null,
    previewImageUrl: null,
    sortOrder: 80,
    blocksSeed: [
      profile(
        "Tu Nombre",
        "Marca personal y asesorías",
        `${EXAMPLE_BIO} quién eres, qué haces y cómo trabajar contigo.`,
        "hero",
      ),
      link("Agenda una sesión", "agenda", { primary: true }),
      link("Mi portafolio", "portafolio"),
      service("Sesión de asesoría (ejemplo)", "Una hora por videollamada. Precio de ejemplo.", 30000, "Reservar", "page:agenda"),
      testimonials([["Muy clara y cercana. Reseña de ejemplo.", "Clienta de ejemplo"]]),
      social(["instagram", "tiktok", "linkedin"]),
    ],
  },
  {
    code: "academia-talleres",
    name: "Academia y talleres",
    description: "Para centros de formación, academias y docentes: cursos, agenda de talleres, boletín y contacto.",
    industryTags: ["educacion", "profesional", "docencia"],
    objectiveTags: ["captar", "compartir"],
    themeCode: "editorial",
    family: "clasico",
    background: null,
    previewImageUrl: null,
    sortOrder: 90,
    blocksSeed: [
      profile(
        "Tu Academia de Formación",
        "Cursos prácticos, talleres y formación continua",
        `${EXAMPLE_BIO} tu metodología de enseñanza, docentes y temáticas de aprendizaje.`,
      ),
      whatsapp("Consulta sobre talleres", "Hola, me interesa inscribirme en un taller."),
      link("Explora el programa de cursos", "cursos"),
      service(
        "Taller intensivo (ejemplo)",
        "Sesión práctica de 4 horas con certificado y material incluido. Precio de ejemplo.",
        45000,
        "Inscribirme",
        "taller-intensivo",
      ),
      events("Próximos talleres y charlas", [
        {
          name: "Taller de iniciación práctica (ejemplo)",
          start: "2026-11-20T18:30",
          end: "2026-11-20T21:30",
          venue: "Campus online y presencial",
          address: "Av. Providencia 1234, Santiago",
          description: "Aprende las bases fundamentales con ejercicios prácticos guiados.",
          ticketUrl: PAGE_CONTACT,
          ticketLabel: "Asegurar cupo",
        },
      ]),
      newsletter(
        "Boletín de novedades y recursos",
        "Suscríbete para recibir fechas de nuevos talleres, guías gratuitas y descuentos exclusivos.",
        "Recibir recursos",
      ),
      testimonials([
        ["Excelente taller, contenido directo y muy aplicable. Reseña de ejemplo.", "Estudiante de ejemplo"],
        ["Las explicaciones fueron muy claras y dinámicas. Reseña de ejemplo.", "Otro estudiante de ejemplo"],
      ]),
      faq([
        ["¿Se entrega certificado de participación?", "Respuesta de ejemplo: sí, al completar todas las actividades del taller."],
        ["¿Las clases quedan grabadas?", "Respuesta de ejemplo: sí, tienes acceso a la grabación por 6 meses."],
      ]),
      social(["instagram", "youtube", "linkedin"]),
    ],
  },
  {
    code: "fitness-entrenamiento",
    name: "Fitness y entrenamiento",
    description: "Para entrenadores personales, gimnasios y boxes: reserva de clases, planes mensuales y testimonios.",
    industryTags: ["salud", "belleza-bienestar", "docencia", "fitness-coaching"],
    objectiveTags: ["reservar", "vender"],
    themeCode: "vibrante-coral",
    family: "vibrante",
    background: null,
    previewImageUrl: null,
    sortOrder: 100,
    blocksSeed: [
      profile(
        "Tu Espacio de Entrenamiento",
        "Entrenamiento personalizado, funcional y acondicionamiento físico",
        `${EXAMPLE_BIO} tu enfoque deportivo, certificaciones y objetivos de entrenamiento.`,
        "hero",
      ),
      booking("Reserva tu clase de prueba"),
      link("Conoce nuestras instalaciones y horarios", "horarios"),
      service(
        "Evaluación física inicial (ejemplo)",
        "Medición de composición corporal, postura y test de capacidad aeróbica. Precio de ejemplo.",
        20000,
        "Agendar evaluación",
        "evaluacion",
      ),
      pricing("Planes de entrenamiento", [
        {
          name: "Plan Mensual Ilimitado (ejemplo)",
          priceAmount: 39990,
          priceCurrency: "CLP",
          period: "month",
          description: "Acceso total a sala de entrenamiento y todas las clases guiadas.",
          features: ["Acceso ilimitado", "Plan de entrenamiento mensual", "Uso de camarines y duchas"],
          badge: "Recomendado",
          highlighted: true,
          cta: { label: "Elegir plan", url: PAGE_CONTACT },
        },
        {
          name: "Pase 8 Clases (ejemplo)",
          priceAmount: 28000,
          priceCurrency: "CLP",
          period: "once",
          description: "Pack de 8 sesiones para usar dentro de 45 días corridos.",
          features: ["8 clases guiadas", "Flexibilidad horaria"],
          highlighted: false,
          cta: { label: "Comprar pase", url: PAGE_CONTACT },
        },
      ]),
      gallery(
        [
          { url: STOCK_URL("photo-1544367567-0f2fcb009e0b"), alt: "Foto de ejemplo: clase de bienestar al atardecer" },
          { url: STOCK_URL("photo-1503951914875-452162b0f3f1"), alt: "Foto de ejemplo: servicio en un local" },
        ],
        "grid",
      ),
      testimonials([
        ["Logré mis metas de fuerza en solo 3 meses con el plan. Reseña de ejemplo.", "Alumno de ejemplo"],
      ]),
      social(["instagram", "tiktok", "youtube"]),
    ],
  },
  {
    code: "musico-banda",
    name: "Músico y banda",
    description: "Para músicos, bandas y proyectos sonoros: música en streaming, conciertos con enlace a la venta de entradas y videoclips.",
    industryTags: ["creador", "streaming", "youtube", "musica-podcast"],
    objectiveTags: ["mostrar", "compartir"],
    themeCode: "oscuro-indigo",
    family: "oscuro",
    background: null,
    previewImageUrl: null,
    sortOrder: 110,
    blocksSeed: [
      profile(
        "Tu Proyecto Musical",
        "Música original, presentaciones en vivo y lanzamientos",
        `${EXAMPLE_BIO} tu estilo sonoro, trayectoria de la banda y próximos proyectos.`,
        "hero",
      ),
      link("Escucha nuestro nuevo álbum", "album", {
        primary: true,
        description: "Disponible en Spotify, Apple Music y todas las plataformas",
      }),
      music(
        { provider: "spotify", kind: "track", id: "4cOdK2wGLETKBW3PvgPWqT" },
        "Sencillo promocional (ejemplo)",
      ),
      events("Próximas tocatas y presentaciones", [
        {
          name: "Lanzamiento oficial en vivo (ejemplo)",
          start: "2026-12-05T21:00",
          end: "2026-12-05T23:30",
          venue: "Sala de Conciertos de ejemplo",
          address: "Av. Bellavista 567, Recoleta, Santiago",
          description: "Show completo con banda invitada y venta de merchandising oficial.",
          ticketUrl: PAGE_CONTACT,
          ticketLabel: "Comprar entrada",
        },
      ]),
      video(
        { provider: "youtube", videoId: "dQw4w9WgXcQ" },
        "Videoclip oficial en YouTube (ejemplo)",
      ),
      gallery(
        [
          { url: STOCK_URL("photo-1470229722913-7c0e2dbbafd3"), alt: "Foto de ejemplo: concierto con luces" },
          { url: STOCK_URL("photo-1492684223066-81342ee5ff30"), alt: "Foto de ejemplo: público en un evento" },
        ],
        "carousel",
      ),
      social(["spotify", "youtube", "instagram", "tiktok"]),
    ],
  },
  {
    code: "restaurante-menu",
    name: "Restaurante con menú",
    description: "Para restaurantes y bistrós: reserva de mesas, carta digital con precios, ubicación en mapa y galería.",
    industryTags: ["gastronomia", "servicios-locales"],
    objectiveTags: ["reservar", "vender", "captar"],
    themeCode: "ejecutivo-marino",
    family: "ejecutivo",
    background: null,
    previewImageUrl: null,
    sortOrder: 120,
    blocksSeed: [
      profile(
        "Tu Restaurante de Autor",
        "Cocina de temporada, pescados frescos y coctelería de autor",
        `${EXAMPLE_BIO} tu propuesta culinaria, horarios de cocina y reservas de mesa.`,
      ),
      whatsapp("Reserva tu mesa por WhatsApp", "Hola, quiero reservar una mesa para cenar."),
      catalogBlock("Ver carta y menú completo"),
      service(
        "Menú Degustación 5 Tiempos (ejemplo)",
        "Maridaje de vinos incluido, previa reserva con 24 horas de anticipación. Precio de ejemplo.",
        48000,
        "Reservar menú",
        "menu-degustacion",
      ),
      map("Av. Italia 1450, Barrio Italia, Providencia, Santiago", "Ubicación del local", "Estacionamiento disponible en calles aledañas."),
      gallery(
        [
          { url: STOCK_URL("photo-1504674900247-0877df9cc836"), alt: "Foto de ejemplo: plato de autor" },
          { url: STOCK_URL("photo-1554118811-1e0d58224f24"), alt: "Foto de ejemplo: interior de un local" },
        ],
        "grid",
      ),
      testimonials([
        ["Platos innovadores y excelente atención de principio a fin. Reseña de ejemplo.", "Comensal de ejemplo"],
      ]),
      faq([
        ["¿Tienen opciones vegetarianas o sin gluten?", "Respuesta de ejemplo: sí, disponemos de opciones adaptadas en cada sección de la carta."],
        ["¿Se puede reservar para eventos privados?", "Respuesta de ejemplo: sí, contamos con salón reservado para grupos de hasta 20 personas."],
      ]),
      social(["instagram", "facebook", "tiktok"]),
    ],
  },
];

type CompanionPages = NonNullable<TemplateDefinition["companionPages"]>;

/**
 * Páginas que cada plantilla crea además de la de inicio (F10): a donde llevan sus botones y tarjetas. Con a lo sumo
 * dos, un sitio nuevo queda en tres páginas: lo que admite el plan gratis. Todo el contenido es de ejemplo y editable.
 */
const COMPANION_PAGES: Record<string, CompanionPages> = {
  "profesional-servicios": [
    {
      slug: "guia",
      blocksSeed: [
        textBlock("<h2>Guía de inicio de actividades</h2><p>Todo lo que necesitas saber para empezar a operar de forma ordenada y sin sorpresas con el SII. Contenido de ejemplo: reemplázalo por tu guía.</p><ul><li>Qué trámites hacer y en qué orden</li><li>Qué documentos preparar</li><li>Errores frecuentes que conviene evitar</li></ul>"),
        newsletter("Recibe la guía en tu correo", "Déjanos tu correo y te la enviamos junto con consejos prácticos una vez al mes.", "Quiero la guía"),
        faq([
          ["¿La guía tiene costo?", "Respuesta de ejemplo: no, es gratuita."],
          ["¿Sirve si ya tengo la empresa?", "Respuesta de ejemplo: sí, incluye una lista para revisar tu situación actual."],
        ]),
        whatsapp("Resuelve tus dudas", "Hola, tengo dudas sobre la guía de inicio de actividades."),
      ],
    },
    { slug: "contacto", blocksSeed: contactPage("Cuéntanos tu caso y te respondemos el mismo día hábil. Texto de ejemplo.", "Agenda una asesoría", "Hola, quiero agendar una asesoría.", [faq([["¿Atiendes en línea?", "Respuesta de ejemplo: sí, por videollamada o de forma presencial."]])]) },
  ],
  "cafe-gastronomia": [
    {
      slug: "carta",
      blocksSeed: [
        textBlock("<h2>Nuestra carta</h2><p>Café de especialidad, pastelería de la casa y platos del día. Precios y productos de ejemplo.</p>"),
        service("Café de especialidad (ejemplo)", "Espresso, latte o filtrado, con granos de origen único.", 3200, "Pedir", "contacto"),
        service("Pastel del día (ejemplo)", "Elaboración propia, cambia cada día.", 3900, "Pedir", "contacto"),
        service("Brunch del fin de semana (ejemplo)", "Café, jugo natural y plato del día.", 12900, "Reservar", "contacto"),
        map("Av. Providencia 1234, Providencia, Santiago", "Nuestro local (ejemplo)", "Atendemos de martes a domingo."),
      ],
    },
    { slug: "contacto", blocksSeed: contactPage("Pedidos, reservas de mesa y eventos privados. Texto de ejemplo.", "Haz tu pedido por WhatsApp", "Hola, quiero hacer un pedido.") },
  ],
  "comercio-tienda": [
    {
      slug: "catalogo",
      blocksSeed: [
        textBlock("<h2>Catálogo</h2><p>Todo lo que tenemos disponible, con precios y envíos a todo el país. Productos de ejemplo.</p>"),
        catalogBlock("Ver el catálogo completo"),
        service("Producto destacado (ejemplo)", "Describe tu producto estrella. Precio de ejemplo.", 19990, "Lo quiero", "contacto"),
        service("Pack regalo (ejemplo)", "Una combinación lista para regalar. Precio de ejemplo.", 29990, "Lo quiero", "contacto"),
        faq([["¿Cuánto demora el envío?", "Respuesta de ejemplo: entre 2 y 5 días hábiles según tu ciudad."]]),
      ],
    },
    { slug: "contacto", blocksSeed: contactPage("Consultas de productos, pedidos y envíos. Texto de ejemplo.", "Compra por WhatsApp", "Hola, quiero comprar un producto.") },
  ],
  "creador-personal": [
    {
      slug: "lanzamiento",
      blocksSeed: [
        textBlock("<h2>Mi nuevo lanzamiento</h2><p>Escúchalo, compártelo y cuéntame qué te pareció. Contenido de ejemplo: reemplázalo por el tuyo.</p>"),
        music({ provider: "spotify", kind: "track", id: "4cOdK2wGLETKBW3PvgPWqT" }, "Sencillo (ejemplo)"),
        newsletter("Entérate primero", "Te aviso de cada lanzamiento antes que nadie.", "Avísame"),
        social(["instagram", "tiktok", "youtube", "spotify"]),
      ],
    },
    { slug: "contacto", blocksSeed: contactPage("Colaboraciones, marcas y prensa: escríbeme con tu propuesta. Texto de ejemplo.", "Escríbeme por WhatsApp", "Hola, tengo una propuesta de colaboración.") },
  ],
  "salud-bienestar": [
    {
      slug: "convenios",
      blocksSeed: [
        textBlock("<h2>Convenios y previsiones</h2><p>Trabajamos con las principales aseguradoras para que puedas atenderte con tu cobertura. Información de ejemplo: reemplázala por la real.</p><ul><li>Isapres y seguros complementarios</li><li>Convenios con empresas</li><li>Reembolso con boleta o bono</li></ul>"),
        faq([
          ["¿Atienden con bono?", "Respuesta de ejemplo: sí, con bono electrónico o reembolso."],
          ["¿Cómo sé si mi seguro cubre la sesión?", "Respuesta de ejemplo: escríbenos y lo verificamos contigo."],
        ]),
        whatsapp("Consulta tu cobertura", "Hola, quiero saber si mi previsión tiene convenio."),
      ],
    },
    { slug: "contacto", blocksSeed: contactPage("Reserva tu hora o cuéntanos qué necesitas. Texto de ejemplo.", "Reserva tu hora", "Hola, quiero reservar una hora.") },
  ],
  "eventos-turismo": [
    {
      slug: "fechas",
      blocksSeed: [
        textBlock("<h2>Próximas fechas</h2><p>Cupos limitados por salida. Reserva con anticipación. Fechas de ejemplo.</p>"),
        events("Salidas confirmadas", [
          { name: "Tour de medio día (ejemplo)", start: "2027-01-16T09:00", end: "2027-01-16T14:00", venue: "Punto de encuentro (ejemplo)", ticketUrl: PAGE_CONTACT, ticketLabel: "Reservar cupo" },
          { name: "Experiencia privada (ejemplo)", start: "2027-01-23T10:00", end: "2027-01-23T16:00", venue: "A convenir", ticketUrl: PAGE_CONTACT, ticketLabel: "Cotizar" },
        ]),
        whatsapp("Reserva tu cupo", "Hola, quiero reservar un cupo."),
      ],
    },
    { slug: "contacto", blocksSeed: contactPage("Grupos, empresas y experiencias a medida. Texto de ejemplo.", "Reserva tu cupo", "Hola, quiero reservar un cupo.") },
  ],
  "fotografia-moda": [
    {
      slug: "album",
      blocksSeed: [
        textBlock("<h2>Álbum completo</h2><p>Una selección de mis series más recientes: editorial, retrato, campaña y backstage. Fotos de ejemplo: reemplázalas por las tuyas.</p>"),
        gallery(
          [
            { url: STOCK_URL("photo-1445205170230-053b83016050"), alt: "Foto de ejemplo: perchero de una boutique" },
            { url: STOCK_URL("photo-1558769132-cb1aea458c5e"), alt: "Foto de ejemplo: prendas de otoño en un perchero" },
            { url: STOCK_URL("photo-1523381210434-271e8be1f52b"), alt: "Foto de ejemplo: camisetas verdes en perchas" },
            { url: STOCK_URL("photo-1596462502278-27bfdc403348"), alt: "Foto de ejemplo: productos de maquillaje sobre fondo beige" },
            { url: STOCK_URL("photo-1490481651871-ab68de25d43d"), alt: "Foto de ejemplo: vestidos blancos en un perchero" },
            { url: STOCK_URL("photo-1558171813-4c088753af8f"), alt: "Foto de ejemplo: camisa sobre una silla en un estudio" },
          ],
          "grid",
        ),
        link("Ver mi perfil y servicios", "perfil", { primary: true }),
      ],
    },
    {
      slug: "perfil",
      blocksSeed: [
        textBlock("<h2>Perfil y servicios</h2><p>Quién soy, cómo trabajo y qué puedes contratarme. Texto de ejemplo: reemplázalo por tu historia.</p><ul><li>Experiencia: editorial, campañas y retrato</li><li>Idiomas: español e inglés</li><li>Disponibilidad: Chile y viajes</li></ul>"),
        serviceWithoutButton("Sesión de retrato (ejemplo)", "60 minutos, 15 fotos editadas. Precio de ejemplo.", 90000),
        serviceWithoutButton("Book de modelo (ejemplo)", "Tres looks y entrega en 7 días. Precio de ejemplo.", 180000),
        serviceWithoutButton("Campaña o cobertura de evento (ejemplo)", "Cotización según proyecto. Precio de ejemplo.", 350000),
        whatsapp("Reserva tu sesión", "Hola, quiero reservar una sesión."),
        contactActions(),
      ],
    },
  ],
  "belleza-barberia": [
    {
      slug: "ubicacion",
      blocksSeed: [
        textBlock("<h2>Cómo llegar</h2><p>Estamos a pasos del metro. Horario de ejemplo: martes a sábado de 10:00 a 20:00.</p>"),
        map("Av. Providencia 1234, Providencia, Santiago", "Tu Barbería (ejemplo)", "Estacionamiento en la calle."),
        whatsapp("Reserva tu hora", "Hola, quiero reservar una hora."),
      ],
    },
    { slug: "contacto", blocksSeed: contactPage("Reserva tu hora o cuéntanos qué corte buscas. Texto de ejemplo.", "Reserva tu hora", "Hola, quiero reservar una hora.") },
  ],
  "portada-minimal": [
    {
      slug: "agenda",
      blocksSeed: [
        textBlock("<h2>Agenda una sesión</h2><p>Una hora por videollamada para ordenar tus ideas y salir con un plan. Texto de ejemplo.</p>"),
        whatsapp("Agenda por WhatsApp", "Hola, quiero agendar una sesión."),
        contactActions(),
        faq([["¿Cómo es la primera sesión?", "Respuesta de ejemplo: conversamos tus objetivos y definimos un plan de trabajo."]]),
      ],
    },
    {
      slug: "portafolio",
      blocksSeed: [
        textBlock("<h2>Mi portafolio</h2><p>Proyectos y resultados recientes. Contenido de ejemplo.</p>"),
        gallery(
          [
            { url: STOCK_URL("photo-1490481651871-ab68de25d43d"), alt: "Foto de ejemplo: proyecto 1" },
            { url: STOCK_URL("photo-1445205170230-053b83016050"), alt: "Foto de ejemplo: proyecto 2" },
            { url: STOCK_URL("photo-1558769132-cb1aea458c5e"), alt: "Foto de ejemplo: proyecto 3" },
            { url: STOCK_URL("photo-1523381210434-271e8be1f52b"), alt: "Foto de ejemplo: proyecto 4" },
          ],
          "grid",
        ),
        testimonials([["Muy clara y cercana. Reseña de ejemplo.", "Clienta de ejemplo"]]),
        link("Agenda una sesión", "agenda", { primary: true }),
      ],
    },
  ],
  "academia-talleres": [
    {
      slug: "cursos",
      blocksSeed: [
        textBlock("<h2>Programa de cursos</h2><p>Formación práctica con certificado. Cursos y precios de ejemplo.</p>"),
        service("Curso inicial (ejemplo)", "Cuatro semanas, clases en vivo y material incluido. Precio de ejemplo.", 89000, "Inscribirme", "contacto"),
        service("Taller intensivo (ejemplo)", "Sesión práctica de 4 horas con certificado. Precio de ejemplo.", 45000, "Inscribirme", "contacto"),
        faq([["¿Hay becas o descuentos?", "Respuesta de ejemplo: sí, consulta por convenios y pago en cuotas."]]),
      ],
    },
    { slug: "contacto", blocksSeed: contactPage("Consultas de inscripción, empresas y convenios. Texto de ejemplo.", "Consulta sobre talleres", "Hola, me interesa inscribirme en un taller.") },
  ],
  "fitness-entrenamiento": [
    {
      slug: "horarios",
      blocksSeed: [
        textBlock("<h2>Horarios e instalaciones</h2><p>Clases guiadas y sala libre. Horarios de ejemplo.</p><ul><li>Lunes a viernes: 06:30 a 21:30</li><li>Sábado: 09:00 a 14:00</li><li>Domingo: cerrado</li></ul>"),
        gallery(
          [
            { url: STOCK_URL("photo-1544367567-0f2fcb009e0b"), alt: "Foto de ejemplo: clase al atardecer" },
            { url: STOCK_URL("photo-1503951914875-452162b0f3f1"), alt: "Foto de ejemplo: instalaciones" },
          ],
          "grid",
        ),
        whatsapp("Reserva tu clase de prueba", "Hola, quiero reservar una clase de prueba."),
      ],
    },
    { slug: "contacto", blocksSeed: contactPage("Planes, evaluación física y clases de prueba. Texto de ejemplo.", "Reserva tu clase de prueba", "Hola, quiero reservar una clase de prueba.") },
  ],
  "musico-banda": [
    {
      slug: "album",
      blocksSeed: [
        textBlock("<h2>Nuevo álbum</h2><p>Todas las canciones, el videoclip y las fotos del proceso. Contenido de ejemplo.</p>"),
        music({ provider: "spotify", kind: "track", id: "4cOdK2wGLETKBW3PvgPWqT" }, "Sencillo (ejemplo)"),
        video({ provider: "youtube", videoId: "dQw4w9WgXcQ" }, "Videoclip (ejemplo)"),
        social(["spotify", "youtube", "instagram", "tiktok"]),
      ],
    },
    { slug: "contacto", blocksSeed: contactPage("Contrataciones, prensa y colaboraciones. Texto de ejemplo.", "Escríbenos por WhatsApp", "Hola, quiero contratar una presentación.") },
  ],
  "restaurante-menu": [
    { slug: "contacto", blocksSeed: contactPage("Reservas de mesa, eventos privados y grupos. Texto de ejemplo.", "Reserva tu mesa por WhatsApp", "Hola, quiero reservar una mesa para cenar.", [map("Av. Italia 1450, Barrio Italia, Providencia, Santiago", "Ubicación del local", "Estacionamiento disponible en calles aledañas."), faq([["¿Aceptan reservas para grupos?", "Respuesta de ejemplo: sí, desde 8 personas con 48 horas de anticipación."]])]) },
  ],
};

/** Vistas y «me gusta» (F10): todo portal las trae, justo antes de las redes (o al final si no tiene). */
const ENGAGEMENT_BLOCK: TemplateBlockSeed = {
  type: "engagement",
  configSchemaVersion: 1,
  config: { showViews: true, showLikes: true, likeLabel: "Me gusta" },
};

function withEngagement(blocks: TemplateDefinition["blocksSeed"]): TemplateDefinition["blocksSeed"] {
  const socialIndex = blocks.findIndex((block) => block.type === "social");
  if (socialIndex === -1) return [...blocks, ENGAGEMENT_BLOCK];
  return [...blocks.slice(0, socialIndex), ENGAGEMENT_BLOCK, ...blocks.slice(socialIndex)];
}

/** Plantillas base con sus páginas compañeras (las que sus botones enlazan). */
const BASE_CATALOG: readonly TemplateDefinition[] = BASE_TEMPLATES.map((template): TemplateDefinition => {
  // Los portales completos (F10) traen su contenido de `portal-content.ts`: inicio + dos páginas, con álbum, cifras,
  // pasos, preguntas y acción clara. El contenido base de arriba queda como respaldo de una plantilla sin portal.
  const portal = PORTAL_CONTENT[template.code];
  if (portal) {
    return { ...template, blocksSeed: portal.home, companionPages: portal.pages.map((page) => ({ slug: page.slug, blocksSeed: page.blocks })) };
  }
  return {
    ...template,
    blocksSeed: withEngagement(template.blocksSeed),
    ...(COMPANION_PAGES[template.code] ? { companionPages: COMPANION_PAGES[template.code] } : {}),
  };
});

/**
 * El catálogo que se siembra: las plantillas base con sus portales, más las del editor de portales (rubros nuevos, inicio + dos
 * páginas cada una, ver `portal-extra-*.ts`).
 */
export const TEMPLATE_CATALOG: readonly TemplateDefinition[] = [...BASE_CATALOG, ...PORTAL_TEMPLATES_CREADORES, ...PORTAL_TEMPLATES_PROFESIONALES, ...PORTAL_TEMPLATES_OFICIOS];
