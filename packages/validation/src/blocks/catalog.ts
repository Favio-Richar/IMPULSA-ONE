import { isStickerId, STICKER_ALIGNMENTS, STICKER_COLORS, STICKER_ROTATION_MAX, STICKER_ROTATION_MIN, STICKER_SIZES } from "../stickers/index.js";
import { z } from "zod";
import {
  emailSchema,
  imageSchema,
  phoneSchema,
  plainTextSchema,
  richTextSchema,
  linkTargetSchema,
  safeUrlSchema,
  socialNetworkSchema,
  videoEmbedSchema,
} from "./primitives.js";
import { musicEmbedSchema } from "./music.js";
import { localDateTimeSchema, localDateTimeToInstant, NONEXISTENT_LOCAL_TIME_MESSAGE, timeZoneSchema } from "./time.js";

// Catálogo cerrado de bloques del MVP (ST §9). Un bloque NO es HTML: es un `type` conocido con una
// configuración validada por su propio esquema Zod. Agregar un tipo nuevo es agregar una entrada
// acá; no hay ninguna vía por la que el usuario meta marcado o scripts propios (ST §22).

export const BLOCK_TYPES = [
  "profile",
  "hero",
  "text",
  "link",
  "social",
  "image",
  "gallery",
  "video",
  "whatsapp",
  "contact_actions",
  "contact_form",
  "service",
  "divider",
  "faq",
  "testimonials",
  "booking",
  "catalog",
  // F7.3 (ADR-018)
  "countdown",
  "pricing",
  "map",
  "music",
  "events",
  // F7.4 (ADR-019)
  "newsletter",
  // F10: rueda de trabajos (portafolio que se hace girar)
  "works_wheel",
  // F10: cinta de texto en movimiento y colecciones (álbumes / segundos perfiles)
  "marquee",
  "showcase",
  // F10: contador público de vistas y botón «me gusta» de la página
  "engagement",
  // F10: bloques de portal profesional
  "album",
  "page_header",
  "stats",
  "steps",
  "feature",
  // Extra F10: botón «Suscribirme» que lleva a la página de suscripción del sitio (`/:sitio/s`)
  "subscribe",
  // Extra F10: decoraciones curadas (flechas, formas, decorativos y sellos); puramente visuales
  "sticker",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

const alignmentSchema = z.enum(["left", "center", "right"]).default("left");

const socialLinkSchema = z.object({ network: socialNetworkSchema, url: safeUrlSchema });

/** Diseños de la cabecera de perfil. Sin la clave en la configuración vale `avatar` (la de siempre). */
export const PROFILE_LAYOUTS = ["avatar", "hero", "banner", "cutout"] as const;
export type ProfileLayout = (typeof PROFILE_LAYOUTS)[number];

// Encabezado de perfil (PP4): `cover` (portada detrás del avatar) y `socials` (fila de redes bajo la
// bio) son opcionales y se agregaron sin subir la versión del esquema: una configuración anterior
// sigue siendo válida tal cual, y un despliegue anterior que lea una nueva simplemente los ignora
// (Zod descarta las claves que no conoce) en vez de dejar de mostrar el bloque.
export const profileSchema = z.object({
  name: plainTextSchema(120),
  headline: plainTextSchema(160).optional(),
  bio: richTextSchema.optional(),
  avatar: imageSchema.optional(),
  cover: imageSchema.optional(),
  verified: z.boolean().default(false),
  socials: z.array(socialLinkSchema).max(8).optional(),
  // PL7: `hero` = portada de cuerpo entero sin avatar redondo. Opcional y sin valor por defecto: un
  // perfil guardado antes se lee igual (sin la clave = `avatar`).
  // Editor de portales: `banner` = portada ancha y baja con la foto más chica en la esquina y el texto alineado a la
  // izquierda; `cutout` = la foto en un recorte vertical con las esquinas del radio del tema (no un círculo).
  layout: z.enum(PROFILE_LAYOUTS).optional(),
  // PL8: botón para compartir la página. Opcional y apagado sin la clave: nada publicado cambia.
  shareButton: z.boolean().optional(),
});

export const heroSchema = z.object({
  title: plainTextSchema(160),
  subtitle: plainTextSchema(300).optional(),
  background: imageSchema.optional(),
  alignment: alignmentSchema,
  cta: z.object({ label: plainTextSchema(60), url: linkTargetSchema }).optional(),
});

export const textSchema = z.object({
  html: richTextSchema,
  alignment: alignmentSchema,
});

export const linkSchema = z.object({
  label: plainTextSchema(80),
  url: linkTargetSchema,
  description: plainTextSchema(160).optional(),
  style: z.enum(["primary", "secondary", "outline"]).default("primary"),
  icon: socialNetworkSchema.optional(),
  // PL8: botón para compartir este enlace. Opcional y apagado sin la clave.
  shareable: z.boolean().optional(),
});

export const socialSchema = z.object({
  links: z
    .array(socialLinkSchema)
    .min(1)
    .max(12),
  // ADR-008: por defecto botones de la pila; "icons" solo si el cliente lo elige.
  style: z.enum(["icons", "buttons"]).default("buttons"),
});

export const imageBlockSchema = z.object({
  image: imageSchema,
  caption: plainTextSchema(300).optional(),
  link: linkTargetSchema.optional(),
});

export const gallerySchema = z.object({
  images: z.array(imageSchema).min(1).max(24),
  layout: z.enum(["grid", "carousel"]).default("grid"),
});

/**
 * Rueda de trabajos (F10): un portafolio que gira en 3D. Cada pieza es una imagen con su nombre y, si el negocio
 * quiere, un enlace; todo lo administra el negocio. Mínimo 3 piezas (con menos, un anillo no se lee como rueda) y
 * máximo 16 (más allá, el tambor se vuelve ilegible en un teléfono). Texto plano: nada de HTML.
 */
export const WORKS_WHEEL_MIN_ITEMS = 3;
export const WORKS_WHEEL_MAX_ITEMS = 16;
export const worksWheelItemSchema = z.object({
  title: plainTextSchema(60),
  image: imageSchema,
  link: linkTargetSchema.optional(),
});
export const worksWheelSchema = z.object({
  /** Va al centro del anillo y es el nombre accesible de la sección. */
  label: plainTextSchema(40).default("Mis trabajos"),
  /** Texto accesible del enlace de cada pieza («Ver»). */
  actionLabel: plainTextSchema(24).default("Ver"),
  items: z.array(worksWheelItemSchema).min(WORKS_WHEEL_MIN_ITEMS).max(WORKS_WHEEL_MAX_ITEMS),
});

/**
 * Cinta de texto en movimiento (F10): palabras o frases que se desplazan sin parar (por ejemplo «FOTOGRAFÍA · MODA ·
 * EDITORIAL»). Texto plano; con «reducir movimiento» queda quieta. Es decorativa: el lector de pantalla la lee una vez.
 */
export const MARQUEE_SPEEDS = ["slow", "normal", "fast"] as const;
export const marqueeSchema = z.object({
  items: z.array(plainTextSchema(40)).min(2).max(12),
  speed: z.enum(MARQUEE_SPEEDS).default("normal"),
});

/**
 * Colecciones (F10): tarjetas grandes con portada, título y un enlace a donde el negocio quiera — su página web, un álbum,
 * una galería completa u otro perfil biográfico. Es el «botón con diseño propio» de un portal profesional: en vez de una
 * línea de texto, una portada que invita a entrar.
 */
export const SHOWCASE_MAX_ITEMS = 12;
export const showcaseItemSchema = z.object({
  title: plainTextSchema(60),
  subtitle: plainTextSchema(100).optional(),
  /** Insignia corta sobre la portada: «24 fotos», «Nuevo», «2026». */
  badge: plainTextSchema(24).optional(),
  image: imageSchema,
  link: linkTargetSchema,
});
export const showcaseSchema = z.object({
  title: plainTextSchema(80).optional(),
  /** `stack`: una tarjeta por fila, ancha y cinematográfica. `grid`: dos por fila en pantallas medianas y grandes. */
  layout: z.enum(["stack", "grid"]).default("stack"),
  /** Texto accesible y visible de la flecha de cada tarjeta. */
  actionLabel: plainTextSchema(24).default("Ver"),
  items: z.array(showcaseItemSchema).min(1).max(SHOWCASE_MAX_ITEMS),
});

/**
 * Álbum (F10): la galería profesional de un portal. Fotos con título y categoría opcionales, filtros por categoría y un
 * visor a pantalla completa (teclado, deslizamiento, contador). Hasta 60 fotos: la página carga de a 12 para no pesar.
 */
export const ALBUM_MAX_PHOTOS = 60;
export const albumPhotoSchema = z.object({
  image: imageSchema,
  title: plainTextSchema(80).optional(),
  /** Categoría corta para filtrar («Retrato», «Editorial»…). Las fotos sin categoría salen solo en «Todas». */
  category: plainTextSchema(30).optional(),
});
export const albumSchema = z.object({
  title: plainTextSchema(80).optional(),
  description: plainTextSchema(300).optional(),
  layout: z.enum(["masonry", "grid"]).default("masonry"),
  showFilters: z.boolean().default(true),
  photos: z.array(albumPhotoSchema).min(1).max(ALBUM_MAX_PHOTOS),
});

/** Encabezado de una página interna (F10): lo primero que se ve al abrir un álbum, un perfil o una sección. */
export const pageHeaderSchema = z.object({
  eyebrow: plainTextSchema(40).optional(),
  title: plainTextSchema(100),
  subtitle: plainTextSchema(300).optional(),
});

/** Cifras destacadas (F10): «+250 sesiones», «8 años»… Dos a cuatro. */
export const statsSchema = z.object({
  title: plainTextSchema(80).optional(),
  items: z.array(z.object({ value: plainTextSchema(14), label: plainTextSchema(40) })).min(2).max(4),
});

/** Cómo trabajo (F10): pasos numerados. */
export const stepsSchema = z.object({
  title: plainTextSchema(80).optional(),
  items: z.array(z.object({ title: plainTextSchema(60), description: plainTextSchema(240) })).min(2).max(6),
});

/** Imagen y texto (F10): una historia con foto, para «Sobre mí», una sección o un servicio destacado. */
export const featureSchema = z.object({
  image: imageSchema,
  imagePosition: z.enum(["left", "right"]).default("left"),
  eyebrow: plainTextSchema(40).optional(),
  title: plainTextSchema(100),
  text: richTextSchema,
  cta: z.object({ label: plainTextSchema(60), url: linkTargetSchema }).optional(),
});

/**
 * Vistas y «me gusta» (F10): muestra cuánta gente vio la página y deja que el visitante le dé «me gusta». Las cifras las
 * pone el servidor; el bloque solo decide qué mostrar.
 */
export const engagementSchema = z.object({
  showViews: z.boolean().default(true),
  showLikes: z.boolean().default(true),
  /** Texto del botón; sin él, «Me gusta». */
  likeLabel: plainTextSchema(24).default("Me gusta"),
});

export const videoSchema = z.object({
  // Se guarda proveedor + id, nunca una URL de iframe libre (ver primitives.ts).
  video: videoEmbedSchema,
  title: plainTextSchema(160).optional(),
});

export const whatsappSchema = z.object({
  phone: phoneSchema,
  label: plainTextSchema(60).default("Escríbenos por WhatsApp"),
  // Mensaje que se precarga en el chat. Texto plano: viaja en la URL, no se renderiza como HTML.
  prefilledMessage: z.string().trim().max(500).optional(),
});

export const contactActionsSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    emailLabel: plainTextSchema(60).optional(),
    phoneLabel: plainTextSchema(60).optional(),
  })
  .refine((value) => value.email !== undefined || value.phone !== undefined, {
    message: "Indica al menos un correo o un teléfono.",
  });

// v2 (F3.2): el bloque ya no declara campos propios — resuelve un `Form` real de
// `packages/database` por `formId`. `formId` en `null` es el estado "sin configurar" (vacío):
// una config de v1 sin `formId` (`{title, fields: [...], submitLabel, successMessage}`) sigue
// siendo válida acá — `title` se conserva y el resto de las claves de v1 se ignoran, en vez de
// degradar el bloque a `invalid_config` — así un bloque viejo pasa a "vacío", no desaparece.
export const contactFormSchema = z.object({
  title: plainTextSchema(160).optional(),
  formId: z.string().uuid().nullable().default(null),
});

// Reservas (F5.2): un botón de la pila que abre el flujo propio de reserva (PL5). Sin
// `serviceIds`, ofrece todos los servicios activos del sitio; con ellos, solo esos.
export const bookingBlockSchema = z.object({
  label: plainTextSchema(80).default("Reservar hora"),
  serviceIds: z.array(z.uuid()).max(50).optional(),
});

// Catálogo (F5.5): cada producto es un botón más de la pila (miniatura, nombre, precio) que
// despliega el pedido. Sin `productIds` ni `categoryId`, muestra todos los productos activos del
// sitio; con `productIds`, solo esos y en ese orden; con `categoryId`, los de esa categoría.
export const catalogBlockSchema = z.object({
  label: plainTextSchema(80).default("Tienda"),
  productIds: z.array(z.uuid()).max(50).optional(),
  categoryId: z.uuid().optional(),
});

export const serviceSchema = z.object({
  name: plainTextSchema(120),
  description: richTextSchema.optional(),
  image: imageSchema.optional(),
  // Precio en la unidad mínima de la moneda (centavos) — nunca decimal flotante (ST §8).
  priceAmount: z.number().int().min(0).optional(),
  priceCurrency: z.string().length(3).toUpperCase().optional(),
  cta: z.object({ label: plainTextSchema(60), url: linkTargetSchema }).optional(),
});

export const dividerSchema = z.object({
  style: z.enum(["line", "space"]).default("line"),
  size: z.enum(["sm", "md", "lg"]).default("md"),
});

export const faqSchema = z.object({
  title: plainTextSchema(160).optional(),
  items: z
    .array(z.object({ question: plainTextSchema(300), answer: richTextSchema }))
    .min(1)
    .max(30),
});

export const testimonialsSchema = z.object({
  title: plainTextSchema(160).optional(),
  items: z
    .array(
      z.object({
        quote: plainTextSchema(800),
        author: plainTextSchema(120),
        role: plainTextSchema(120).optional(),
        avatar: imageSchema.optional(),
        rating: z.number().int().min(1).max(5).optional(),
      }),
    )
    .min(1)
    .max(30),
  // PL6: la página pública muestra las reseñas como una insignia de la pila ("★ 4,9 · 128
  // reseñas"). Promedio y total son los del cliente en su plataforma de reseñas (si no vienen, se
  // calculan de `items`); `reviewsUrl` lleva a esa plataforma. Opcionales y sin subir la versión del
  // esquema, igual que PP4: una configuración anterior sigue siendo válida.
  ratingAverage: z.number().min(1).max(5).multipleOf(0.1).optional(),
  reviewCount: z.number().int().min(1).max(1_000_000).optional(),
  reviewsUrl: safeUrlSchema.optional(),
});

// --- F7.3 (ADR-018): bloques con tiempo y con contenido externo --------------------------------

const ctaSchema = z.object({ label: plainTextSchema(60), url: linkTargetSchema });

/**
 * Cuenta regresiva hasta una hora de pared en la zona del negocio. Al terminar, muestra su mensaje
 * o se oculta. No se exige que la fecha sea futura al guardar: una que ya pasó la avisa la salud de
 * página (el negocio puede estar editando otra cosa del bloque).
 */
export const countdownSchema = z
  .object({
    title: plainTextSchema(120).optional(),
    target: localDateTimeSchema,
    timeZone: timeZoneSchema,
    endedBehavior: z.enum(["message", "hide"]).default("message"),
    endedMessage: plainTextSchema(200).optional(),
    cta: ctaSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!localDateTimeToInstant(value.target, value.timeZone)) {
      ctx.addIssue({ code: "custom", path: ["target"], message: NONEXISTENT_LOCAL_TIME_MESSAGE });
    }
  });

export const PRICING_PERIODS = ["once", "month", "year"] as const;

export const pricingPlanSchema = z.object({
  name: plainTextSchema(80),
  // Unidad mínima de la moneda, entero (ST §8): 12990 CLP = $12.990.
  priceAmount: z.number().int().min(0).max(1_000_000_000_000),
  priceCurrency: z.string().trim().length(3).toUpperCase().default("CLP"),
  period: z.enum(PRICING_PERIODS).default("once"),
  description: plainTextSchema(200).optional(),
  features: z.array(plainTextSchema(120)).max(12).default([]),
  badge: plainTextSchema(30).optional(),
  highlighted: z.boolean().default(false),
  cta: ctaSchema.optional(),
});

export const pricingSchema = z
  .object({
    title: plainTextSchema(120).optional(),
    plans: z.array(pricingPlanSchema).min(1).max(4),
  })
  .refine((value) => value.plans.filter((plan) => plan.highlighted).length <= 1, {
    message: "Destaca a lo sumo un plan.",
    path: ["plans"],
  });

/** Mapa: la dirección escrita; el mapa de Google se carga solo si el visitante lo pide (ADR-018 §2). */
export const mapSchema = z.object({
  name: plainTextSchema(120).optional(),
  address: plainTextSchema(300),
  note: plainTextSchema(200).optional(),
  showMap: z.boolean().default(true),
});

export const musicSchema = z.object({
  music: musicEmbedSchema,
  title: plainTextSchema(160).optional(),
});

export const eventItemSchema = z.object({
  name: plainTextSchema(120),
  start: localDateTimeSchema,
  end: localDateTimeSchema.optional(),
  venue: plainTextSchema(160).optional(),
  address: plainTextSchema(300).optional(),
  description: plainTextSchema(500).optional(),
  image: imageSchema.optional(),
  ticketUrl: linkTargetSchema.optional(),
  ticketLabel: plainTextSchema(40).optional(),
  soldOut: z.boolean().default(false),
});

export const eventsSchema = z
  .object({
    title: plainTextSchema(120).optional(),
    timeZone: timeZoneSchema,
    items: z.array(eventItemSchema).min(1).max(20),
  })
  .superRefine((value, ctx) => {
    value.items.forEach((item, index) => {
      const start = localDateTimeToInstant(item.start, value.timeZone);
      if (!start) {
        ctx.addIssue({ code: "custom", path: ["items", index, "start"], message: NONEXISTENT_LOCAL_TIME_MESSAGE });
        return;
      }
      if (item.end) {
        const end = localDateTimeToInstant(item.end, value.timeZone);
        if (!end) {
          ctx.addIssue({ code: "custom", path: ["items", index, "end"], message: NONEXISTENT_LOCAL_TIME_MESSAGE });
        } else if (end <= start) {
          ctx.addIssue({ code: "custom", path: ["items", index, "end"], message: "El término tiene que ser después del inicio." });
        }
      }
    });
  });

/**
 * Suscripción a la newsletter con doble confirmación (F7.4, ADR-019). El bloque solo configura los
 * textos: la casilla de consentimiento y su texto son fijos (no los decide el negocio).
 */
export const newsletterBlockSchema = z.object({
  title: plainTextSchema(120).optional(),
  description: plainTextSchema(300).optional(),
  askName: z.boolean().default(false),
  buttonLabel: plainTextSchema(40).default("Suscribirme"),
  successMessage: plainTextSchema(200).optional(),
});

/**
 * Botón «Suscribirme» del portal (extra F10, ADR-029): solo el texto. Lleva a la página de suscripción del sitio, donde la
 * persona se suscribe gratis o con un plan de pago; ahí vive el formulario, no en la portada.
 */
export const subscribeBlockSchema = z.object({
  label: plainTextSchema(40).default("Suscríbete"),
  description: plainTextSchema(80).optional(),
});

/**
 * Sticker o decoración (extra F10): una pieza visual de un conjunto CERRADO y curado (`STICKER_CATALOG`: flechas, formas,
 * decorativos y sellos). No se sube nada: `stickerId` solo puede ser uno del catálogo. Es decorativo (el render lo oculta a
 * lectores de pantalla). La geometría es la del lienzo de la página, que apila bloques en una columna: alineación a la izquierda,
 * al centro o a la derecha, tamaño y una rotación pequeña.
 */
export const stickerSchema = z.object({
  stickerId: z.string().refine(isStickerId, "Elige una decoración del catálogo."),
  size: z.enum(STICKER_SIZES).default("md"),
  rotation: z.number().int().min(STICKER_ROTATION_MIN).max(STICKER_ROTATION_MAX).default(0),
  alignment: z.enum(STICKER_ALIGNMENTS).default("center"),
  color: z.enum(STICKER_COLORS).default("primary"),
});

/**
 * Entrada del catálogo.
 *
 * `version` es el `config_schema_version` que se guarda con el bloque: sube cuando el esquema de
 * ese tipo cambia de forma incompatible, y permite que el render sepa que un bloque guardado con
 * una versión más nueva que la que entiende debe degradar en vez de romper (F2.4).
 *
 * `richTextPaths` declara qué campos son HTML del usuario y por lo tanto deben pasar por el
 * sanitizador del servidor. Está acá, junto al esquema, para que no exista la posibilidad de
 * agregar un campo de texto enriquecido y olvidarse de sanitizarlo en otro archivo: hay una
 * prueba que verifica que todo campo que use `richTextSchema` esté declarado acá.
 * Sintaxis: `campo`, `campo.subcampo`, `lista[].campo`.
 */
export interface BlockDefinition {
  type: BlockType;
  version: number;
  schema: z.ZodType;
  richTextPaths: readonly string[];
}

export const BLOCK_CATALOG: Readonly<Record<BlockType, BlockDefinition>> = {
  profile: { type: "profile", version: 1, schema: profileSchema, richTextPaths: ["bio"] },
  hero: { type: "hero", version: 1, schema: heroSchema, richTextPaths: [] },
  text: { type: "text", version: 1, schema: textSchema, richTextPaths: ["html"] },
  link: { type: "link", version: 1, schema: linkSchema, richTextPaths: [] },
  social: { type: "social", version: 1, schema: socialSchema, richTextPaths: [] },
  image: { type: "image", version: 1, schema: imageBlockSchema, richTextPaths: [] },
  gallery: { type: "gallery", version: 1, schema: gallerySchema, richTextPaths: [] },
  video: { type: "video", version: 1, schema: videoSchema, richTextPaths: [] },
  whatsapp: { type: "whatsapp", version: 1, schema: whatsappSchema, richTextPaths: [] },
  contact_actions: {
    type: "contact_actions",
    version: 1,
    schema: contactActionsSchema,
    richTextPaths: [],
  },
  contact_form: { type: "contact_form", version: 2, schema: contactFormSchema, richTextPaths: [] },
  service: { type: "service", version: 1, schema: serviceSchema, richTextPaths: ["description"] },
  divider: { type: "divider", version: 1, schema: dividerSchema, richTextPaths: [] },
  faq: { type: "faq", version: 1, schema: faqSchema, richTextPaths: ["items[].answer"] },
  testimonials: {
    type: "testimonials",
    version: 1,
    schema: testimonialsSchema,
    richTextPaths: [],
  },
  booking: { type: "booking", version: 1, schema: bookingBlockSchema, richTextPaths: [] },
  catalog: { type: "catalog", version: 1, schema: catalogBlockSchema, richTextPaths: [] },
  countdown: { type: "countdown", version: 1, schema: countdownSchema, richTextPaths: [] },
  pricing: { type: "pricing", version: 1, schema: pricingSchema, richTextPaths: [] },
  map: { type: "map", version: 1, schema: mapSchema, richTextPaths: [] },
  music: { type: "music", version: 1, schema: musicSchema, richTextPaths: [] },
  events: { type: "events", version: 1, schema: eventsSchema, richTextPaths: [] },
  newsletter: { type: "newsletter", version: 1, schema: newsletterBlockSchema, richTextPaths: [] },
  subscribe: { type: "subscribe", version: 1, schema: subscribeBlockSchema, richTextPaths: [] },
  sticker: { type: "sticker", version: 1, schema: stickerSchema, richTextPaths: [] },
  works_wheel: { type: "works_wheel", version: 1, schema: worksWheelSchema, richTextPaths: [] },
  marquee: { type: "marquee", version: 1, schema: marqueeSchema, richTextPaths: [] },
  showcase: { type: "showcase", version: 1, schema: showcaseSchema, richTextPaths: [] },
  engagement: { type: "engagement", version: 1, schema: engagementSchema, richTextPaths: [] },
  album: { type: "album", version: 1, schema: albumSchema, richTextPaths: [] },
  page_header: { type: "page_header", version: 1, schema: pageHeaderSchema, richTextPaths: [] },
  stats: { type: "stats", version: 1, schema: statsSchema, richTextPaths: [] },
  steps: { type: "steps", version: 1, schema: stepsSchema, richTextPaths: [] },
  feature: { type: "feature", version: 1, schema: featureSchema, richTextPaths: ["text"] },
};

/**
 * Bloques que pueden ser la **acción principal** de una página (PP5): se destaca y, en el teléfono,
 * queda fija abajo. Solo los que llevan a un contacto real — escribir por WhatsApp, abrir un
 * enlace, llenar un formulario, reservar (F5.2) —; un texto o una galería no son una acción.
 */
export const PRIMARY_ACTION_BLOCK_TYPES = ["whatsapp", "link", "contact_form", "booking"] as const satisfies readonly BlockType[];
export type PrimaryActionBlockType = (typeof PRIMARY_ACTION_BLOCK_TYPES)[number];

export function isPrimaryActionBlockType(type: string): type is PrimaryActionBlockType {
  return (PRIMARY_ACTION_BLOCK_TYPES as readonly string[]).includes(type);
}

export function isBlockType(value: string): value is BlockType {
  return Object.hasOwn(BLOCK_CATALOG, value);
}

export function getBlockDefinition(type: string): BlockDefinition | null {
  return isBlockType(type) ? BLOCK_CATALOG[type] : null;
}

/** Esquema del `type` para los DTO de la API: rechaza cualquier tipo fuera del catálogo. */
export const blockTypeSchema = z.enum(BLOCK_TYPES);

// Tipos inferidos por tipo de bloque — para que un renderer (apps/web, F2.7) o un editor de
// propiedades (constructor, F2.9) reciban la forma exacta de `config` en vez de `unknown`, sin
// mantener una segunda definición a mano que pueda desalinearse del esquema real.
export type ProfileBlockConfig = z.infer<typeof profileSchema>;
export type HeroBlockConfig = z.infer<typeof heroSchema>;
export type TextBlockConfig = z.infer<typeof textSchema>;
export type LinkBlockConfig = z.infer<typeof linkSchema>;
export type SocialBlockConfig = z.infer<typeof socialSchema>;
export type ImageBlockConfig = z.infer<typeof imageBlockSchema>;
export type GalleryBlockConfig = z.infer<typeof gallerySchema>;
export type WorksWheelBlockConfig = z.infer<typeof worksWheelSchema>;
export type WorksWheelItem = z.infer<typeof worksWheelItemSchema>;
export type MarqueeBlockConfig = z.infer<typeof marqueeSchema>;
export type ShowcaseBlockConfig = z.infer<typeof showcaseSchema>;
export type ShowcaseItem = z.infer<typeof showcaseItemSchema>;
export type EngagementBlockConfig = z.infer<typeof engagementSchema>;
export type AlbumBlockConfig = z.infer<typeof albumSchema>;
export type AlbumPhoto = z.infer<typeof albumPhotoSchema>;
export type PageHeaderBlockConfig = z.infer<typeof pageHeaderSchema>;
export type StatsBlockConfig = z.infer<typeof statsSchema>;
export type StepsBlockConfig = z.infer<typeof stepsSchema>;
export type FeatureBlockConfig = z.infer<typeof featureSchema>;
export type VideoBlockConfig = z.infer<typeof videoSchema>;
export type WhatsappBlockConfig = z.infer<typeof whatsappSchema>;
export type ContactActionsBlockConfig = z.infer<typeof contactActionsSchema>;
export type ContactFormBlockConfig = z.infer<typeof contactFormSchema>;
export type ServiceBlockConfig = z.infer<typeof serviceSchema>;
export type DividerBlockConfig = z.infer<typeof dividerSchema>;
export type FaqBlockConfig = z.infer<typeof faqSchema>;
export type BookingBlockConfig = z.infer<typeof bookingBlockSchema>;
export type CatalogBlockConfig = z.infer<typeof catalogBlockSchema>;
export type TestimonialsBlockConfig = z.infer<typeof testimonialsSchema>;
export type CountdownBlockConfig = z.infer<typeof countdownSchema>;
export type PricingBlockConfig = z.infer<typeof pricingSchema>;
export type PricingPlan = z.infer<typeof pricingPlanSchema>;
export type MapBlockConfig = z.infer<typeof mapSchema>;
export type MusicBlockConfig = z.infer<typeof musicSchema>;
export type EventsBlockConfig = z.infer<typeof eventsSchema>;
export type EventItem = z.infer<typeof eventItemSchema>;
export type NewsletterBlockConfig = z.infer<typeof newsletterBlockSchema>;
export type SubscribeBlockConfig = z.infer<typeof subscribeBlockSchema>;
export type StickerBlockConfig = z.infer<typeof stickerSchema>;
