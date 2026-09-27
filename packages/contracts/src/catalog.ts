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
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type ProductResponse = z.infer<typeof productResponse>;

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
      /** `false` si el negocio controla stock y no queda. */
      available: z.boolean(),
      /** Tope de unidades por pedido (el menor entre el stock y 99). */
      maxQuantity: z.number().int(),
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
  /** Enlace de pago del propio negocio, si lo configuró (Impulza no cobra: decisión #6). */
  paymentUrl: z.string().nullable(),
});
export type PublicOrderConfirmationResponse = z.infer<typeof publicOrderConfirmationResponse>;

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
