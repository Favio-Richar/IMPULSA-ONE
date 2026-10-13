import type { TemplateBlockSeed } from "./index.js";

/**
 * Contenido de los portales completos (F10). Cada plantilla es un portal de tres páginas: inicio (el «hub» con lo mejor
 * de cada sección), una página principal del oficio (álbum, carta, servicios, catálogo…) y una de contacto o reservas.
 * Todo el texto es de ejemplo y está marcado como tal; las fotos son de ejemplo (Unsplash, sin marcas visibles) y el
 * negocio las reemplaza por las suyas. Ningún botón apunta a un sitio inexistente: todos llevan a páginas del portal
 * (`page:<slug>`), por eso cada plantilla trae dos páginas compañeras (con la de inicio, tres: lo que admite el plan
 * gratis). El orden y la composición de cada página siguen el mismo criterio: encabezado, contenido principal, prueba
 * social, preguntas y una acción clara al final.
 */

type Seed = TemplateBlockSeed;

const PHONE = "+56900000000";
const EMAIL = "contacto@example.com";

/** Fotos de ejemplo verificadas, una por clave. Sin logotipos de marcas a la vista. */
const PHOTO_IDS = {
  // Moda y retrato
  boutique: "photo-1445205170230-053b83016050",
  knitwear: "photo-1558769132-cb1aea458c5e",
  shopper: "photo-1483985988355-763728e1935b",
  streetWoman: "photo-1485968579580-b6d095142e6e",
  jacketMan: "photo-1487222477894-8943e31ef7b2",
  sunglasses: "photo-1469334031218-e382a71b716b",
  redSmile: "photo-1494790108377-be9c29b29330",
  jumpsuit: "photo-1495385794356-15371f348c31",
  pinkWall: "photo-1503342217505-b0a15ec3261c",
  whiteDress: "photo-1515372039744-b8f02a3ae446",
  blueHoodie: "photo-1517841905240-472988babdf9",
  womanSmile: "photo-1520813792240-56fc4a3765a7",
  portraitWoman: "photo-1529626455594-4ff0802cfb7e",
  milan: "photo-1539109136881-3be0616acf4b",
  yellowHat: "photo-1543087903-1ac2ec7aa8c5",
  orangePortrait: "photo-1573496359142-b8d87734a5a2",
  womanOutdoor: "photo-1508214751196-bcfd4ca60f91",
  womanBob: "photo-1438761681033-6461ffad8d80",
  pinkBackdrop: "photo-1531746020798-e6953c6e8e04",
  // Retrato masculino y trabajo
  manPortrait: "photo-1500648767791-00dcc994a43e",
  manSmile: "photo-1507003211169-0a1dd7228f2d",
  manDark: "photo-1506794778202-cad84cf45f1d",
  manSuit: "photo-1507679799987-c73779587ccf",
  manSuit2: "photo-1534030347209-467a5b0ad3e6",
  darkSuit: "photo-1519085360753-af0119f7cbe7",
  meeting: "photo-1521737604893-d14cc237f11d",
  conference: "photo-1542744173-8e7e53415bb0",
  workshop: "photo-1552664730-d307ca884978",
  office: "photo-1556761175-5973dc0f32e7",
  podcast: "photo-1559523161-0fc0d8b38a7a",
  city: "photo-1503951458645-643d53bfd90f",
  // Gastronomía
  dishes: "photo-1414235077428-338989a2e8c0",
  restaurant: "photo-1517248135467-4c7edcad34c4",
  diners: "photo-1528605248644-14dd04022da1",
  terrace: "photo-1559339352-11d035aa65de",
  bar: "photo-1556157382-97eda2d62296",
  plate: "photo-1504674900247-0877df9cc836",
  coffee: "photo-1495474472287-4d71bcdd2085",
  cafe: "photo-1554118811-1e0d58224f24",
  bakery: "photo-1509440159596-0249088772ff",
  // Comercio
  openShop: "photo-1472851294608-062f824d29cc",
  store: "photo-1441986300917-64674bd600d8",
  product: "photo-1556228720-195a672e8a03",
  // Bienestar, belleza y deporte
  yoga: "photo-1506126613408-eca07ce68773",
  exercise: "photo-1518611012118-696072aa579a",
  pilates: "photo-1571019613454-1cb2f99b2d8b",
  treatment: "photo-1512290923902-8a9f81dc236c",
  plants: "photo-1521334884684-d80222895322",
  climber: "photo-1519834785169-98be25ec3f84",
  wellness: "photo-1544367567-0f2fcb009e0b",
  salon: "photo-1521590832167-7bcbfaa6381f",
  brushes: "photo-1516975080664-ed2fc6a32937",
  barber: "photo-1503951914875-452162b0f3f1",
  barbell: "photo-1517836357463-d25dfeac3438",
  gym: "photo-1534438327276-14e5300c3a48",
  bikes: "photo-1540497077202-7c8a3999166f",
  // Música y eventos
  concert: "photo-1459749411175-04bf5292ceea",
  crowd: "photo-1501386761578-eac5c94b800a",
  concertOrange: "photo-1524368535928-5b5e00ddc76b",
  dj: "photo-1516873240891-4bf014598ab4",
  djPurple: "photo-1470225620780-dba8ba36b745",
  performer: "photo-1493225457124-a3eb161ffa5f",
  guitars: "photo-1511379938547-c1f69419868d",
  microphone: "photo-1511671782779-c97d3d27a1d4",
  festival: "photo-1492684223066-81342ee5ff30",
} as const;

export type PhotoKey = keyof typeof PHOTO_IDS;

const url = (key: PhotoKey, width = 1400): string => `https://images.unsplash.com/${PHOTO_IDS[key]}?auto=format&fit=crop&w=${width}&q=80`;
const img = (key: PhotoKey, alt: string, width = 1400) => ({ url: url(key, width), alt: `Foto de ejemplo: ${alt}` });

const block = (type: string, config: unknown, isPrimary = false): Seed => ({
  type,
  configSchemaVersion: 1,
  ...(isPrimary ? { isPrimary: true as const } : {}),
  config,
});

const rich = (html: string): string => html;

// ---------------------------------------------------------------- constructores de bloques

const profile = (name: string, headline: string, bio: string, cover?: { key: PhotoKey; alt: string }): Seed =>
  block("profile", {
    name,
    headline,
    bio: rich(`<p>${bio}</p>`),
    verified: false,
    shareButton: true,
    ...(cover ? { cover: img(cover.key, cover.alt), layout: "hero" } : {}),
  });

const whatsapp = (label: string, message: string, primary = true): Seed => block("whatsapp", { phone: PHONE, label, prefilledMessage: message }, primary);
const header = (eyebrow: string, title: string, subtitle: string): Seed => block("page_header", { eyebrow, title, subtitle });
const marquee = (items: string[]): Seed => block("marquee", { items, speed: "normal" });
const stats = (items: Array<[string, string]>, title?: string): Seed => block("stats", { ...(title ? { title } : {}), items: items.map(([value, label]) => ({ value, label })) });
const steps = (title: string, items: Array<[string, string]>): Seed => block("steps", { title, items: items.map(([name, description]) => ({ title: name, description })) });
const faq = (items: Array<[string, string]>): Seed =>
  block("faq", { title: "Preguntas frecuentes", items: items.map(([question, answer]) => ({ question, answer: `<p>${answer}</p>` })) });
const testimonials = (items: Array<[string, string]>): Seed =>
  block("testimonials", { title: "Lo que dicen (reseñas de ejemplo)", items: items.map(([quote, author]) => ({ quote, author, rating: 5 })) });
const social = (networks: Array<"instagram" | "facebook" | "tiktok" | "youtube" | "linkedin" | "spotify">): Seed => {
  const home: Record<string, string> = {
    instagram: "https://www.instagram.com/",
    facebook: "https://www.facebook.com/",
    tiktok: "https://www.tiktok.com/",
    youtube: "https://www.youtube.com/",
    linkedin: "https://www.linkedin.com/",
    spotify: "https://open.spotify.com/",
  };
  return block("social", { links: networks.map((network) => ({ network, url: home[network] })), style: "buttons" });
};
// Botón «Suscribirme» del portal (extra F10): lleva a la página de suscripción del sitio (`/:sitio/s`). Un botón, sin formularios.
const subscribe = (label = "Suscríbete", description = "Contenido exclusivo"): Seed => block("subscribe", { label, description });
const engagement = (): Seed => block("engagement", { showViews: true, showLikes: true, likeLabel: "Me gusta" });
const newsletter = (title: string, description: string, button = "Suscribirme"): Seed =>
  block("newsletter", { title, description, askName: true, buttonLabel: button, successMessage: "¡Gracias! Revisa tu correo para confirmar tu suscripción." });
const map = (address: string, name: string, note: string): Seed => block("map", { address, name, note, showMap: true });
const contactActions = (): Seed => block("contact_actions", { email: EMAIL, phone: PHONE, emailLabel: "Escríbeme por correo", phoneLabel: "Llámame" });
const text = (html: string): Seed => block("text", { html: rich(html), alignment: "left" });
const link = (label: string, page: string, description?: string, primary = false): Seed =>
  block("link", { label, url: `page:${page}`, ...(description ? { description } : {}), style: primary ? "primary" : "secondary", shareable: true }, primary);
const service = (name: string, description: string, price: number, ctaLabel: string, page = "contacto"): Seed =>
  block("service", { name, description: `<p>${description}</p>`, priceAmount: price, priceCurrency: "CLP", cta: { label: ctaLabel, url: `page:${page}` } });
/** Servicio informativo, sin botón propio: la página ya termina en la acción principal. */
const serviceInfo = (name: string, description: string, price: number): Seed =>
  block("service", { name, description: `<p>${description}</p>`, priceAmount: price, priceCurrency: "CLP" });
const feature = (key: PhotoKey, alt: string, eyebrow: string, title: string, html: string, position: "left" | "right" = "left", cta?: { label: string; page: string }): Seed =>
  block("feature", {
    image: img(key, alt, 1000),
    imagePosition: position,
    eyebrow,
    title,
    text: rich(html),
    ...(cta ? { cta: { label: cta.label, url: `page:${cta.page}` } } : {}),
  });
const album = (
  title: string,
  description: string,
  photos: Array<[PhotoKey, string, string, string?]>,
  layout: "masonry" | "grid" = "masonry",
): Seed =>
  block("album", {
    title,
    description,
    layout,
    showFilters: true,
    photos: photos.map(([key, alt, photoTitle, category]) => ({ image: img(key, alt), title: photoTitle, ...(category ? { category } : {}) })),
  });
const showcase = (title: string, items: Array<{ title: string; subtitle: string; badge?: string; photo: PhotoKey; alt: string; page: string }>): Seed =>
  block("showcase", {
    title,
    layout: "stack",
    actionLabel: "Ver",
    items: items.map((item) => ({
      title: item.title,
      subtitle: item.subtitle,
      ...(item.badge ? { badge: item.badge } : {}),
      image: img(item.photo, item.alt),
      link: `page:${item.page}`,
    })),
  });
const wheel = (label: string, items: Array<{ title: string; photo: PhotoKey; alt: string; page: string }>): Seed =>
  block("works_wheel", {
    label,
    actionLabel: "Ver",
    items: items.map((item) => ({ title: item.title, image: img(item.photo, item.alt, 900), link: `page:${item.page}` })),
  });
const pricing = (
  title: string,
  plans: Array<{ name: string; price: number; period: "once" | "month" | "year"; description: string; features: string[]; badge?: string; highlighted?: boolean; cta: string }>,
): Seed =>
  block("pricing", {
    title,
    plans: plans.map((plan) => ({
      name: plan.name,
      priceAmount: plan.price,
      priceCurrency: "CLP",
      period: plan.period,
      description: plan.description,
      features: plan.features,
      ...(plan.badge ? { badge: plan.badge } : {}),
      highlighted: plan.highlighted === true,
      cta: { label: plan.cta, url: "page:contacto" },
    })),
  });
const events = (title: string, items: Array<{ name: string; start: string; end?: string; venue: string; description: string; label: string }>): Seed =>
  block("events", {
    title,
    timeZone: "America/Santiago",
    items: items.map((item) => ({ name: item.name, start: item.start, ...(item.end ? { end: item.end } : {}), venue: item.venue, description: item.description, ticketUrl: "page:contacto", ticketLabel: item.label, soldOut: false })),
  });
const booking = (label: string): Seed => block("booking", { label }, true);
const music = (title: string): Seed => block("music", { music: { provider: "spotify", kind: "track", id: "4cOdK2wGLETKBW3PvgPWqT" }, title });
const video = (title: string): Seed => block("video", { video: { provider: "youtube", videoId: "dQw4w9WgXcQ" }, title });

export interface PortalDefinition {
  home: Seed[];
  pages: Array<{ slug: string; blocks: Seed[] }>;
}

const PROMISE = "Texto de ejemplo: reemplázalo por tu propia historia.";

// ================================================================ las 13 plantillas
export const PORTAL_CONTENT: Record<string, PortalDefinition> = {
  // ------------------------------------------------------------ Profesional de servicios
  "profesional-servicios": {
    home: [
      profile("Tu Estudio Profesional", "Asesoría contable y tributaria para pymes", `${PROMISE} A quién ayudas, en qué te especializas y por qué confiar en ti.`),
      whatsapp("Agenda una asesoría", "Hola, quiero agendar una asesoría."),
      subscribe(),
      showcase("Cómo puedo ayudarte", [
        { title: "Servicios y tarifas", subtitle: "Asesorías, planes mensuales y metodología", badge: "3 planes", photo: "meeting", alt: "reunión de trabajo", page: "servicios" },
        { title: "Agenda tu primera reunión", subtitle: "Cuéntanos tu caso y te respondemos hoy", photo: "office", alt: "oficina luminosa", page: "contacto" },
      ]),
      stats([["+250", "clientes asesorados"], ["12 años", "de experiencia"], ["24 h", "tiempo de respuesta"]]),
      testimonials([
        ["Me ordenó la contabilidad en un mes y por fin entiendo mis números. Reseña de ejemplo.", "Dueña de pyme de ejemplo"],
        ["Respuestas claras y a tiempo, sin letra chica. Reseña de ejemplo.", "Emprendedor de ejemplo"],
      ]),
      engagement(),
      social(["linkedin", "instagram"]),
    ],
    pages: [
      {
        slug: "servicios",
        blocks: [
          header("Servicios", "Asesoría que ordena tu negocio", "Planes claros, sin letra chica, y un profesional que responde. Servicios y precios de ejemplo."),
          feature("manSuit", "profesional en traje", "Quién te acompaña", "Más de una década cuidando los números de pymes", "<p>Texto de ejemplo: cuenta tu trayectoria, tus certificaciones y el tipo de clientes con los que trabajas.</p><ul><li>Contabilidad y tributación para pymes</li><li>Planificación y control de gestión</li><li>Acompañamiento en fiscalizaciones</li></ul>", "left"),
          steps("Cómo trabajamos", [
            ["Diagnóstico gratuito", "Revisamos tu situación actual y te contamos qué está bien y qué hay que corregir."],
            ["Plan de acción", "Definimos prioridades, plazos y un presupuesto cerrado."],
            ["Ejecución", "Nos encargamos del trabajo y te mantenemos informado cada mes."],
          ]),
          pricing("Planes mensuales", [
            { name: "Inicio", price: 59990, period: "month", description: "Para emprendimientos que recién parten.", features: ["Declaraciones mensuales", "Un contacto por correo"], cta: "Elegir plan" },
            { name: "Pyme", price: 119990, period: "month", description: "El más elegido.", features: ["Contabilidad completa", "Reunión mensual", "Soporte por WhatsApp"], badge: "Más elegido", highlighted: true, cta: "Elegir plan" },
            { name: "Crecimiento", price: 199990, period: "month", description: "Para empresas con equipo.", features: ["Todo lo anterior", "Remuneraciones", "Informes de gestión"], cta: "Cotizar" },
          ]),
          faq([
            ["¿Atiendes en línea?", "Respuesta de ejemplo: sí, por videollamada o de forma presencial en Santiago."],
            ["¿Cuánto demora el diagnóstico?", "Respuesta de ejemplo: una reunión de 45 minutos y un informe en 48 horas."],
            ["¿Puedo cambiar de plan?", "Respuesta de ejemplo: sí, cuando quieras y sin costo."],
          ]),
          whatsapp("Agenda una asesoría", "Hola, quiero agendar una asesoría."),
        ],
      },
      {
        slug: "contacto",
        blocks: [
          header("Contacto", "Hablemos de tu caso", "Cuéntanos qué necesitas y te respondemos el mismo día hábil. Texto de ejemplo."),
          whatsapp("Agenda una asesoría", "Hola, quiero agendar una asesoría."),
          contactActions(),
          map("Av. Providencia 1234, Providencia, Santiago", "Oficina (ejemplo)", "Atendemos con cita previa de lunes a viernes."),
          newsletter("Guía de inicio de actividades", "Déjanos tu correo y te enviamos la guía gratuita con los pasos y documentos que necesitas.", "Quiero la guía"),
          faq([["¿Cómo agendo una reunión?", "Respuesta de ejemplo: por WhatsApp o escribiéndonos; confirmamos el mismo día."]]),
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Café y gastronomía
  "cafe-gastronomia": {
    home: [
      profile("Tu Café de Barrio", "Café de especialidad y pastelería de la casa", `${PROMISE} Tu historia, tu horario y dónde encontrarte.`, { key: "cafe", alt: "interior de una cafetería con plantas" }),
      whatsapp("Haz tu pedido por WhatsApp", "Hola, quiero hacer un pedido."),
      subscribe(),
      showcase("Todo lo que ofrecemos", [
        { title: "Nuestra carta", subtitle: "Café, pastelería y platos del día", badge: "Precios de ejemplo", photo: "coffee", alt: "tazas de café con arte latte", page: "carta" },
        { title: "Visítanos", subtitle: "Horarios, mapa y reservas de mesa", photo: "terrace", alt: "terraza de un local", page: "contacto" },
      ]),
      stats([["+40", "tipos de café y té"], ["100 %", "pastelería de la casa"], ["7 días", "abiertos a la semana"]]),
      testimonials([["El mejor café del barrio y el pastel de limón es una locura. Reseña de ejemplo.", "Cliente de ejemplo"]]),
      engagement(),
      social(["instagram", "tiktok"]),
    ],
    pages: [
      {
        slug: "carta",
        blocks: [
          header("La carta", "Hecho cada mañana", "Café de especialidad, pastelería artesanal y platos del día. Productos y precios de ejemplo."),
          album("Sabores de la casa", "Una muestra de lo que sale de nuestra cocina.", [
            ["coffee", "tazas de café con arte latte", "Café de especialidad", "Café"],
            ["bakery", "panes de masa madre y espigas", "Panadería de masa madre", "Pastelería"],
            ["dishes", "platos servidos en una mesa", "Platos del día", "Cocina"],
            ["plate", "plato con carne y ensalada", "Almuerzo ejecutivo", "Cocina"],
            ["cafe", "interior de la cafetería", "El local", "Ambiente"],
            ["terrace", "terraza con mesas", "Terraza", "Ambiente"],
          ]),
          service("Café de especialidad (ejemplo)", "Espresso, latte o filtrado con granos de origen único.", 3200, "Pedir"),
          service("Pastel del día (ejemplo)", "Elaboración propia, cambia cada día.", 3900, "Pedir"),
          service("Brunch del fin de semana (ejemplo)", "Café, jugo natural y plato del día. Con reserva.", 12900, "Reservar"),
          feature("bakery", "panes de masa madre", "Nuestra historia", "Cocina simple, ingredientes de verdad", "<p>Texto de ejemplo: cuenta cómo nació el café, quiénes cocinan y de dónde vienen tus ingredientes.</p>", "right"),
        ],
      },
      {
        slug: "contacto",
        blocks: [
          header("Visítanos", "Te esperamos con un buen café", "Pedidos, reservas de mesa y eventos privados. Información de ejemplo."),
          whatsapp("Haz tu pedido por WhatsApp", "Hola, quiero hacer un pedido."),
          map("Av. Providencia 1234, Providencia, Santiago", "Nuestro local (ejemplo)", "Abierto de martes a domingo, de 08:30 a 20:00."),
          contactActions(),
          faq([["¿Aceptan reservas?", "Respuesta de ejemplo: sí, para grupos de 4 o más personas."], ["¿Tienen opciones sin gluten?", "Respuesta de ejemplo: sí, consulta por la carta del día."]]),
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Tienda y comercio
  "comercio-tienda": {
    home: [
      profile("Tu Tienda", "Accesorios hechos a mano, envíos a todo el país", `${PROMISE} Qué vendes, cómo haces los envíos y tus medios de pago.`, { key: "store", alt: "tienda con productos exhibidos" }),
      whatsapp("Compra por WhatsApp", "Hola, quiero comprar un producto."),
      subscribe(),
      showcase("Descubre la tienda", [
        { title: "Catálogo completo", subtitle: "Productos, fotos y precios", badge: "Nuevos", photo: "boutique", alt: "prendas en un perchero", page: "catalogo" },
        { title: "Pregunta por tu pedido", subtitle: "Envíos, cambios y medios de pago", photo: "openShop", alt: "letrero de tienda abierta", page: "contacto" },
      ]),
      stats([["+1.000", "pedidos entregados"], ["48 h", "despacho"], ["30 días", "para cambios"]]),
      testimonials([["Llegó rapidísimo y bien embalado. Reseña de ejemplo.", "Clienta de ejemplo"]]),
      engagement(),
      social(["instagram", "facebook", "tiktok"]),
    ],
    pages: [
      {
        slug: "catalogo",
        blocks: [
          header("Catálogo", "Todo lo que tenemos para ti", "Productos hechos con cuidado, con envío a todo el país. Productos y precios de ejemplo."),
          block("catalog", { label: "Ver el catálogo completo" }),
          album("Novedades", "Lo último que llegó a la tienda.", [
            ["boutique", "perchero con prendas", "Colección de temporada", "Ropa"],
            ["knitwear", "prendas tejidas", "Tejidos", "Ropa"],
            ["product", "producto de belleza", "Cuidado personal", "Belleza"],
            ["store", "interior de la tienda", "La tienda", "Tienda"],
            ["shopper", "persona con bolsas de compras", "Pedidos listos", "Tienda"],
            ["openShop", "letrero de tienda abierta", "Atendemos todos los días", "Tienda"],
          ]),
          steps("Cómo comprar", [
            ["Elige tu producto", "Mira el catálogo y escríbenos por WhatsApp con lo que te gustó."],
            ["Paga a tu manera", "Transferencia o tarjeta. Te enviamos el enlace de pago."],
            ["Recíbelo en casa", "Despachamos en 48 horas hábiles con número de seguimiento."],
          ]),
          faq([
            ["¿Hacen envíos a regiones?", "Respuesta de ejemplo: sí, a todo el país por courier."],
            ["¿Puedo cambiar un producto?", "Respuesta de ejemplo: sí, dentro de 30 días con su empaque."],
          ]),
          whatsapp("Compra por WhatsApp", "Hola, quiero comprar un producto."),
        ],
      },
      {
        slug: "contacto",
        blocks: [
          header("Contacto", "Estamos para ayudarte", "Consultas de productos, pedidos y envíos. Texto de ejemplo."),
          whatsapp("Compra por WhatsApp", "Hola, quiero comprar un producto."),
          contactActions(),
          newsletter("Ofertas y novedades", "Suscríbete y recibe primero los lanzamientos y descuentos de temporada.", "Quiero enterarme"),
          faq([["¿Qué medios de pago aceptan?", "Respuesta de ejemplo: transferencia y tarjetas de crédito y débito."]]),
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Creador y marca personal
  "creador-personal": {
    home: [
      profile("Tu Nombre", "Música, contenido y colaboraciones", `${PROMISE} Quién eres y qué compartes con tu comunidad.`, { key: "yellowHat", alt: "persona con sombrero sobre fondo amarillo" }),
      link("Escucha mi nuevo lanzamiento", "lanzamiento", "Mi último trabajo, con todo el detrás de cámaras", true),
      subscribe(),
      showcase("Mi universo", [
        { title: "Nuevo lanzamiento", subtitle: "Escúchalo y mira cómo se hizo", badge: "Nuevo", photo: "microphone", alt: "micrófono de estudio", page: "lanzamiento" },
        { title: "Colaboraciones y prensa", subtitle: "Marcas, medios y proyectos conjuntos", photo: "podcast", alt: "grabación de un podcast", page: "contacto" },
      ]),
      stats([["+120 mil", "seguidores"], ["+3 M", "reproducciones"], ["+40", "marcas aliadas"]]),
      engagement(),
      social(["instagram", "tiktok", "youtube", "spotify"]),
    ],
    pages: [
      {
        slug: "lanzamiento",
        blocks: [
          header("Lanzamiento", "Lo nuevo, primero aquí", "Escúchalo, míralo y cuéntame qué te pareció. Contenido de ejemplo."),
          music("Sencillo (ejemplo)"),
          video("Detrás de cámaras (ejemplo)"),
          album("Del proceso", "Fotos del estudio y del rodaje.", [
            ["microphone", "micrófono de estudio", "Grabación", "Estudio"],
            ["podcast", "sesión de grabación", "Sesión en vivo", "Estudio"],
            ["guitars", "guitarras en una sala", "Instrumentos", "Estudio"],
            ["pinkWall", "persona frente a un muro rosado", "Sesión de fotos", "Fotos"],
            ["blueHoodie", "persona con sudadera azul", "Backstage", "Fotos"],
          ]),
          newsletter("Entérate primero", "Te aviso de cada lanzamiento antes que nadie.", "Avísame"),
        ],
      },
      {
        slug: "contacto",
        blocks: [
          header("Colaboraciones", "Trabajemos juntos", "Marcas, medios y proyectos creativos: cuéntame tu propuesta. Texto de ejemplo."),
          stats([["62 %", "audiencia de 18 a 34 años"], ["58 %", "mujeres"], ["Chile y LATAM", "alcance principal"]], "Mi audiencia (ejemplo)"),
          steps("Cómo colaboramos", [
            ["Me escribes", "Cuéntame la marca, el objetivo y las fechas."],
            ["Propuesta", "Te envío una idea y un presupuesto en 48 horas."],
            ["Producción", "Grabamos, revisas y publicamos juntos."],
          ]),
          whatsapp("Escríbeme por WhatsApp", "Hola, tengo una propuesta de colaboración."),
          contactActions(),
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Salud y bienestar
  "salud-bienestar": {
    home: [
      profile("Tu Consulta", "Kinesiología y bienestar integral", `${PROMISE} Tu especialidad, tus títulos y cómo atiendes.`, { key: "wellness", alt: "persona haciendo yoga al atardecer" }),
      whatsapp("Reserva tu hora", "Hola, quiero reservar una hora."),
      subscribe(),
      showcase("Cómo te acompaño", [
        { title: "Tratamientos", subtitle: "Evaluación, terapia y seguimiento", badge: "Primera sesión", photo: "treatment", alt: "tratamiento en una consulta", page: "tratamientos" },
        { title: "Reserva y ubicación", subtitle: "Horarios, convenios y cómo llegar", photo: "plants", alt: "sala con plantas", page: "contacto" },
      ]),
      stats([["+1.500", "pacientes atendidos"], ["10 años", "de experiencia"], ["98 %", "recomendaría la consulta"]]),
      testimonials([["Me sentí escuchada desde la primera sesión. Reseña de ejemplo.", "Paciente de ejemplo"]]),
      engagement(),
      social(["instagram", "facebook"]),
    ],
    pages: [
      {
        slug: "tratamientos",
        blocks: [
          header("Tratamientos", "Un plan hecho para ti", "Evaluación personalizada y seguimiento en cada etapa. Servicios y precios de ejemplo."),
          feature("womanSmile", "profesional sonriendo", "Quién te atiende", "Atención cercana y basada en evidencia", "<p>Texto de ejemplo: tus títulos, tu enfoque de trabajo y cómo es una primera sesión.</p><ul><li>Evaluación completa</li><li>Plan de tratamiento por etapas</li><li>Ejercicios para hacer en casa</li></ul>", "right"),
          service("Primera sesión (ejemplo)", "Evaluación y plan de tratamiento. 60 minutos.", 25000, "Reservar"),
          service("Sesión de seguimiento (ejemplo)", "Terapia y control de avances. 45 minutos.", 20000, "Reservar"),
          service("Plan de 8 sesiones (ejemplo)", "Programa completo con descuento.", 140000, "Reservar"),
          steps("Cómo es el proceso", [
            ["Evaluación", "Conversamos y medimos tu punto de partida."],
            ["Tratamiento", "Trabajamos por etapas con objetivos claros."],
            ["Alta y control", "Te damos pautas para mantener los resultados."],
          ]),
          album("La consulta", "Un espacio tranquilo y preparado para ti.", [
            ["treatment", "tratamiento en consulta", "Sala de tratamiento", "Consulta"],
            ["plants", "sala con plantas", "Recepción", "Consulta"],
            ["pilates", "ejercicios en el suelo", "Rehabilitación", "Ejercicio"],
            ["yoga", "yoga al atardecer", "Bienestar", "Ejercicio"],
          ], "grid"),
        ],
      },
      {
        slug: "contacto",
        blocks: [
          header("Reserva tu hora", "Cuéntanos qué necesitas", "Reserva por WhatsApp o escríbenos; confirmamos el mismo día. Información de ejemplo."),
          whatsapp("Reserva tu hora", "Hola, quiero reservar una hora."),
          text("<h3>Convenios y previsiones</h3><p>Atendemos con bono electrónico y reembolso. Información de ejemplo: reemplázala por la real.</p><ul><li>Isapres y seguros complementarios</li><li>Convenios con empresas</li></ul>"),
          map("Av. Providencia 1234, Providencia, Santiago", "Consulta (ejemplo)", "Atención de lunes a sábado con hora agendada."),
          faq([
            ["¿Necesito orden médica?", "Respuesta de ejemplo: no para la primera evaluación."],
            ["¿Atienden a domicilio?", "Respuesta de ejemplo: sí, dentro de la comuna."],
          ]),
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Eventos y turismo
  "eventos-turismo": {
    home: [
      profile("Tu Experiencia", "Tours y experiencias al aire libre", `${PROMISE} Qué experiencias ofreces, dónde y para quién.`, { key: "climber", alt: "persona frente a un mar de nubes" }),
      whatsapp("Reserva tu cupo", "Hola, quiero reservar un cupo."),
      subscribe(),
      showcase("Vive la experiencia", [
        { title: "Experiencias y fechas", subtitle: "Salidas confirmadas, con cupos limitados", badge: "Cupos limitados", photo: "festival", alt: "público en un evento", page: "experiencias" },
        { title: "Reservas y grupos", subtitle: "Empresas, familias y experiencias a medida", photo: "city", alt: "ciudad al atardecer", page: "contacto" },
      ]),
      stats([["+3.000", "viajeros felices"], ["4,9 / 5", "valoración promedio"], ["12", "experiencias distintas"]]),
      testimonials([["Una experiencia inolvidable, muy bien organizada. Reseña de ejemplo.", "Viajera de ejemplo"]]),
      engagement(),
      social(["instagram", "facebook", "youtube"]),
    ],
    pages: [
      {
        slug: "experiencias",
        blocks: [
          header("Experiencias", "Elige tu próxima aventura", "Salidas guiadas con todo incluido. Fechas, cupos y precios de ejemplo."),
          album("Lo que vas a vivir", "Momentos de nuestras últimas salidas.", [
            ["climber", "persona sobre las nubes", "Cumbre al amanecer", "Aventura"],
            ["city", "ciudad desde las alturas", "Recorrido urbano", "Ciudad"],
            ["festival", "público celebrando", "Fiesta de cierre", "Eventos"],
            ["terrace", "terraza frente al mar", "Almuerzo con vista", "Gastronomía"],
            ["crowd", "multitud en un evento", "Festival", "Eventos"],
            ["yoga", "yoga al atardecer", "Retiro de bienestar", "Aventura"],
          ]),
          service("Tour de medio día (ejemplo)", "Traslado, guía y colación. Precio por persona.", 45000, "Reservar"),
          service("Experiencia privada (ejemplo)", "Para grupos de hasta 8 personas.", 180000, "Cotizar"),
          events("Salidas confirmadas", [
            { name: "Tour de medio día (ejemplo)", start: "2027-01-16T09:00", end: "2027-01-16T14:00", venue: "Punto de encuentro (ejemplo)", description: "Incluye traslado, guía y colación.", label: "Reservar cupo" },
            { name: "Experiencia privada (ejemplo)", start: "2027-01-23T10:00", end: "2027-01-23T16:00", venue: "A convenir", description: "Para grupos, empresas y celebraciones.", label: "Cotizar" },
          ]),
          steps("Cómo reservar", [
            ["Elige la fecha", "Mira las salidas y escoge la que mejor te acomode."],
            ["Reserva tu cupo", "Escríbenos y asegura tu lugar con una seña."],
            ["Disfruta", "Te enviamos los detalles y nos vemos en el punto de encuentro."],
          ]),
        ],
      },
      {
        slug: "contacto",
        blocks: [
          header("Reservas", "Armemos tu experiencia", "Grupos, empresas y experiencias a medida. Texto de ejemplo."),
          whatsapp("Reserva tu cupo", "Hola, quiero reservar un cupo."),
          contactActions(),
          faq([
            ["¿Qué incluye el tour?", "Respuesta de ejemplo: traslado, guía y colación."],
            ["¿Qué pasa si llueve?", "Respuesta de ejemplo: reprogramamos sin costo."],
            ["¿Hay cupos para niños?", "Respuesta de ejemplo: sí, desde los 8 años."],
          ]),
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Fotógrafo, modelo y moda
  "fotografia-moda": {
    home: [
      profile("Tu Nombre Artístico", "Fotografía de moda · Editorial · Retrato", `${PROMISE} Tu estilo, tu trayectoria y con qué marcas o personas has trabajado.`, { key: "boutique", alt: "perchero de una boutique" }),
      marquee(["Fotografía", "Moda", "Editorial", "Retrato", "Belleza"]),
      whatsapp("Reserva tu sesión", "Hola, quiero reservar una sesión de fotos."),
      subscribe(),
      wheel("Portafolio 2026", [
        { title: "Editorial Otoño", photo: "knitwear", alt: "prendas de otoño", page: "album" },
        { title: "Retrato", photo: "pinkBackdrop", alt: "retrato sobre fondo rosado", page: "album" },
        { title: "Campaña urbana", photo: "streetWoman", alt: "mujer en la calle", page: "album" },
        { title: "Belleza", photo: "brushes", alt: "brochas de maquillaje", page: "album" },
        { title: "Estudio", photo: "whiteDress", alt: "vestido blanco en una escalera", page: "album" },
        { title: "Backstage", photo: "jacketMan", alt: "hombre con chaqueta de cuero", page: "album" },
      ]),
      showcase("Álbumes y perfiles", [
        { title: "Álbum completo", subtitle: "Todas las series en alta resolución", badge: "18 fotos", photo: "milan", alt: "mujer posando frente a una catedral", page: "album" },
        { title: "Perfil y servicios", subtitle: "Experiencia, tarifas y cómo trabajar conmigo", badge: "Book", photo: "portraitWoman", alt: "retrato de mujer", page: "perfil" },
      ]),
      stats([["+300", "sesiones realizadas"], ["9 años", "de trayectoria"], ["48 marcas", "han confiado en mi trabajo"]]),
      testimonials([
        ["Entendió la marca desde la primera reunión. Reseña de ejemplo.", "Directora creativa de ejemplo"],
        ["Las fotos superaron lo que imaginaba. Reseña de ejemplo.", "Modelo de ejemplo"],
      ]),
      engagement(),
      social(["instagram", "tiktok", "youtube"]),
    ],
    pages: [
      {
        slug: "album",
        blocks: [
          header("Portafolio", "Álbum completo", "Una selección de mis series más recientes. Toca una foto para verla a pantalla completa. Fotos de ejemplo: reemplázalas por las tuyas."),
          album("Todas las series", "Filtra por categoría y recorre el álbum.", [
            ["milan", "mujer posando frente a una catedral", "Milán, editorial", "Editorial"],
            ["knitwear", "prendas tejidas en un perchero", "Tejidos de otoño", "Editorial"],
            ["boutique", "perchero de una boutique", "Colección de temporada", "Editorial"],
            ["jumpsuit", "mujer con un mono azul", "Mono turquesa", "Moda"],
            ["whiteDress", "vestido blanco en una escalera", "Vestido blanco", "Moda"],
            ["streetWoman", "mujer caminando por la calle", "Campaña urbana", "Moda"],
            ["jacketMan", "hombre con chaqueta de cuero y gafas", "Chaqueta de cuero", "Moda"],
            ["sunglasses", "mujer con gafas de sol", "Verano", "Moda"],
            ["pinkBackdrop", "retrato sobre fondo rosado", "Rosa", "Retrato"],
            ["portraitWoman", "retrato de mujer", "Luz natural", "Retrato"],
            ["womanBob", "retrato de mujer con corte bob", "Junto al lago", "Retrato"],
            ["manPortrait", "retrato de hombre", "Retrato masculino", "Retrato"],
            ["womanSmile", "mujer sonriendo", "Sonrisa", "Retrato"],
            ["brushes", "brochas de maquillaje", "Brochas", "Belleza"],
            ["treatment", "tratamiento facial", "Cuidado de la piel", "Belleza"],
            ["pinkWall", "mujer frente a un muro rosado", "Muro rosado", "Backstage"],
            ["blueHoodie", "mujer con sudadera azul", "Pausa entre tomas", "Backstage"],
            ["yellowHat", "mujer con sombrero sobre fondo amarillo", "Sombrero", "Backstage"],
          ]),
          link("Ver mi perfil y servicios", "perfil", "Experiencia, tarifas y cómo trabajar conmigo", true),
        ],
      },
      {
        slug: "perfil",
        blocks: [
          header("Perfil", "Hola, soy tu fotógrafo", "Quién soy, cómo trabajo y qué puedes contratarme. Texto de ejemplo."),
          feature("orangePortrait", "retrato de la fotógrafa", "Sobre mí", "Fotografía que cuenta quién eres", "<p>Texto de ejemplo: cuenta tu historia, tu estilo visual y con qué marcas o personas has trabajado.</p><ul><li>Editorial y campañas de moda</li><li>Retrato y book de modelo</li><li>Cobertura de eventos y backstage</li></ul>", "left"),
          stats([["+300", "sesiones"], ["9 años", "de experiencia"], ["5 países", "donde he trabajado"]]),
          steps("Cómo trabajo", [
            ["Conversamos", "Me cuentas la idea, la marca o el uso de las fotos."],
            ["Preparamos", "Definimos locación, vestuario y moodboard."],
            ["Sesión", "Dirigimos la sesión con calma y buen ambiente."],
            ["Entrega", "Recibes una galería privada con tus fotos editadas."],
          ]),
          serviceInfo("Sesión de retrato (ejemplo)", "60 minutos, 15 fotos editadas. Precio de ejemplo.", 90000),
          serviceInfo("Book de modelo (ejemplo)", "Tres looks y entrega en 7 días. Precio de ejemplo.", 180000),
          serviceInfo("Campaña o cobertura de evento (ejemplo)", "Cotización según proyecto. Precio de ejemplo.", 350000),
          faq([
            ["¿En cuánto tiempo entregas las fotos?", "Respuesta de ejemplo: entre 5 y 10 días hábiles, según el proyecto."],
            ["¿Qué derechos de uso incluyen?", "Respuesta de ejemplo: uso personal y en redes; el uso comercial se cotiza aparte."],
            ["¿Viajas para sesiones?", "Respuesta de ejemplo: sí, dentro del país y al extranjero con viáticos."],
          ]),
          whatsapp("Reserva tu sesión", "Hola, quiero reservar una sesión."),
          contactActions(),
          map("Av. Providencia 1234, Providencia, Santiago", "Estudio (ejemplo)", "Sesiones solo con reserva previa."),
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Barbería y belleza
  "belleza-barberia": {
    home: [
      profile("Tu Barbería", "Cortes clásicos y perfilado de barba", `${PROMISE} Tu estilo, tu equipo y tu horario.`, { key: "barber", alt: "barbero afeitando a un cliente" }),
      whatsapp("Reserva tu hora", "Hola, quiero reservar una hora."),
      subscribe(),
      showcase("Todo en un lugar", [
        { title: "Servicios y precios", subtitle: "Cortes, barba y tratamientos", badge: "Desde $12.000", photo: "salon", alt: "sillones de una peluquería", page: "servicios" },
        { title: "Cómo llegar y horarios", subtitle: "Mapa, atención y reservas", photo: "brushes", alt: "brochas y herramientas", page: "contacto" },
      ]),
      stats([["+5.000", "cortes realizados"], ["4,9 / 5", "valoración"], ["6 años", "en el barrio"]]),
      testimonials([["Siempre salgo conforme y puntuales con la hora. Reseña de ejemplo.", "Cliente de ejemplo"]]),
      engagement(),
      social(["instagram", "tiktok"]),
    ],
    pages: [
      {
        slug: "servicios",
        blocks: [
          header("Servicios", "Cortes y cuidado con oficio", "Precios y servicios de ejemplo: ajústalos a los tuyos."),
          service("Corte clásico (ejemplo)", "Lavado, corte y peinado.", 12000, "Reservar"),
          service("Corte y barba (ejemplo)", "El servicio completo con toalla caliente.", 18000, "Reservar"),
          service("Perfilado de barba (ejemplo)", "Diseño y definición con navaja.", 9000, "Reservar"),
          service("Tratamiento capilar (ejemplo)", "Hidratación y masaje.", 15000, "Reservar"),
          album("Nuestro trabajo", "Algunos de los cortes y el ambiente del local.", [
            ["barber", "barbero afeitando", "Afeitado clásico", "Barba"],
            ["salon", "sillones de la peluquería", "El local", "Local"],
            ["manPortrait", "hombre con corte clásico", "Corte clásico", "Cortes"],
            ["manDark", "hombre con barba perfilada", "Barba perfilada", "Barba"],
            ["manSmile", "hombre sonriendo", "Corte moderno", "Cortes"],
            ["jacketMan", "hombre con chaqueta", "Estilo urbano", "Cortes"],
          ]),
        ],
      },
      {
        slug: "contacto",
        blocks: [
          header("Reserva tu hora", "Cómo llegar y cuándo atendemos", "Reserva por WhatsApp o pasa sin hora si hay espacio. Información de ejemplo."),
          whatsapp("Reserva tu hora", "Hola, quiero reservar una hora."),
          map("Av. Providencia 1234, Providencia, Santiago", "Tu Barbería (ejemplo)", "Martes a sábado de 10:00 a 20:00. Estacionamiento en la calle."),
          contactActions(),
          faq([["¿Atienden sin hora?", "Respuesta de ejemplo: sí, según disponibilidad."], ["¿Qué medios de pago aceptan?", "Respuesta de ejemplo: efectivo, débito y transferencia."]]),
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Portada de cuerpo entero
  "portada-minimal": {
    home: [
      profile("Tu Nombre", "Marca personal y asesorías", `${PROMISE} Quién eres, qué haces y cómo trabajar contigo.`, { key: "portraitWoman", alt: "retrato de mujer" }),
      link("Agenda una sesión", "agenda", "Una hora para ordenar tus ideas", true),
      subscribe(),
      showcase("Conóceme", [
        { title: "Mi portafolio", subtitle: "Proyectos y resultados recientes", photo: "office", alt: "espacio de trabajo", page: "portafolio" },
        { title: "Trabajemos juntos", subtitle: "Cómo es una sesión y cómo reservar", photo: "womanSmile", alt: "persona sonriendo", page: "agenda" },
      ]),
      stats([["+80", "proyectos"], ["+500", "horas de asesoría"], ["4,9 / 5", "valoración"]]),
      testimonials([["Muy clara y cercana, salí con un plan concreto. Reseña de ejemplo.", "Clienta de ejemplo"]]),
      engagement(),
      social(["instagram", "tiktok", "linkedin"]),
    ],
    pages: [
      {
        slug: "portafolio",
        blocks: [
          header("Portafolio", "Proyectos y resultados", "Una muestra de mi trabajo reciente. Contenido de ejemplo."),
          album("Proyectos", "Toca una imagen para verla en grande.", [
            ["office", "espacio de trabajo", "Rediseño de marca", "Marca"],
            ["workshop", "taller con notas adhesivas", "Taller de estrategia", "Talleres"],
            ["conference", "mesa de conferencia", "Capacitación", "Talleres"],
            ["meeting", "reunión de trabajo", "Consultoría", "Consultoría"],
            ["city", "ciudad", "Proyecto urbano", "Marca"],
            ["podcast", "grabación de podcast", "Podcast", "Contenido"],
          ], "grid"),
          feature("manSuit2", "profesional en traje", "Mi enfoque", "Estrategia clara, ejecución simple", "<p>Texto de ejemplo: describe tu método y el tipo de resultados que logran tus clientes.</p>", "right", { label: "Agenda una sesión", page: "agenda" }),
          testimonials([["Un antes y un después para mi marca. Reseña de ejemplo.", "Cliente de ejemplo"]]),
          link("Agenda una sesión", "agenda", "Una hora para ordenar tus ideas", true),
        ],
      },
      {
        slug: "agenda",
        blocks: [
          header("Agenda", "Agenda una sesión", "Una hora por videollamada para salir con un plan. Texto de ejemplo."),
          steps("Cómo funciona", [
            ["Reservas", "Elige un horario por WhatsApp."],
            ["Conversamos", "Una hora para revisar tu situación y tus metas."],
            ["Plan de acción", "Recibes por correo un resumen con los próximos pasos."],
          ]),
          serviceInfo("Sesión de asesoría (ejemplo)", "Una hora por videollamada. Precio de ejemplo.", 30000),
          whatsapp("Agenda por WhatsApp", "Hola, quiero agendar una sesión."),
          contactActions(),
          faq([["¿Cómo es la primera sesión?", "Respuesta de ejemplo: conversamos tus objetivos y definimos un plan de trabajo."]]),
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Academia y talleres
  "academia-talleres": {
    home: [
      profile("Tu Academia de Formación", "Cursos prácticos, talleres y formación continua", `${PROMISE} Tu metodología, tus docentes y tus temáticas.`, { key: "workshop", alt: "taller colaborativo" }),
      whatsapp("Consulta sobre talleres", "Hola, me interesa inscribirme en un taller."),
      subscribe(),
      showcase("Aprende con nosotros", [
        { title: "Cursos y talleres", subtitle: "Programa, fechas y valores", badge: "Con certificado", photo: "conference", alt: "sala de clases", page: "cursos" },
        { title: "Inscripción y contacto", subtitle: "Matrícula, convenios y consultas", photo: "meeting", alt: "reunión de equipo", page: "contacto" },
      ]),
      stats([["+2.500", "estudiantes"], ["15", "docentes especialistas"], ["96 %", "recomienda los cursos"]]),
      testimonials([["Excelente taller, contenido directo y muy aplicable. Reseña de ejemplo.", "Estudiante de ejemplo"]]),
      engagement(),
      social(["instagram", "youtube", "linkedin"]),
    ],
    pages: [
      {
        slug: "cursos",
        blocks: [
          header("Cursos", "Formación práctica con certificado", "Programa, fechas y valores de ejemplo."),
          service("Curso inicial (ejemplo)", "Cuatro semanas, clases en vivo y material incluido.", 89000, "Inscribirme"),
          service("Taller intensivo (ejemplo)", "Sesión práctica de 4 horas con certificado.", 45000, "Inscribirme"),
          events("Próximos talleres y charlas", [
            { name: "Taller de iniciación práctica (ejemplo)", start: "2026-11-20T18:30", end: "2026-11-20T21:30", venue: "Campus online y presencial", description: "Aprende las bases con ejercicios guiados.", label: "Asegurar cupo" },
          ]),
          steps("Cómo es un curso", [
            ["Clases en vivo", "Aprendes con ejercicios y feedback del docente."],
            ["Práctica guiada", "Aplicas lo aprendido en un proyecto real."],
            ["Certificado", "Recibes tu certificado al completar las actividades."],
          ]),
          album("Nuestras aulas", "Un espacio pensado para aprender.", [
            ["workshop", "taller con notas adhesivas", "Taller práctico", "Aulas"],
            ["conference", "sala de conferencias", "Clase magistral", "Aulas"],
            ["meeting", "trabajo en equipo", "Trabajo en equipo", "Aulas"],
            ["office", "espacio abierto", "Espacio de estudio", "Aulas"],
          ], "grid"),
          faq([["¿Se entrega certificado?", "Respuesta de ejemplo: sí, al completar todas las actividades."], ["¿Las clases quedan grabadas?", "Respuesta de ejemplo: sí, por 6 meses."]]),
        ],
      },
      {
        slug: "contacto",
        blocks: [
          header("Contacto", "Resolvemos tus dudas", "Inscripción, convenios con empresas y consultas. Texto de ejemplo."),
          whatsapp("Consulta sobre talleres", "Hola, me interesa inscribirme en un taller."),
          contactActions(),
          newsletter("Boletín de novedades", "Fechas de nuevos talleres, guías gratuitas y descuentos exclusivos.", "Recibir recursos"),
          map("Av. Providencia 1234, Santiago", "Sede (ejemplo)", "Clases presenciales con inscripción previa."),
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Fitness y entrenamiento
  "fitness-entrenamiento": {
    home: [
      profile("Tu Espacio de Entrenamiento", "Entrenamiento personalizado, funcional y acondicionamiento físico", `${PROMISE} Tu enfoque deportivo y tus certificaciones.`, { key: "barbell", alt: "persona levantando una barra" }),
      booking("Reserva tu clase de prueba"),
      subscribe(),
      link("Conoce horarios y ubicación", "contacto", "Cuándo abrimos y cómo llegar"),
      showcase("Entrena con nosotros", [
        { title: "Planes y clases", subtitle: "Mensual ilimitado, pases y evaluación", badge: "Clase de prueba", photo: "gym", alt: "sala de pesas", page: "planes" },
        { title: "Horarios y ubicación", subtitle: "Cuándo abrimos y cómo llegar", photo: "bikes", alt: "sala de bicicletas", page: "contacto" },
      ]),
      stats([["+400", "alumnos activos"], ["25", "clases a la semana"], ["6:30", "abrimos temprano"]]),
      testimonials([["Logré mis metas de fuerza en 3 meses con el plan. Reseña de ejemplo.", "Alumno de ejemplo"]]),
      engagement(),
      social(["instagram", "tiktok", "youtube"]),
    ],
    pages: [
      {
        slug: "planes",
        blocks: [
          header("Planes", "Elige cómo quieres entrenar", "Planes y precios de ejemplo."),
          pricing("Planes de entrenamiento", [
            { name: "Plan mensual ilimitado (ejemplo)", price: 39990, period: "month", description: "Acceso total a sala y clases guiadas.", features: ["Acceso ilimitado", "Plan mensual", "Camarines y duchas"], badge: "Recomendado", highlighted: true, cta: "Elegir plan" },
            { name: "Pase 8 clases (ejemplo)", price: 28000, period: "once", description: "Para usar en 45 días.", features: ["8 clases guiadas", "Horario flexible"], cta: "Comprar pase" },
          ]),
          service("Evaluación física inicial (ejemplo)", "Composición corporal, postura y capacidad aeróbica.", 20000, "Agendar evaluación"),
          album("Las instalaciones", "Espacio amplio, equipamiento nuevo y buena energía.", [
            ["gym", "sala de pesas", "Sala de pesas", "Sala"],
            ["barbell", "barra con discos", "Fuerza", "Sala"],
            ["bikes", "sala de bicicletas", "Ciclismo indoor", "Clases"],
            ["exercise", "clase funcional", "Funcional", "Clases"],
            ["pilates", "ejercicio en el suelo", "Pilates", "Clases"],
            ["yoga", "yoga al atardecer", "Yoga", "Clases"],
          ]),
          steps("Cómo empezar", [
            ["Clase de prueba", "Reserva tu primera clase sin costo."],
            ["Evaluación", "Medimos tu punto de partida y definimos metas."],
            ["Tu plan", "Eliges el plan y empiezas con tu programa."],
          ]),
        ],
      },
      {
        slug: "contacto",
        blocks: [
          header("Horarios", "Cuándo y dónde", "Horarios de ejemplo. Reserva tu clase de prueba por WhatsApp."),
          text("<h3>Horario de atención</h3><ul><li>Lunes a viernes: 06:30 a 21:30</li><li>Sábado: 09:00 a 14:00</li><li>Domingo: cerrado</li></ul>"),
          whatsapp("Reserva tu clase de prueba", "Hola, quiero reservar una clase de prueba."),
          map("Av. Providencia 1234, Santiago", "Sede (ejemplo)", "Estacionamiento para bicicletas."),
          contactActions(),
          faq([["¿Necesito experiencia previa?", "Respuesta de ejemplo: no, adaptamos cada clase a tu nivel."]]),
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Músico y banda
  "musico-banda": {
    home: [
      profile("Tu Proyecto Musical", "Música original, presentaciones en vivo y lanzamientos", `${PROMISE} Tu estilo sonoro y tus próximos proyectos.`, { key: "concertOrange", alt: "concierto con luces naranjas" }),
      link("Escucha nuestro nuevo álbum", "musica", "Disponible en Spotify, Apple Music y todas las plataformas", true),
      subscribe(),
      showcase("Nuestra música", [
        { title: "Música, videos y fechas", subtitle: "Escucha, mira y encuentra el próximo show", badge: "Nuevo álbum", photo: "concert", alt: "concierto en vivo", page: "musica" },
        { title: "Contrataciones", subtitle: "Shows, eventos privados y prensa", photo: "guitars", alt: "guitarras", page: "contacto" },
      ]),
      stats([["+60", "shows en vivo"], ["+1 M", "reproducciones"], ["3", "discos publicados"]]),
      engagement(),
      social(["spotify", "youtube", "instagram", "tiktok"]),
    ],
    pages: [
      {
        slug: "musica",
        blocks: [
          header("Música", "Nuestro nuevo álbum", "Escucha, mira el videoclip y encuentra el próximo show. Contenido de ejemplo."),
          music("Sencillo promocional (ejemplo)"),
          video("Videoclip oficial (ejemplo)"),
          events("Próximas tocatas", [
            { name: "Lanzamiento oficial en vivo (ejemplo)", start: "2026-12-05T21:00", end: "2026-12-05T23:30", venue: "Sala de conciertos (ejemplo)", description: "Show completo con banda invitada.", label: "Comprar entrada" },
          ]),
          link("Contrata una presentación", "contacto", "Shows, eventos privados y prensa", true),
          album("En vivo y en el estudio", "Fotos de shows y de la grabación.", [
            ["concert", "concierto con luces", "En vivo", "Shows"],
            ["concertOrange", "público en un concierto", "Gira", "Shows"],
            ["crowd", "multitud cantando", "El público", "Shows"],
            ["performer", "artista entre humo", "Escenario", "Shows"],
            ["guitars", "guitarras en el estudio", "Estudio", "Estudio"],
            ["microphone", "micrófono de estudio", "Grabación", "Estudio"],
          ]),
        ],
      },
      {
        slug: "contacto",
        blocks: [
          header("Contrataciones", "Llévanos a tu evento", "Shows, eventos privados, prensa y colaboraciones. Texto de ejemplo."),
          steps("Cómo contratarnos", [
            ["Escríbenos", "Fecha, lugar y tipo de evento."],
            ["Propuesta", "Te enviamos formato, rider técnico y valores."],
            ["Confirmamos", "Con una seña quedamos agendados."],
          ]),
          whatsapp("Escríbenos por WhatsApp", "Hola, quiero contratar una presentación."),
          contactActions(),
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Restaurante con menú
  "restaurante-menu": {
    home: [
      profile("Tu Restaurante de Autor", "Cocina de temporada, pescados frescos y coctelería de autor", `${PROMISE} Tu propuesta culinaria y horarios de cocina.`, { key: "restaurant", alt: "salón de un restaurante" }),
      whatsapp("Reserva tu mesa por WhatsApp", "Hola, quiero reservar una mesa para cenar."),
      subscribe(),
      showcase("Una experiencia completa", [
        { title: "La carta", subtitle: "Entradas, fondos, postres y coctelería", badge: "Menú de temporada", photo: "dishes", alt: "platos de autor", page: "carta" },
        { title: "Reservas y ubicación", subtitle: "Mesa para dos, grupos y eventos privados", photo: "terrace", alt: "terraza del restaurante", page: "reservas" },
      ]),
      stats([["12", "años de cocina"], ["+80", "etiquetas de vino"], ["4,8 / 5", "valoración de comensales"]]),
      testimonials([["Un servicio impecable y platos para recordar. Reseña de ejemplo.", "Comensal de ejemplo"]]),
      engagement(),
      social(["instagram", "facebook", "tiktok"]),
    ],
    pages: [
      {
        slug: "carta",
        blocks: [
          header("La carta", "Cocina de temporada", "Platos y precios de ejemplo: reemplázalos por los tuyos."),
          block("catalog", { label: "Ver carta y menú completo" }),
          service("Menú degustación 5 tiempos (ejemplo)", "Maridaje de vinos incluido, con 24 horas de anticipación.", 48000, "Reservar", "reservas"),
          service("Plato de autor (ejemplo)", "Producto de temporada con guarnición.", 16500, "Reservar", "reservas"),
          service("Postre de la casa (ejemplo)", "Elaboración propia.", 6500, "Reservar", "reservas"),
          album("En la mesa", "Platos y ambiente del salón.", [
            ["dishes", "platos servidos", "Entradas", "Platos"],
            ["plate", "plato de carne con ensalada", "Fondos", "Platos"],
            ["bar", "barra del restaurante", "Coctelería", "Barra"],
            ["restaurant", "salón del restaurante", "El salón", "Ambiente"],
            ["terrace", "terraza", "Terraza", "Ambiente"],
            ["diners", "comensales en la mesa", "Celebraciones", "Ambiente"],
          ]),
        ],
      },
      {
        slug: "reservas",
        blocks: [
          header("Reservas", "Reserva tu mesa", "Escríbenos con día, hora y número de personas. Información de ejemplo."),
          whatsapp("Reserva tu mesa por WhatsApp", "Hola, quiero reservar una mesa para cenar."),
          map("Av. Italia 1450, Barrio Italia, Providencia, Santiago", "Ubicación del local", "Estacionamiento disponible en calles aledañas."),
          steps("Cómo reservar", [
            ["Escríbenos", "Indica fecha, hora y cuántas personas serán."],
            ["Confirmamos", "Te respondemos el mismo día."],
            ["Disfruta", "Tu mesa te espera a la hora acordada."],
          ]),
          faq([["¿Aceptan reservas para grupos?", "Respuesta de ejemplo: sí, desde 8 personas con 48 horas de anticipación."], ["¿Tienen opciones vegetarianas?", "Respuesta de ejemplo: sí, consulta por el menú del día."]]),
          contactActions(),
        ],
      },
    ],
  },
};
