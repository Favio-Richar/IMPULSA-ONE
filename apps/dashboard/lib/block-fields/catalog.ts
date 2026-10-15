import { DEFAULT_BOOKING_TIME_ZONE, SITE_TIME_ZONES, SOCIAL_NETWORK_LABELS, SOCIAL_NETWORKS, type BlockType } from "@impulza/validation";
import type { BlockFieldSet, FieldDescriptor } from "./types.js";

const SOCIAL_NETWORK_OPTIONS = SOCIAL_NETWORKS.map((network) => ({ value: network, label: SOCIAL_NETWORK_LABELS[network] }));

const ALIGNMENT_OPTIONS = [
  { value: "left", label: "Izquierda" },
  { value: "center", label: "Centro" },
  { value: "right", label: "Derecha" },
] as const;

const imageField = (name: string, label: string, optional = true, aspect?: "square" | "wide"): FieldDescriptor => ({
  name,
  label,
  optional,
  control: { kind: "image", aspect },
});

const ctaField: FieldDescriptor = {
  name: "cta",
  label: "Botón de acción",
  optional: true,
  control: {
    kind: "group",
    fields: [
      { name: "label", label: "Texto del botón", control: { kind: "text", maxLength: 60 } },
      { name: "url", label: "Enlace", control: { kind: "link" } },
    ],
  },
};

const TIME_ZONE_FIELD: FieldDescriptor = {
  name: "timeZone",
  label: "Zona horaria",
  helperText: "La hora que escribas es la de esta zona; cada visitante ve la cuenta desde donde esté.",
  control: { kind: "select", options: SITE_TIME_ZONES },
};

/** Fecha y hora de pared dentro de `days` días, a las `hour`, en la zona dada (para sembrar un bloque). */
export function localDateTimeInDays(days: number, hour: number, timeZone: string = DEFAULT_BOOKING_TIME_ZONE, from = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(from.getTime() + days * 86_400_000),
  );
  return `${day}T${String(hour).padStart(2, "0")}:00`;
}

const ctaGroup = (label = "Botón"): FieldDescriptor => ({
  name: "cta",
  label,
  optional: true,
  control: {
    kind: "group",
    fields: [
      { name: "label", label: "Texto del botón", control: { kind: "text", maxLength: 60 } },
      { name: "url", label: "Enlace", control: { kind: "link" } },
    ],
  },
});

/**
 * Un descriptor por tipo del catálogo (`BLOCK_TYPES`, `@impulza/validation`) — la validación real
 * la sigue haciendo el mismo schema Zod de siempre (`zodResolver`), esto solo pinta el control. Los
 * tipos con un comentario "pendiente" no tienen descriptor todavía: agregar bloques de ese tipo
 * queda para una etapa siguiente (mismo motor, sin nada nuevo que diseñar) — no rompe nada, la
 * biblioteca del editor simplemente no ofrece ese tipo todavía.
 */
export const BLOCK_FIELD_SETS: Partial<Record<BlockType, BlockFieldSet>> = {
  profile: {
    fields: [
      { name: "name", label: "Nombre", control: { kind: "text", maxLength: 120 } },
      { name: "headline", label: "Frase corta", optional: true, control: { kind: "text", maxLength: 160 } },
      { name: "bio", label: "Biografía", optional: true, control: { kind: "richtext" } },
      imageField("avatar", "Foto de perfil", true, "square"),
      imageField("cover", "Portada", true, "wide"),
      // PL7: portada de cuerpo entero (sin foto redonda), como la referencia que eligió Favio.
      {
        name: "layout",
        label: "Diseño de la cabecera",
        helperText:
          "«Portada de cuerpo entero» usa la portada como foto principal. «Banner» deja la portada ancha arriba y tu foto más chica en la esquina, con el texto a la izquierda. «Recorte» muestra tu foto en un recorte vertical con las esquinas del estilo de tu tema.",
        control: {
          kind: "select",
          options: [
            { value: "avatar", label: "Foto redonda sobre la portada" },
            { value: "hero", label: "Portada de cuerpo entero" },
            { value: "banner", label: "Banner con foto en la esquina" },
            { value: "cutout", label: "Recorte con esquinas del tema" },
          ],
        },
      },
      { name: "verified", label: "Cuenta verificada", control: { kind: "boolean" } },
      // PL8: compartir la página completa desde la cabecera.
      { name: "shareButton", label: "Mostrar botón para compartir la página", optional: true, control: { kind: "boolean" } },
      {
        name: "socials",
        label: "Redes bajo la biografía",
        optional: true,
        control: {
          kind: "array",
          min: 0,
          max: 8,
          itemLabel: "Red",
          fields: [
            { name: "network", label: "Red", control: { kind: "select", options: SOCIAL_NETWORK_OPTIONS } },
            { name: "url", label: "Enlace", control: { kind: "url" } },
          ],
        },
      },
    ],
    seedConfig: () => ({ name: "Tu nombre", verified: false }),
  },

  hero: {
    fields: [
      { name: "title", label: "Título", control: { kind: "text", maxLength: 160 } },
      { name: "subtitle", label: "Subtítulo", optional: true, control: { kind: "text", maxLength: 300 } },
      imageField("background", "Imagen de fondo", true, "wide"),
      { name: "alignment", label: "Alineación", control: { kind: "select", options: ALIGNMENT_OPTIONS } },
      ctaField,
    ],
    seedConfig: () => ({ title: "Título llamativo", alignment: "left" }),
  },

  text: {
    fields: [
      { name: "html", label: "Texto", control: { kind: "richtext" } },
      { name: "alignment", label: "Alineación", control: { kind: "select", options: ALIGNMENT_OPTIONS } },
    ],
    seedConfig: () => ({ html: "<p>Escribe acá.</p>", alignment: "left" }),
  },

  link: {
    fields: [
      { name: "label", label: "Título", control: { kind: "text", maxLength: 80 } },
      {
        name: "url",
        label: "Enlace",
        helperText: "Elige una página de tu portal o pega el enlace de tu red, tu web, tu tienda o lo que quieras mostrar.",
        control: { kind: "link" },
      },
      { name: "description", label: "Descripción", optional: true, control: { kind: "text", maxLength: 160 } },
      {
        name: "style",
        label: "Estilo",
        control: {
          kind: "select",
          options: [
            { value: "primary", label: "Primario" },
            { value: "secondary", label: "Secundario" },
            { value: "outline", label: "Contorno" },
          ],
        },
      },
      {
        name: "icon",
        label: "Ícono",
        optional: true,
        helperText: "Si lo dejas vacío, se usa el logo de la plataforma del enlace (Instagram, TikTok, YouTube…).",
        control: { kind: "select", options: SOCIAL_NETWORK_OPTIONS },
      },
      // PL8: compartir este enlace desde la página.
      { name: "shareable", label: "Mostrar botón para compartir este enlace", optional: true, control: { kind: "boolean" } },
    ],
    seedConfig: () => ({ label: "Mi enlace", url: "https://ejemplo.com", style: "primary" }),
  },

  social: {
    fields: [
      {
        name: "links",
        label: "Redes",
        control: {
          kind: "array",
          min: 1,
          max: 12,
          itemLabel: "Red",
          fields: [
            { name: "network", label: "Red", control: { kind: "select", options: SOCIAL_NETWORK_OPTIONS } },
            { name: "url", label: "Enlace", control: { kind: "url" } },
          ],
        },
      },
      {
        name: "style",
        label: "Estilo",
        control: {
          kind: "select",
          options: [
            { value: "buttons", label: "Botones" },
            { value: "icons", label: "Íconos" },
          ],
        },
      },
    ],
    seedConfig: () => ({ links: [{ network: "instagram", url: "https://instagram.com/tu-usuario" }], style: "buttons" }),
  },

  image: {
    fields: [
      imageField("image", "Imagen", false),
      { name: "caption", label: "Leyenda", optional: true, control: { kind: "text", maxLength: 300 } },
      { name: "link", label: "Enlace al hacer clic", optional: true, control: { kind: "link" } },
    ],
    seedConfig: () => ({ image: { url: "https://ejemplo.com/imagen.jpg", alt: "Descripción de la imagen" } }),
  },

  whatsapp: {
    fields: [
      { name: "phone", label: "Teléfono (formato internacional)", control: { kind: "phone" } },
      // Opcional aunque siempre viene con un valor sembrado: el schema tiene su propio
      // `.default(...)` (F2.4) — si el usuario borra el campo del todo, mejor que se aplique ese
      // valor por defecto en el servidor a que el autoguardado falle por texto vacío.
      { name: "label", label: "Texto del botón", optional: true, control: { kind: "text", maxLength: 60 } },
      {
        name: "prefilledMessage",
        label: "Mensaje precargado",
        optional: true,
        control: { kind: "text", maxLength: 500 },
      },
    ],
    seedConfig: () => ({ phone: "+56900000000", label: "Escríbenos por WhatsApp" }),
  },

  contact_actions: {
    fields: [
      { name: "email", label: "Correo", optional: true, control: { kind: "email" } },
      { name: "phone", label: "Teléfono", optional: true, control: { kind: "phone" } },
      { name: "emailLabel", label: "Texto del botón de correo", optional: true, control: { kind: "text", maxLength: 60 } },
      { name: "phoneLabel", label: "Texto del botón de teléfono", optional: true, control: { kind: "text", maxLength: 60 } },
    ],
    seedConfig: () => ({ email: "contacto@tu-negocio.com" }),
  },

  divider: {
    fields: [
      {
        name: "style",
        label: "Estilo",
        control: {
          kind: "select",
          options: [
            { value: "line", label: "Línea" },
            { value: "space", label: "Espacio" },
          ],
        },
      },
      {
        name: "size",
        label: "Tamaño",
        control: {
          kind: "select",
          options: [
            { value: "sm", label: "Pequeño" },
            { value: "md", label: "Mediano" },
            { value: "lg", label: "Grande" },
          ],
        },
      },
    ],
    seedConfig: () => ({ style: "line", size: "md" }),
  },

  gallery: {
    fields: [
      {
        name: "images",
        label: "Imágenes",
        control: {
          kind: "array",
          min: 1,
          max: 24,
          itemLabel: "Imagen",
          itemKind: "image",
          bulkAdd: { imageKey: null },
          fields: [
            { name: "url", label: "URL de la imagen", control: { kind: "url" } },
            { name: "alt", label: "Texto alternativo", control: { kind: "text", maxLength: 300 } },
            { name: "decorative", label: "Es decorativa (sin información propia)", control: { kind: "boolean" } },
          ],
        },
      },
      {
        name: "layout",
        label: "Diseño",
        control: {
          kind: "select",
          options: [
            { value: "grid", label: "Cuadrícula" },
            { value: "carousel", label: "Carrusel" },
          ],
        },
      },
    ],
    seedConfig: () => ({
      images: [{ url: "https://ejemplo.com/imagen.jpg", alt: "Descripción de la imagen" }],
      layout: "grid",
    }),
  },

  // Rueda de trabajos: un portafolio que gira. Las piezas (imagen, nombre y enlace opcional) las administra el negocio.
  works_wheel: {
    fields: [
      {
        name: "label",
        label: "Título de la rueda",
        helperText: "Va al centro del anillo. Por ejemplo «Mis trabajos» o «Portafolio 2026».",
        control: { kind: "text", maxLength: 40 },
      },
      {
        name: "items",
        label: "Piezas",
        helperText: "Mínimo 3, máximo 16. Usa imágenes horizontales de buena calidad: se muestran en formato 3:2.",
        control: {
          kind: "array",
          min: 3,
          max: 16,
          itemLabel: "Pieza",
          fields: [
            { name: "title", label: "Nombre", control: { kind: "text", maxLength: 60 } },
            imageField("image", "Imagen", false, "wide"),
            { name: "link", label: "Enlace al tocarla", optional: true, helperText: "Opcional: una página de tu portal (álbum, perfil, servicios…) o un enlace externo.", control: { kind: "link" } },
          ],
        },
      },
      {
        name: "actionLabel",
        label: "Texto del enlace (para lectores de pantalla)",
        optional: true,
        helperText: "Si lo dejas vacío: «Ver».",
        control: { kind: "text", maxLength: 24 },
      },
    ],
    seedConfig: () => ({
      label: "Mis trabajos",
      actionLabel: "Ver",
      items: [1, 2, 3, 4].map((n) => ({
        title: `Trabajo ${n}`,
        image: { url: `https://ejemplo.com/trabajo-${n}.jpg`, alt: `Imagen del trabajo ${n}` },
      })),
    }),
  },

  // Cinta de texto en movimiento: palabras que se desplazan sin parar. Solo texto plano.
  marquee: {
    fields: [
      {
        name: "items",
        label: "Textos (uno por línea)",
        helperText: "Palabras cortas o frases: «Fotografía», «Moda», «Editorial»… Mínimo 2. Se repiten en bucle.",
        control: { kind: "lines", maxItems: 12, maxLength: 40 },
      },
      {
        name: "speed",
        label: "Velocidad",
        control: {
          kind: "select",
          options: [
            { value: "slow", label: "Lenta" },
            { value: "normal", label: "Normal" },
            { value: "fast", label: "Rápida" },
          ],
        },
      },
    ],
    seedConfig: () => ({ items: ["Fotografía", "Moda", "Editorial"], speed: "normal" }),
  },

  // Álbum profesional: fotos con título y categoría, filtros y visor a pantalla completa.
  album: {
    fields: [
      { name: "title", label: "Título del álbum", optional: true, control: { kind: "text", maxLength: 80 } },
      { name: "description", label: "Descripción", optional: true, control: { kind: "text", maxLength: 300 } },
      {
        name: "layout",
        label: "Diseño",
        control: {
          kind: "select",
          options: [
            { value: "masonry", label: "Mosaico (respeta la forma de cada foto)" },
            { value: "grid", label: "Cuadrícula (todas cuadradas)" },
          ],
        },
      },
      { name: "showFilters", label: "Mostrar filtros por categoría", control: { kind: "boolean" } },
      {
        name: "photos",
        label: "Fotos",
        helperText: "Hasta 60. Pon la misma categoría a varias fotos para que se puedan filtrar. El visitante las abre a pantalla completa.",
        control: {
          kind: "array",
          min: 1,
          max: 60,
          itemLabel: "Foto",
          bulkAdd: { imageKey: "image" },
          fields: [
            imageField("image", "Foto", false, "wide"),
            { name: "title", label: "Título", optional: true, control: { kind: "text", maxLength: 80 } },
            { name: "category", label: "Categoría", optional: true, helperText: "Por ejemplo «Retrato» o «Editorial».", control: { kind: "text", maxLength: 30 } },
          ],
        },
      },
    ],
    seedConfig: () => ({
      layout: "masonry",
      showFilters: true,
      photos: [1, 2, 3].map((n) => ({ image: { url: `https://ejemplo.com/foto-${n}.jpg`, alt: `Foto ${n}` }, title: `Foto ${n}`, category: "Serie 1" })),
    }),
  },

  // Encabezado de página interna.
  page_header: {
    fields: [
      { name: "eyebrow", label: "Rótulo superior", optional: true, helperText: "Una o dos palabras en mayúsculas: «Portafolio», «Sobre mí».", control: { kind: "text", maxLength: 40 } },
      { name: "title", label: "Título", control: { kind: "text", maxLength: 100 } },
      { name: "subtitle", label: "Bajada", optional: true, control: { kind: "text", maxLength: 300 } },
    ],
    seedConfig: () => ({ eyebrow: "Portafolio", title: "Título de la página", subtitle: "Una frase que explique de qué trata esta página." }),
  },

  // Cifras destacadas.
  stats: {
    fields: [
      { name: "title", label: "Título", optional: true, control: { kind: "text", maxLength: 80 } },
      {
        name: "items",
        label: "Cifras",
        helperText: "De 2 a 4. Por ejemplo «+250» y «sesiones realizadas».",
        control: {
          kind: "array",
          min: 2,
          max: 4,
          itemLabel: "Cifra",
          fields: [
            { name: "value", label: "Valor", control: { kind: "text", maxLength: 14 } },
            { name: "label", label: "Descripción", control: { kind: "text", maxLength: 40 } },
          ],
        },
      },
    ],
    seedConfig: () => ({ items: [{ value: "+100", label: "clientes felices" }, { value: "8", label: "años de experiencia" }, { value: "24 h", label: "tiempo de respuesta" }] }),
  },

  // Pasos numerados.
  steps: {
    fields: [
      { name: "title", label: "Título", optional: true, control: { kind: "text", maxLength: 80 } },
      {
        name: "items",
        label: "Pasos",
        helperText: "De 2 a 6, en orden.",
        control: {
          kind: "array",
          min: 2,
          max: 6,
          itemLabel: "Paso",
          fields: [
            { name: "title", label: "Título del paso", control: { kind: "text", maxLength: 60 } },
            { name: "description", label: "Descripción", control: { kind: "text", maxLength: 240 } },
          ],
        },
      },
    ],
    seedConfig: () => ({
      title: "Cómo trabajamos",
      items: [
        { title: "Conversamos", description: "Me cuentas qué necesitas y vemos si soy la persona indicada." },
        { title: "Planificamos", description: "Definimos fecha, lugar y alcance con un presupuesto claro." },
        { title: "Entrego", description: "Recibes el resultado final en el plazo acordado." },
      ],
    }),
  },

  // Imagen y texto.
  feature: {
    fields: [
      imageField("image", "Imagen", false, "square"),
      {
        name: "imagePosition",
        label: "Posición de la imagen",
        control: {
          kind: "select",
          options: [
            { value: "left", label: "A la izquierda" },
            { value: "right", label: "A la derecha" },
          ],
        },
      },
      { name: "eyebrow", label: "Rótulo superior", optional: true, control: { kind: "text", maxLength: 40 } },
      { name: "title", label: "Título", control: { kind: "text", maxLength: 100 } },
      { name: "text", label: "Texto", control: { kind: "richtext" } },
      ctaField,
    ],
    seedConfig: () => ({
      image: { url: "https://ejemplo.com/imagen.jpg", alt: "Descripción de la imagen" },
      imagePosition: "left",
      eyebrow: "Sobre mí",
      title: "Mi historia",
      text: "<p>Cuenta aquí quién eres, cómo trabajas y qué te hace distinto.</p>",
    }),
  },

  // Vistas y «me gusta»: las cifras las pone el servidor; acá solo se elige qué mostrar.
  engagement: {
    fields: [
      { name: "showViews", label: "Mostrar cuántas veces se vio la página", control: { kind: "boolean" } },
      { name: "showLikes", label: "Mostrar el botón «Me gusta»", control: { kind: "boolean" } },
      { name: "likeLabel", label: "Texto del botón", optional: true, helperText: "Si lo dejas vacío: «Me gusta».", control: { kind: "text", maxLength: 24 } },
    ],
    seedConfig: () => ({ showViews: true, showLikes: true, likeLabel: "Me gusta" }),
  },

  // Colecciones: tarjetas grandes con portada que llevan al álbum, la galería, la web o a otro perfil.
  showcase: {
    fields: [
      { name: "title", label: "Título de la sección", optional: true, control: { kind: "text", maxLength: 80 } },
      {
        name: "layout",
        label: "Diseño",
        control: {
          kind: "select",
          options: [
            { value: "stack", label: "Una tarjeta por fila (ancha)" },
            { value: "grid", label: "Dos por fila (en pantallas medianas)" },
          ],
        },
      },
      {
        name: "items",
        label: "Colecciones",
        helperText: "Cada una lleva a donde quieras: tu página web, un álbum completo u otro perfil biográfico tuyo.",
        control: {
          kind: "array",
          min: 1,
          max: 12,
          itemLabel: "Colección",
          fields: [
            { name: "title", label: "Título", control: { kind: "text", maxLength: 60 } },
            { name: "subtitle", label: "Subtítulo", optional: true, control: { kind: "text", maxLength: 100 } },
            { name: "badge", label: "Insignia", optional: true, helperText: "Por ejemplo «24 fotos» o «Nuevo».", control: { kind: "text", maxLength: 24 } },
            imageField("image", "Portada", false, "wide"),
            { name: "link", label: "Enlace", helperText: "Elige la página de tu portal a donde lleva (álbum, perfil, servicios…) o pega una dirección con https://.", control: { kind: "link" } },
          ],
        },
      },
      { name: "actionLabel", label: "Texto de la flecha", optional: true, helperText: "Si lo dejas vacío: «Ver».", control: { kind: "text", maxLength: 24 } },
    ],
    seedConfig: () => ({
      layout: "stack",
      actionLabel: "Ver",
      items: [
        { title: "Colección de ejemplo", subtitle: "Escribe aquí de qué trata", image: { url: "https://ejemplo.com/coleccion-1.jpg", alt: "Portada de la colección" }, link: "https://ejemplo.com/coleccion-1" },
      ],
    }),
  },

  video: {
    fields: [
      { name: "video", label: "Video", control: { kind: "video" } },
      { name: "title", label: "Título", optional: true, control: { kind: "text", maxLength: 160 } },
    ],
    // Id con formato válido pero sin un video real detrás — sembrar un video de YouTube/Vimeo
    // real y ajeno sería publicar contenido de otra persona sin que el usuario lo haya elegido.
    seedConfig: () => ({ video: { provider: "youtube", videoId: "000000000AA" } }),
  },

  // F3.2: el formulario en sí (campos, envíos, antispam) ya no vive en la config del bloque — se
  // elige un `Form` real por id. Ese selector no es un campo genérico del motor declarativo (no
  // es texto/número/opción fija: depende de una lista que hay que pedirle a la API para el sitio
  // en cuestión), así que `BlockConfigPanel` lo agrega aparte para este tipo
  // (`ContactFormPicker.tsx`) — acá solo queda el título, que sí es un campo simple de verdad.
  contact_form: {
    fields: [{ name: "title", label: "Título", optional: true, control: { kind: "text", maxLength: 160 } }],
    seedConfig: () => ({}),
  },

  // F5.2: botón de la pila que abre el flujo de reserva. Horario y servicios se configuran en
  // Sitios → Reservas; acá solo el texto del botón.
  booking: {
    fields: [
      {
        name: "label",
        label: "Texto del botón",
        helperText: "Tus horarios y servicios se configuran en el sitio, sección Reservas.",
        control: { kind: "text", maxLength: 80 },
      },
    ],
    seedConfig: () => ({ label: "Reservar hora" }),
  },

  // F5.5: cada producto activo del sitio es un botón de la pila que despliega su pedido. Los
  // productos se administran en Sitios → Catálogo; acá solo el nombre de la tienda (se anuncia a
  // los lectores de pantalla como el título de la lista).
  catalog: {
    fields: [
      {
        name: "label",
        label: "Nombre de la tienda",
        helperText: "Cada producto activo aparece como un botón. Tus productos se administran en el sitio, sección Catálogo.",
        control: { kind: "text", maxLength: 80 },
      },
    ],
    seedConfig: () => ({ label: "Tienda" }),
  },

  service: {
    fields: [
      { name: "name", label: "Nombre", control: { kind: "text", maxLength: 120 } },
      { name: "description", label: "Descripción", optional: true, control: { kind: "richtext" } },
      imageField("image", "Imagen"),
      {
        name: "priceAmount",
        label: "Precio",
        optional: true,
        helperText: "Sin decimales, en la unidad mínima de la moneda: pesos en CLP (12900 = $12.900), centavos en USD (1999 = US$19,99).",
        control: { kind: "number", min: 0 },
      },
      { name: "priceCurrency", label: "Moneda (código de 3 letras, ej. USD)", optional: true, control: { kind: "text", maxLength: 3 } },
      ctaField,
    ],
    seedConfig: () => ({ name: "Nombre del servicio" }),
  },

  faq: {
    fields: [
      { name: "title", label: "Título", optional: true, control: { kind: "text", maxLength: 160 } },
      {
        name: "items",
        label: "Preguntas",
        control: {
          kind: "array",
          min: 1,
          max: 30,
          itemLabel: "Pregunta",
          fields: [
            { name: "question", label: "Pregunta", control: { kind: "text", maxLength: 300 } },
            { name: "answer", label: "Respuesta", control: { kind: "richtext" } },
          ],
        },
      },
    ],
    seedConfig: () => ({
      items: [{ question: "¿Cómo puedo contactarlos?", answer: "<p>Escribe tu respuesta acá.</p>" }],
    }),
  },

  testimonials: {
    fields: [
      { name: "title", label: "Título", optional: true, control: { kind: "text", maxLength: 160 } },
      {
        name: "items",
        label: "Testimonios",
        control: {
          kind: "array",
          min: 1,
          max: 30,
          itemLabel: "Testimonio",
          fields: [
            { name: "quote", label: "Cita", control: { kind: "text", maxLength: 800 } },
            { name: "author", label: "Autor", control: { kind: "text", maxLength: 120 } },
            { name: "role", label: "Cargo", optional: true, control: { kind: "text", maxLength: 120 } },
            imageField("avatar", "Foto", true, "square"),
            { name: "rating", label: "Calificación (1 a 5)", optional: true, control: { kind: "number", min: 1, max: 5 } },
          ],
        },
      },
      // PL6: la página muestra las reseñas como una insignia ("★ 4,9 · 128 reseñas").
      {
        name: "ratingAverage",
        label: "Calificación promedio",
        optional: true,
        helperText: "La de tu perfil en Google u otra plataforma, p. ej. 4.9. Si la dejas vacía, se calcula de los testimonios.",
        control: { kind: "number", min: 1, max: 5, step: 0.1 },
      },
      {
        name: "reviewCount",
        label: "Cantidad de reseñas",
        optional: true,
        helperText: "Si la dejas vacía, se cuentan los testimonios de este bloque.",
        control: { kind: "number", min: 1 },
      },
      {
        name: "reviewsUrl",
        label: "Enlace a tus reseñas",
        optional: true,
        helperText: "Google, Instagram u otra. Si no pones uno, al tocar la insignia se despliegan los testimonios.",
        control: { kind: "url" },
      },
    ],
    seedConfig: () => ({
      items: [{ quote: "Un testimonio real de un cliente.", author: "Nombre del cliente" }],
    }),
  },

  // --- F7.3 (ADR-018) ---------------------------------------------------------------------------

  countdown: {
    fields: [
      { name: "title", label: "Título", optional: true, control: { kind: "text", maxLength: 120 } },
      { name: "target", label: "Termina el", control: { kind: "datetime" } },
      TIME_ZONE_FIELD,
      {
        name: "endedBehavior",
        label: "Al terminar",
        control: {
          kind: "select",
          options: [
            { value: "message", label: "Mostrar un mensaje" },
            { value: "hide", label: "Ocultar el bloque" },
          ],
        },
      },
      {
        name: "endedMessage",
        label: "Mensaje al terminar",
        optional: true,
        helperText: "Si lo dejas vacío: «¡Ya comenzó!».",
        control: { kind: "text", maxLength: 200 },
      },
      ctaGroup(),
    ],
    seedConfig: () => ({ title: "Lanzamiento", target: localDateTimeInDays(7, 20), timeZone: DEFAULT_BOOKING_TIME_ZONE, endedBehavior: "message" }),
  },

  pricing: {
    fields: [
      { name: "title", label: "Título", optional: true, control: { kind: "text", maxLength: 120 } },
      {
        name: "plans",
        label: "Planes",
        control: {
          kind: "array",
          min: 1,
          max: 4,
          itemLabel: "Plan",
          fields: [
            { name: "name", label: "Nombre", control: { kind: "text", maxLength: 80 } },
            {
              name: "priceAmount",
              label: "Precio",
              helperText: "Sin decimales, en la unidad mínima de la moneda: pesos en CLP (12990 = $12.990), centavos en USD (1999 = US$19,99).",
              control: { kind: "number", min: 0 },
            },
            { name: "priceCurrency", label: "Moneda (código de 3 letras)", control: { kind: "text", maxLength: 3 } },
            {
              name: "period",
              label: "Cobro",
              control: {
                kind: "select",
                options: [
                  { value: "once", label: "Pago único" },
                  { value: "month", label: "Mensual" },
                  { value: "year", label: "Anual" },
                ],
              },
            },
            { name: "description", label: "Descripción", optional: true, control: { kind: "text", maxLength: 200 } },
            { name: "features", label: "Qué incluye", optional: true, control: { kind: "lines", maxItems: 12, maxLength: 120 } },
            { name: "badge", label: "Insignia", optional: true, helperText: "Por ejemplo «Más elegido».", control: { kind: "text", maxLength: 30 } },
            { name: "highlighted", label: "Destacar este plan", control: { kind: "boolean" } },
            ctaGroup(),
          ],
        },
      },
    ],
    seedConfig: () => ({
      title: "Planes",
      plans: [
        { name: "Básico", priceAmount: 19990, priceCurrency: "CLP", period: "month", features: ["Una sesión al mes", "Soporte por correo"], highlighted: false },
        {
          name: "Completo",
          priceAmount: 39990,
          priceCurrency: "CLP",
          period: "month",
          features: ["Cuatro sesiones al mes", "Soporte por WhatsApp"],
          badge: "Más elegido",
          highlighted: true,
        },
      ],
    }),
  },

  map: {
    fields: [
      { name: "name", label: "Nombre del lugar", optional: true, control: { kind: "text", maxLength: 120 } },
      {
        name: "address",
        label: "Dirección",
        helperText: "Como la buscarías en Google Maps: calle, número y ciudad.",
        control: { kind: "text", maxLength: 300 },
      },
      {
        name: "note",
        label: "Indicación",
        optional: true,
        helperText: "Por ejemplo «Estacionamiento en el subterráneo».",
        control: { kind: "text", maxLength: 200 },
      },
      { name: "showMap", label: "Ofrecer «Ver mapa» (Google Maps se carga solo si el visitante lo pide)", control: { kind: "boolean" } },
    ],
    seedConfig: () => ({ address: "Av. Providencia 1234, Providencia, Santiago", showMap: true }),
  },

  music: {
    fields: [
      { name: "music", label: "Canción, álbum o lista", control: { kind: "music" } },
      { name: "title", label: "Título", optional: true, control: { kind: "text", maxLength: 160 } },
    ],
    // Id con formato válido pero sin música real detrás — igual que el video: sembrar una canción
    // ajena sería publicar contenido de otra persona sin que el usuario la haya elegido.
    seedConfig: () => ({ music: { provider: "spotify", kind: "track", id: "0000000000000000000000" } }),
  },

  events: {
    fields: [
      { name: "title", label: "Título", optional: true, control: { kind: "text", maxLength: 120 } },
      { ...TIME_ZONE_FIELD, helperText: "Las fechas de abajo son en esta zona." },
      {
        name: "items",
        label: "Fechas",
        control: {
          kind: "array",
          min: 1,
          max: 20,
          itemLabel: "Evento",
          fields: [
            { name: "name", label: "Nombre", control: { kind: "text", maxLength: 120 } },
            { name: "start", label: "Empieza", control: { kind: "datetime" } },
            { name: "end", label: "Termina", optional: true, control: { kind: "datetime" } },
            { name: "venue", label: "Lugar", optional: true, control: { kind: "text", maxLength: 160 } },
            { name: "address", label: "Dirección", optional: true, control: { kind: "text", maxLength: 300 } },
            { name: "description", label: "Descripción", optional: true, control: { kind: "text", maxLength: 500 } },
            imageField("image", "Imagen", true, "wide"),
            { name: "ticketUrl", label: "Enlace de entradas o inscripción", optional: true, control: { kind: "link" } },
            { name: "ticketLabel", label: "Texto del botón", optional: true, helperText: "Si lo dejas vacío: «Entradas».", control: { kind: "text", maxLength: 40 } },
            { name: "soldOut", label: "Agotado", control: { kind: "boolean" } },
          ],
        },
      },
    ],
    seedConfig: () => ({
      title: "Próximas fechas",
      timeZone: DEFAULT_BOOKING_TIME_ZONE,
      items: [{ name: "Nombre del evento", start: localDateTimeInDays(14, 19), soldOut: false }],
    }),
  },

  // F7.4 (ADR-019): la casilla de consentimiento y su texto son fijos; acá solo los textos del bloque.
  newsletter: {
    fields: [
      { name: "title", label: "Título", optional: true, helperText: "Si lo dejas vacío: «Recibe nuestras novedades».", control: { kind: "text", maxLength: 120 } },
      { name: "description", label: "Texto", optional: true, helperText: "Qué van a recibir y cada cuánto.", control: { kind: "text", maxLength: 300 } },
      { name: "askName", label: "Pedir también el nombre (opcional para el visitante)", control: { kind: "boolean" } },
      { name: "buttonLabel", label: "Texto del botón", control: { kind: "text", maxLength: 40 } },
      {
        name: "successMessage",
        label: "Mensaje al enviar",
        optional: true,
        helperText: "Se muestra antes de «Revisa tu correo para confirmar».",
        control: { kind: "text", maxLength: 200 },
      },
    ],
    seedConfig: () => ({ title: "Recibe nuestras novedades", description: "Un correo al mes con lo nuevo. Sin spam.", askName: false, buttonLabel: "Suscribirme" }),
  },

  // Extra F10 (ADR-029): un botón que lleva a la página de suscripción del sitio. El formulario y los planes viven allá.
  subscribe: {
    fields: [
      { name: "label", label: "Texto del botón", helperText: "Lleva a tu página de suscripción (se arma en «Suscripción» del sitio).", control: { kind: "text", maxLength: 40 } },
      { name: "description", label: "Subtítulo", optional: true, helperText: "Una línea corta bajo el texto, por ejemplo «Contenido exclusivo».", control: { kind: "text", maxLength: 80 } },
    ],
    seedConfig: () => ({ label: "Suscríbete", description: "Contenido exclusivo" }),
  },

  // Extra F10: decoración curada. Solo elige una del catálogo; es puramente visual (el render la oculta a lectores de pantalla).
  sticker: {
    fields: [
      { name: "stickerId", label: "Decoración", control: { kind: "sticker" } },
      {
        name: "size",
        label: "Tamaño",
        control: {
          kind: "select",
          options: [
            { value: "sm", label: "Pequeño" },
            { value: "md", label: "Mediano" },
            { value: "lg", label: "Grande" },
          ],
        },
      },
      {
        name: "alignment",
        label: "Posición",
        control: {
          kind: "select",
          options: [
            { value: "left", label: "A la izquierda" },
            { value: "center", label: "Al centro" },
            { value: "right", label: "A la derecha" },
          ],
        },
      },
      {
        name: "color",
        label: "Color",
        helperText: "Usa los colores de tu tema: el acento, el color del texto o la superficie. Siempre legible.",
        control: {
          kind: "select",
          options: [
            { value: "primary", label: "Acento del tema" },
            { value: "ink", label: "Color del texto" },
            { value: "surface", label: "Superficie" },
          ],
        },
      },
      { name: "rotation", label: "Rotación (de −30° a 30°)", helperText: "Un giro pequeño le da un toque a mano. 0 = derecho.", control: { kind: "number", min: -30, max: 30, step: 1 } },
    ],
    seedConfig: () => ({ stickerId: "estrella", size: "md", rotation: 0, alignment: "center", color: "primary" }),
  },
};
