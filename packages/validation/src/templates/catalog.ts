import type { TemplateBlockSeed, TemplateDefinition } from "./index.js";

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

function profile(name: string, headline: string, bio: string): TemplateBlockSeed {
  return {
    type: "profile",
    configSchemaVersion: 1,
    config: { name, headline, bio: `<p>${bio}</p>`, verified: false },
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
      url: `https://example.com/${path}`,
      ...(options.description ? { description: options.description } : {}),
      style: options.primary ? "primary" : "secondary",
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
      cta: { label: ctaLabel, url: `https://example.com/${path}` },
    },
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
    config: { links: networks.map((network) => ({ network, url: NETWORK_HOME[network] })), style: "icons" },
  };
}

const EXAMPLE_BIO = "Texto de ejemplo: reemplázalo por";

export const TEMPLATE_CATALOG: readonly TemplateDefinition[] = [
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
    industryTags: ["creador"],
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
    code: "belleza-barberia",
    name: "Barbería y belleza",
    description: "Para barberías, peluquerías y estética: servicios con precio y reservas por WhatsApp.",
    industryTags: ["belleza-bienestar", "servicios-locales"],
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
];
