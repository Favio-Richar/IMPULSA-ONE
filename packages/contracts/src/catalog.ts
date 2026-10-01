import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Catálogo y pedidos (F5.5). Montos en la unidad mínima de la moneda.

const productKind = z.enum(["PHYSICAL", "DIGITAL", "SERVICE"]);
const orderStatus = z.enum(["NEW", "PAID", "DELIVERED", "CANCELLED"]);
const imageResponse = z.object({ url: z.string(), alt: z.string(), decorative: z.boolean().optional() });

export const productCategoryResponse = z.object({
  id: uuid,
  siteId: uuid,
  name: z.string(),
  position: z.number().int(),
  createdAt: isoDateTime,
});
export type ProductCategoryResponse = z.infer<typeof productCategoryResponse>;

/** Variante de un producto en el panel (F7.8a, ADR-023). */
export const productVariantResponse = z.object({
  id: uuid,
  productId: uuid,
  name: z.string(),
  /** `null` = vale el precio del producto. */
  priceAmount: z.number().int().nullable(),
  /** `null` = sin control de stock. */
  stock: z.number().int().nullable(),
  sku: z.string().nullable(),
  position: z.number().int(),
  active: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type ProductVariantResponse = z.infer<typeof productVariantResponse>;

export const productResponse = z.object({
  id: uuid,
  siteId: uuid,
  categoryId: uuid.nullable(),
  name: z.string(),
  description: z.string().nullable(),
  kind: productKind,
  priceAmount: z.number().int(),
  priceCurrency: z.string(),
  image: imageResponse.nullable(),
  paymentUrl: z.string().nullable(),
  /** `null` = sin control de stock. */
  stock: z.number().int().nullable(),
  active: z.boolean(),
  position: z.number().int(),
  /** Archivo que se entrega al pagar (F5.11b, ADR-015), solo en productos digitales. */
  downloadFile: z
    .object({ id: uuid, fileName: z.string(), contentType: z.string(), sizeBytes: z.number().int(), uploadedAt: isoDateTime })
    .nullable(),
  /** Variantes (F7.8a), en orden. Con alguna activa, el pedido exige elegir una. */
  variants: z.array(productVariantResponse),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type ProductResponse = z.infer<typeof productResponse>;

/** Subida del archivo en venta de un producto (F5.11b): al bucket privado, con URL prefirmada. */
export const productFileUploadResponse = z.object({
  fileId: uuid,
  upload: z.object({ url: z.string(), method: z.literal("PUT"), headers: z.record(z.string(), z.string()), expiresAt: isoDateTime }),
});
export type ProductFileUploadResponse = z.infer<typeof productFileUploadResponse>;

/**
 * Página de descarga de un pedido (F5.11b). `ready`: se puede descargar; `awaiting_payment`: el
 * pedido todavía no está pagado; `revoked`: cancelado, devuelto o con contracargo; `limit_reached`:
 * se usaron todas las descargas; `unavailable`: el producto ya no tiene archivo.
 */
export const publicDownloadResponse = z.object({
  siteSlug: z.string(),
  siteName: z.string(),
  productName: z.string(),
  fileName: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  status: z.enum(["ready", "awaiting_payment", "revoked", "limit_reached", "unavailable"]),
  downloadsLeft: z.number().int(),
});
export type PublicDownloadResponse = z.infer<typeof publicDownloadResponse>;

/** URL firmada de pocos minutos para bajar el archivo (cada una cuenta como una descarga). */
export const publicDownloadUrlResponse = z.object({ url: z.string(), expiresAt: isoDateTime, downloadsLeft: z.number().int() });
export type PublicDownloadUrlResponse = z.infer<typeof publicDownloadUrlResponse>;

/** Catálogo que ve la página pública: solo productos activos, sin enlace de pago ni stock exacto. */
export const publicCatalogResponse = z.object({
  categories: z.array(z.object({ id: uuid, name: z.string() })),
  products: z.array(
    z.object({
      id: uuid,
      categoryId: uuid.nullable(),
      name: z.string(),
      description: z.string().nullable(),
      kind: productKind,
      priceAmount: z.number().int(),
      priceCurrency: z.string(),
      image: imageResponse.nullable(),
      /** `false` si el negocio controla stock y no queda (con variantes: si no queda en ninguna). */
      available: z.boolean(),
      /** Tope de unidades por pedido (el menor entre el stock y 99). */
      maxQuantity: z.number().int(),
      /**
       * Variantes activas (F7.8a), en orden; si hay alguna, el pedido exige elegir una. Precio ya
       * resuelto (el de la variante o el del producto) y sin stock exacto, igual que el producto.
       */
      variants: z.array(
        z.object({ id: uuid, name: z.string(), priceAmount: z.number().int(), available: z.boolean(), maxQuantity: z.number().int() }),
      ),
    }),
  ),
});
export type PublicCatalogResponse = z.infer<typeof publicCatalogResponse>;

/** Confirmación de un pedido público: lo que el visitante ve (nunca ids internos del negocio). */
export const publicOrderConfirmationResponse = z.object({
  productName: z.string(),
  quantity: z.number().int(),
  unitPriceAmount: z.number().int(),
  totalAmount: z.number().int(),
  priceCurrency: z.string(),
  /** Descuento del cupón aplicado (F7.8b), ya restado de `totalAmount`; 0 sin cupón. */
  discountAmount: z.number().int(),
  couponCode: z.string().nullable(),
  /** Enlace de pago del propio negocio, si lo configuró y no cobra con Mercado Pago conectado. */
  paymentUrl: z.string().nullable(),
  /** Pago con Checkout Pro en la cuenta de Mercado Pago del negocio (F5.9, ADR-013). */
  checkoutUrl: z.string().nullable(),
});
export type PublicOrderConfirmationResponse = z.infer<typeof publicOrderConfirmationResponse>;

/**
 * "Tu pedido" (F5.9): lo que ve el comprador con el enlace de su correo o al volver de Mercado Pago.
 * Sin datos personales: el enlace puede quedar en el historial de un computador compartido.
 */
export const publicOrderStatusResponse = z.object({
  siteSlug: z.string(),
  siteName: z.string(),
  productName: z.string(),
  quantity: z.number().int(),
  totalAmount: z.number().int(),
  priceCurrency: z.string(),
  status: orderStatus,
  /** Último estado del pago informado por Mercado Pago (`approved`, `pending`, `rejected`…), o `null` si aún no hay intento. */
  paymentStatus: z.string().nullable(),
  /** Dónde pagar, solo mientras el pedido espera pago y el cobro no venció. */
  checkoutUrl: z.string().nullable(),
  /** Página de descarga del archivo comprado (F5.11b), si el pedido ya lo entrega. */
  downloadUrl: z.string().nullable(),
});
export type PublicOrderStatusResponse = z.infer<typeof publicOrderStatusResponse>;

/** Línea de un pedido (F7.8a, ADR-023): copia de lo pedido al momento de pedir. */
export const orderItemResponse = z.object({
  productId: uuid.nullable(),
  variantId: uuid.nullable(),
  productName: z.string(),
  variantName: z.string().nullable(),
  productKind: productKind,
  unitPriceAmount: z.number().int(),
  quantity: z.number().int(),
  lineTotalAmount: z.number().int(),
});
export type OrderItemResponse = z.infer<typeof orderItemResponse>;

/** Un pedido en el panel del negocio. Datos del cliente: solo para miembros de la organización. */
export const orderResponse = z.object({
  id: uuid,
  siteId: uuid,
  productId: uuid.nullable(),
  contactId: uuid.nullable(),
  productName: z.string(),
  productKind: productKind,
  unitPriceAmount: z.number().int(),
  priceCurrency: z.string(),
  quantity: z.number().int(),
  totalAmount: z.number().int(),
  customerName: z.string(),
  customerEmail: z.string(),
  customerPhone: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  note: z.string().nullable(),
  status: orderStatus,
  /** Descuento de un cupón (F7.8b), ya restado de `totalAmount`; 0 sin cupón. */
  discountAmount: z.number().int(),
  couponCode: z.string().nullable(),
  /** Líneas del pedido (F7.8a); los pedidos anteriores tienen la suya, copiada en la migración. */
  items: z.array(orderItemResponse),
  /** Cobro con Mercado Pago (F5.9): estado y id del pago en la cuenta del negocio, o `null` si el pedido no se cobra en línea. */
  onlinePayment: z
    .object({
      status: z.string().nullable(),
      paymentId: z.string().nullable(),
      /** Cuánto se devolvió ya (F5.11a), según Mercado Pago. */
      refundedAmount: z.number().int(),
    })
    .nullable(),
  /** Descargas entregadas del archivo en venta (F5.11b); 0 si el producto no tiene archivo. */
  downloadCount: z.number().int(),
  paidAt: isoDateTime.nullable(),
  deliveredAt: isoDateTime.nullable(),
  cancelledAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type OrderResponse = z.infer<typeof orderResponse>;

export const orderListResponse = z.object({
  items: z.array(orderResponse),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Conteo por estado de todos los pedidos del filtro de sitio (para las pestañas del panel). */
  counts: z.object({ NEW: z.number().int(), PAID: z.number().int(), DELIVERED: z.number().int(), CANCELLED: z.number().int() }),
});
export type OrderListResponse = z.infer<typeof orderListResponse>;
