import { z } from "zod";
import {
  emailSchema,
  imageSchema,
  phoneSchema,
  plainTextSchema,
  richTextSchema,
  safeUrlSchema,
  socialNetworkSchema,
  videoEmbedSchema,
} from "./primitives.js";

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
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

const alignmentSchema = z.enum(["left", "center", "right"]).default("left");

const socialLinkSchema = z.object({ network: socialNetworkSchema, url: safeUrlSchema });

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
});

export const heroSchema = z.object({
  title: plainTextSchema(160),
  subtitle: plainTextSchema(300).optional(),
  background: imageSchema.optional(),
  alignment: alignmentSchema,
  cta: z.object({ label: plainTextSchema(60), url: safeUrlSchema }).optional(),
});

export const textSchema = z.object({
  html: richTextSchema,
  alignment: alignmentSchema,
});

export const linkSchema = z.object({
  label: plainTextSchema(80),
  url: safeUrlSchema,
  description: plainTextSchema(160).optional(),
  style: z.enum(["primary", "secondary", "outline"]).default("primary"),
  icon: socialNetworkSchema.optional(),
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
  link: safeUrlSchema.optional(),
});

export const gallerySchema = z.object({
  images: z.array(imageSchema).min(1).max(24),
  layout: z.enum(["grid", "carousel"]).default("grid"),
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

export const serviceSchema = z.object({
  name: plainTextSchema(120),
  description: richTextSchema.optional(),
  image: imageSchema.optional(),
  // Precio en la unidad mínima de la moneda (centavos) — nunca decimal flotante (ST §8).
  priceAmount: z.number().int().min(0).optional(),
  priceCurrency: z.string().length(3).toUpperCase().optional(),
  cta: z.object({ label: plainTextSchema(60), url: safeUrlSchema }).optional(),
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
};

/**
 * Bloques que pueden ser la **acción principal** de una página (PP5): se destaca y, en el teléfono,
 * queda fija abajo. Solo los que llevan a un contacto real — escribir por WhatsApp, abrir un
 * enlace, llenar un formulario —; un texto o una galería no son una acción.
 */
export const PRIMARY_ACTION_BLOCK_TYPES = ["whatsapp", "link", "contact_form"] as const satisfies readonly BlockType[];
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
export type VideoBlockConfig = z.infer<typeof videoSchema>;
export type WhatsappBlockConfig = z.infer<typeof whatsappSchema>;
export type ContactActionsBlockConfig = z.infer<typeof contactActionsSchema>;
export type ContactFormBlockConfig = z.infer<typeof contactFormSchema>;
export type ServiceBlockConfig = z.infer<typeof serviceSchema>;
export type DividerBlockConfig = z.infer<typeof dividerSchema>;
export type FaqBlockConfig = z.infer<typeof faqSchema>;
export type TestimonialsBlockConfig = z.infer<typeof testimonialsSchema>;
