import { SOCIAL_NETWORK_LABELS, SOCIAL_NETWORKS, type BlockType } from "@impulza/validation";
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
      { name: "url", label: "Enlace", control: { kind: "url" } },
    ],
  },
};

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
        helperText: "«Portada de cuerpo entero» usa la portada como foto principal, a lo alto, sin la foto redonda.",
        control: {
          kind: "select",
          options: [
            { value: "avatar", label: "Foto redonda sobre la portada" },
            { value: "hero", label: "Portada de cuerpo entero" },
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
        helperText: "Pega el enlace de tu red, tu web, tu tienda o lo que quieras mostrar.",
        control: { kind: "url" },
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
      { name: "link", label: "Enlace al hacer clic", optional: true, control: { kind: "url" } },
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
};
