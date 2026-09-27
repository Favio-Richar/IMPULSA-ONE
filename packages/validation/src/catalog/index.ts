import { z } from "zod";
import { imageSchema, phoneSchema, plainTextSchema, safeUrlSchema } from "../blocks/primitives.js";

export * from "./messages.js";

// Catálogo y pedidos (F5.5). Esquemas compartidos por la API (que siempre revalida) y el panel.

export const PRODUCT_KINDS = ["PHYSICAL", "DIGITAL", "SERVICE"] as const;
export type ProductKindValue = (typeof PRODUCT_KINDS)[number];
export const PRODUCT_KIND_LABELS: Record<ProductKindValue, string> = {
  PHYSICAL: "Producto físico",
  DIGITAL: "Producto digital",
  SERVICE: "Servicio",
};

export const ORDER_STATUSES = ["NEW", "PAID", "DELIVERED", "CANCELLED"] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABELS: Record<OrderStatusValue, string> = {
  NEW: "Nuevo",
  PAID: "Pagado",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
};

/** Topes técnicos por sitio (un límite por plan es la decisión #4 del propietario). */
export const MAX_PRODUCTS_PER_SITE = 200;
export const MAX_CATEGORIES_PER_SITE = 30;
export const MAX_ORDER_QUANTITY = 99;

export const productCategorySchema = z.object({ name: plainTextSchema(60) });
export type ProductCategoryInput = z.infer<typeof productCategorySchema>;

export const productSchema = z.object({
  name: plainTextSchema(120),
  description: plainTextSchema(1000).optional(),
  kind: z.enum(PRODUCT_KINDS).default("PHYSICAL"),
  priceAmount: z.number().int().min(0).max(1_000_000_000),
  priceCurrency: z.string().length(3).toUpperCase(),
  image: imageSchema.optional(),
  /** Enlace de pago del propio negocio (Impulza no cobra: decisión #6). */
  paymentUrl: safeUrlSchema.optional(),
  /** Sin valor = sin control de stock. */
  stock: z.number().int().min(0).max(1_000_000).optional(),
  categoryId: z.uuid().optional(),
  active: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productSchema>;

/** Edición: cualquier subconjunto de campos; `null` borra un opcional. */
export const updateProductSchema = z
  .object({
    name: plainTextSchema(120),
    description: plainTextSchema(1000).nullable(),
    kind: z.enum(PRODUCT_KINDS),
    priceAmount: z.number().int().min(0).max(1_000_000_000),
    priceCurrency: z.string().length(3).toUpperCase(),
    image: imageSchema.nullable(),
    paymentUrl: safeUrlSchema.nullable(),
    stock: z.number().int().min(0).max(1_000_000).nullable(),
    categoryId: z.uuid().nullable(),
    active: z.boolean(),
    position: z.number().int().min(0).max(10_000),
  })
  .partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

/** Campo trampa del pedido público (mismo criterio que formularios y reservas). */
export const ORDER_HONEYPOT_FIELD = "website";

/**
 * Pedido desde la página pública (F5.5). El consentimiento es obligatorio porque el pedido crea (o
 * actualiza) la ficha del cliente en el mini-CRM (ADR-004). La dirección se pide solo para
 * productos físicos (la API lo exige según el producto, no según lo que diga el cliente).
 */
export const publicOrderRequestSchema = z.object({
  productId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_ORDER_QUANTITY),
  name: plainTextSchema(120),
  email: z.email("Escribe un correo válido.").max(254),
  phone: phoneSchema.optional(),
  address: plainTextSchema(300).optional(),
  note: plainTextSchema(500).optional(),
  consent: z.literal(true, { message: "Necesitamos tu autorización para guardar el pedido." }),
  [ORDER_HONEYPOT_FIELD]: z.string().max(200).optional(),
});
export type PublicOrderRequest = z.infer<typeof publicOrderRequestSchema>;

export const listOrdersQuerySchema = z.object({
  siteId: z.uuid().optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  /** Página de 50, de la más nueva a la más antigua. */
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

export const updateOrderStatusSchema = z.object({ status: z.enum(ORDER_STATUSES) });
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

/**
 * Transiciones permitidas. Un pedido entregado no se reabre (ya salió); uno cancelado sí puede
 * volver a "nuevo" (si hay stock).
 */
export const ORDER_TRANSITIONS: Record<OrderStatusValue, readonly OrderStatusValue[]> = {
  NEW: ["PAID", "DELIVERED", "CANCELLED"],
  PAID: ["DELIVERED", "CANCELLED", "NEW"],
  DELIVERED: [],
  CANCELLED: ["NEW"],
};

export type ProductImage = z.infer<typeof imageSchema>;

/** Imagen de producto guardada (JSON de la base), o `null` si falta o dejó de ser válida. */
export function parseStoredProductImage(value: unknown): ProductImage | null {
  const parsed = imageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
