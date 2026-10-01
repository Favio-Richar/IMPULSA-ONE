import { z } from "zod";
import { imageSchema, phoneSchema, plainTextSchema, safeUrlSchema } from "../blocks/primitives.js";

export * from "./messages.js";
export * from "./downloads.js";

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

/** Variantes por producto (F7.8a, ADR-023): talla, color, formato. */
export const MAX_VARIANTS_PER_PRODUCT = 30;

const skuSchema = z
  .string()
  .trim()
  .min(1)
  .max(40, "Máximo 40 caracteres.")
  .regex(/^[A-Za-z0-9._-]+$/, "Usa letras, números, punto, guion o guion bajo.");

/**
 * Variante de un producto. Sin `priceAmount` vale el precio del producto; sin `stock` no se
 * controla stock. Con al menos una variante activa, el pedido exige elegir una.
 */
export const productVariantSchema = z.object({
  name: plainTextSchema(60),
  priceAmount: z.number().int().min(0).max(1_000_000_000).optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  sku: skuSchema.optional(),
  active: z.boolean().default(true),
});
export type ProductVariantInput = z.infer<typeof productVariantSchema>;

/** Edición: cualquier subconjunto; `null` vuelve al precio del producto, quita el stock o el SKU. */
export const updateProductVariantSchema = z
  .object({
    name: plainTextSchema(60),
    priceAmount: z.number().int().min(0).max(1_000_000_000).nullable(),
    stock: z.number().int().min(0).max(1_000_000).nullable(),
    sku: skuSchema.nullable(),
    active: z.boolean(),
    position: z.number().int().min(0).max(1_000),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Envía al menos un campo a modificar." });
export type UpdateProductVariantInput = z.infer<typeof updateProductVariantSchema>;

/** Nombre del producto con su variante, tal como queda en el pedido ("Polera (M / Rojo)"). */
export function productWithVariantName(productName: string, variantName: string | null | undefined): string {
  return variantName ? `${productName} (${variantName})` : productName;
}

/** Campo trampa del pedido público (mismo criterio que formularios y reservas). */
export const ORDER_HONEYPOT_FIELD = "website";

/**
 * Pedido desde la página pública (F5.5). El consentimiento es obligatorio porque el pedido crea (o
 * actualiza) la ficha del cliente en el mini-CRM (ADR-004). La dirección se pide solo para
 * productos físicos (la API lo exige según el producto, no según lo que diga el cliente).
 */
export const publicOrderRequestSchema = z.object({
  productId: z.uuid(),
  /** Obligatoria si el producto tiene variantes activas (lo exige la API según el producto). */
  variantId: z.uuid().optional(),
  quantity: z.number().int().min(1).max(MAX_ORDER_QUANTITY),
  /** Código de cupón (F7.8b). La API lo valida y calcula el descuento; si no aplica, responde 422. */
  couponCode: z.string().trim().min(1).max(60).optional(),
  name: plainTextSchema(120),
  email: z.email("Escribe un correo válido.").max(254),
  phone: phoneSchema.optional(),
  address: plainTextSchema(300).optional(),
  note: plainTextSchema(500).optional(),
  consent: z.literal(true, { message: "Necesitamos tu autorización para guardar el pedido." }),
  /** Casilla aparte y opcional (F5.6): recibir novedades por correo. Sin ella, nunca hay campañas. */
  marketingConsent: z.boolean().optional(),
  [ORDER_HONEYPOT_FIELD]: z.string().max(200).optional(),
});
export type PublicOrderRequest = z.infer<typeof publicOrderRequestSchema>;

/** Carrito (F7.8c, ADR-023): hasta 20 líneas por pedido. */
export const MAX_CART_LINES = 20;

/** Una línea del carrito: solo qué y cuánto. Precio, stock y moneda los pone siempre la API. */
export const cartLineSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().optional(),
  quantity: z.number().int().min(1).max(MAX_ORDER_QUANTITY),
});
export type CartLine = z.infer<typeof cartLineSchema>;

const cartLinesSchema = z
  .array(cartLineSchema)
  .min(1, "Tu carrito está vacío.")
  .max(MAX_CART_LINES, `Un pedido admite hasta ${MAX_CART_LINES} productos distintos.`)
  .superRefine((lines, ctx) => {
    const seen = new Set<string>();
    for (const [index, line] of lines.entries()) {
      const key = `${line.productId}:${line.variantId ?? ""}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: [index], message: "El mismo producto aparece dos veces en el carrito." });
      seen.add(key);
    }
  });

/** Pedido desde el carrito: varias líneas, los mismos datos del cliente que un pedido suelto. */
export const publicCartOrderRequestSchema = publicOrderRequestSchema.omit({ productId: true, variantId: true, quantity: true }).extend({ lines: cartLinesSchema });
export type PublicCartOrderRequest = z.infer<typeof publicCartOrderRequestSchema>;

/** Probar un código con el carrito completo (el descuento va sobre el subtotal de todas las líneas). */
export const publicCartCouponCheckSchema = z.object({ code: z.string().trim().min(1).max(60), lines: cartLinesSchema });
export type PublicCartCouponCheckInput = z.infer<typeof publicCartCouponCheckSchema>;

/** Nombre resumen de un pedido con varias líneas ("Polera (M) y 2 productos más"). */
export function cartOrderSummaryName(lineNames: readonly string[]): string {
  const [first = "", ...rest] = lineNames;
  if (rest.length === 0) return first;
  return `${first} y ${rest.length} ${rest.length === 1 ? "producto más" : "productos más"}`;
}

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

/**
 * Reembolso de un cobro en línea (F5.11a): de un pedido o de una seña. Sin `amount` se devuelve lo
 * que queda; con él, esa parte (en la unidad mínima de la moneda). El servidor valida el tope.
 */
export const refundRequestSchema = z.object({
  amount: z.number().int().min(1, "El monto a devolver tiene que ser mayor que cero.").optional(),
});
export type RefundRequest = z.infer<typeof refundRequestSchema>;
