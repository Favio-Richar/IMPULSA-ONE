import { signOrderDownloadToken } from "@impulza/auth";
import type { Order } from "@impulza/database";
import { MAX_DOWNLOADS_PER_ORDER } from "@impulza/validation";
import { env } from "../../env.js";

export type DownloadState = "ready" | "awaiting_payment" | "revoked" | "limit_reached" | "unavailable";

/**
 * Regla única de entrega de un archivo comprado (F5.11b, ADR-015), usada por la descarga, "Tu
 * pedido" y los correos: solo un pedido de un producto digital con archivo listo, pagado o
 * entregado, que no esté cancelado, devuelto por completo ni con contracargo, y con descargas
 * disponibles. Pagado lo decide el servidor (Mercado Pago confirmado, o el negocio a mano).
 */
export function downloadState(
  order: Pick<Order, "productKind" | "productId" | "status" | "paymentStatus" | "refundedAmount" | "totalAmount" | "downloadCount">,
  hasReadyFile: boolean,
): DownloadState {
  if (order.productKind !== "DIGITAL" || !order.productId || !hasReadyFile) return "unavailable";
  const fullyRefunded = order.refundedAmount > 0 && order.refundedAmount >= order.totalAmount;
  if (order.status === "CANCELLED" || order.paymentStatus === "charged_back" || fullyRefunded) return "revoked";
  if (order.status !== "PAID" && order.status !== "DELIVERED") return "awaiting_payment";
  if (order.downloadCount >= MAX_DOWNLOADS_PER_ORDER) return "limit_reached";
  return "ready";
}

/** Página de descarga del pedido, o `null` si la instalación no tiene URL pública o secreto de enlaces. */
export function orderDownloadPageUrl(orderId: string): string | null {
  if (!env.PUBLIC_SITE_BASE_URL || !env.BOOKING_LINK_SECRET) return null;
  return `${env.PUBLIC_SITE_BASE_URL.replace(/\/+$/, "")}/pedido/descarga/${signOrderDownloadToken(orderId, env.BOOKING_LINK_SECRET)}`;
}
