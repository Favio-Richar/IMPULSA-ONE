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
      url: `https://example.com/${path}`,
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
  {
    // PL7: la variante de la referencia de Favio — foto de cuerpo entero como cabecera y todos los
    // botones del mismo tono neutro (línea Minimal).
    code: "portada-minimal",
    name: "Portada de cuerpo entero",
    description: "Tu foto a lo alto y botones del mismo tono: elegante y minimalista. Para marcas personales, artistas y coaches.",
    industryTags: ["creador", "profesional"],
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
      service("Sesión de asesoría (ejemplo)", "Una hora por videollamada. Precio de ejemplo.", 30000, "Reservar", "sesion"),
      testimonials([["Muy clara y cercana. Reseña de ejemplo.", "Clienta de ejemplo"]]),
      social(["instagram", "tiktok", "linkedin"]),
    ],
  },
  {
    code: "academia-talleres",
    name: "Academia y talleres",
    description: "Para centros de formación, academias y docentes: cursos, agenda de talleres, boletín y contacto.",
    industryTags: ["educacion", "profesional"],
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
          ticketUrl: "https://example.com/entradas-taller",
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
    industryTags: ["salud", "belleza-bienestar"],
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
          cta: { label: "Elegir plan", url: "https://example.com/plan-mensual" },
        },
        {
          name: "Pase 8 Clases (ejemplo)",
          priceAmount: 28000,
          priceCurrency: "CLP",
          period: "once",
          description: "Pack de 8 sesiones para usar dentro de 45 días corridos.",
          features: ["8 clases guiadas", "Flexibilidad horaria"],
          highlighted: false,
          cta: { label: "Comprar pase", url: "https://example.com/pase-clases" },
        },
      ]),
      gallery(
        [
          { url: "https://example.com/espacio-1.jpg", alt: "Zona de pesas y máquinas de ejemplo" },
          { url: "https://example.com/espacio-2.jpg", alt: "Sala de clases funcionales de ejemplo" },
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
    industryTags: ["creador"],
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
          ticketUrl: "https://example.com/entradas-concierto",
          ticketLabel: "Comprar entrada",
        },
      ]),
      video(
        { provider: "youtube", videoId: "dQw4w9WgXcQ" },
        "Videoclip oficial en YouTube (ejemplo)",
      ),
      gallery(
        [
          { url: "https://example.com/en-vivo-1.jpg", alt: "Fotografía de show en vivo de ejemplo" },
          { url: "https://example.com/en-vivo-2.jpg", alt: "Sesión de grabación en estudio de ejemplo" },
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
          { url: "https://example.com/plato-1.jpg", alt: "Plato de autor con productos de temporada de ejemplo" },
          { url: "https://example.com/salon-1.jpg", alt: "Comedor principal y barra de tragos de ejemplo" },
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
