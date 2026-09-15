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

const profileSchema = z.object({
  name: plainTextSchema(120),
  headline: plainTextSchema(160).optional(),
  bio: richTextSchema.optional(),
  avatar: imageSchema.optional(),
  verified: z.boolean().default(false),
});

const heroSchema = z.object({
  title: plainTextSchema(160),
  subtitle: plainTextSchema(300).optional(),
  background: imageSchema.optional(),
  alignment: alignmentSchema,
  cta: z.object({ label: plainTextSchema(60), url: safeUrlSchema }).optional(),
});

const textSchema = z.object({
  html: richTextSchema,
  alignment: alignmentSchema,
});

const linkSchema = z.object({
  label: plainTextSchema(80),
  url: safeUrlSchema,
  description: plainTextSchema(160).optional(),
  style: z.enum(["primary", "secondary", "outline"]).default("primary"),
  icon: socialNetworkSchema.optional(),
});

const socialSchema = z.object({
  links: z
    .array(z.object({ network: socialNetworkSchema, url: safeUrlSchema }))
    .min(1)
    .max(12),
  style: z.enum(["icons", "buttons"]).default("icons"),
});

const imageBlockSchema = z.object({
  image: imageSchema,
  caption: plainTextSchema(300).optional(),
  link: safeUrlSchema.optional(),
});

const gallerySchema = z.object({
  images: z.array(imageSchema).min(1).max(24),
  layout: z.enum(["grid", "carousel"]).default("grid"),
});

const videoSchema = z.object({
  // Se guarda proveedor + id, nunca una URL de iframe libre (ver primitives.ts).
  video: videoEmbedSchema,
  title: plainTextSchema(160).optional(),
});

const whatsappSchema = z.object({
  phone: phoneSchema,
  label: plainTextSchema(60).default("Escríbenos por WhatsApp"),
  // Mensaje que se precarga en el chat. Texto plano: viaja en la URL, no se renderiza como HTML.
  prefilledMessage: z.string().trim().max(500).optional(),
});

const contactActionsSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    emailLabel: plainTextSchema(60).optional(),
    phoneLabel: plainTextSchema(60).optional(),
  })
  .refine((value) => value.email !== undefined || value.phone !== undefined, {
    message: "Indica al menos un correo o un teléfono.",
  });

const contactFormSchema = z.object({
  title: plainTextSchema(160).optional(),
  // El formulario real (campos, envíos, anti-spam) es de Fase 3; el bloque solo declara que hay
  // uno y su copy. No se inventa el modelo de datos de formularios antes de tiempo.
  fields: z
    .array(z.enum(["name", "email", "phone", "message"]))
    .min(1)
    .max(4)
    .default(["name", "email", "message"]),
  submitLabel: plainTextSchema(60).default("Enviar"),
  successMessage: plainTextSchema(300).default("¡Gracias! Te responderemos pronto."),
});

const serviceSchema = z.object({
  name: plainTextSchema(120),
  description: richTextSchema.optional(),
  image: imageSchema.optional(),
  // Precio en la unidad mínima de la moneda (centavos) — nunca decimal flotante (ST §8).
  priceAmount: z.number().int().min(0).optional(),
  priceCurrency: z.string().length(3).toUpperCase().optional(),
  cta: z.object({ label: plainTextSchema(60), url: safeUrlSchema }).optional(),
});

const dividerSchema = z.object({
  style: z.enum(["line", "space"]).default("line"),
  size: z.enum(["sm", "md", "lg"]).default("md"),
});

const faqSchema = z.object({
  title: plainTextSchema(160).optional(),
  items: z
    .array(z.object({ question: plainTextSchema(300), answer: richTextSchema }))
    .min(1)
    .max(30),
});

const testimonialsSchema = z.object({
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
  contact_form: { type: "contact_form", version: 1, schema: contactFormSchema, richTextPaths: [] },
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

export function isBlockType(value: string): value is BlockType {
  return Object.hasOwn(BLOCK_CATALOG, value);
}

export function getBlockDefinition(type: string): BlockDefinition | null {
  return isBlockType(type) ? BLOCK_CATALOG[type] : null;
}

/** Esquema del `type` para los DTO de la API: rechaza cualquier tipo fuera del catálogo. */
export const blockTypeSchema = z.enum(BLOCK_TYPES);
