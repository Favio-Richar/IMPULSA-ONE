import type { OrderListResponse, OrderResponse, ProductCategoryResponse, ProductFileUploadResponse, ProductResponse } from "@impulza/contracts";
import type { OrderStatusValue, ProductCategoryInput, ProductInput, RequestProductFileUploadInput, UpdateProductInput } from "@impulza/validation";
import { apiFetch } from "../api-client";

// Catálogo y pedidos (F5.5).

function base(organizationId: string, siteId: string): string {
  return `/organizations/${organizationId}/sites/${siteId}/catalog`;
}

// Archivo en venta de un producto digital (F5.11b, ADR-015).

function fileBase(organizationId: string, siteId: string, productId: string): string {
  return `${base(organizationId, siteId)}/products/${productId}/file`;
}

export function requestProductFileUpload(organizationId: string, siteId: string, productId: string, body: RequestProductFileUploadInput): Promise<ProductFileUploadResponse> {
  return apiFetch<ProductFileUploadResponse>(fileBase(organizationId, siteId, productId), { method: "POST", body });
}

export function confirmProductFile(organizationId: string, siteId: string, productId: string, fileId: string): Promise<ProductResponse> {
  return apiFetch<ProductResponse>(`${fileBase(organizationId, siteId, productId)}/${fileId}/confirm`, { method: "POST" });
}

export function removeProductFile(organizationId: string, siteId: string, productId: string): Promise<ProductResponse> {
  return apiFetch<ProductResponse>(fileBase(organizationId, siteId, productId), { method: "DELETE" });
}

export function listProductCategories(organizationId: string, siteId: string): Promise<ProductCategoryResponse[]> {
  return apiFetch<ProductCategoryResponse[]>(`${base(organizationId, siteId)}/categories`);
}

export function createProductCategory(organizationId: string, siteId: string, body: ProductCategoryInput): Promise<ProductCategoryResponse> {
  return apiFetch<ProductCategoryResponse>(`${base(organizationId, siteId)}/categories`, { method: "POST", body });
}

export function renameProductCategory(organizationId: string, siteId: string, categoryId: string, body: ProductCategoryInput): Promise<ProductCategoryResponse> {
  return apiFetch<ProductCategoryResponse>(`${base(organizationId, siteId)}/categories/${categoryId}`, { method: "PATCH", body });
}

export function deleteProductCategory(organizationId: string, siteId: string, categoryId: string): Promise<void> {
  return apiFetch<void>(`${base(organizationId, siteId)}/categories/${categoryId}`, { method: "DELETE" });
}

export function listProducts(organizationId: string, siteId: string): Promise<ProductResponse[]> {
  return apiFetch<ProductResponse[]>(`${base(organizationId, siteId)}/products`);
}

export function createProduct(organizationId: string, siteId: string, body: ProductInput): Promise<ProductResponse> {
  return apiFetch<ProductResponse>(`${base(organizationId, siteId)}/products`, { method: "POST", body });
}

export function updateProduct(organizationId: string, siteId: string, productId: string, body: UpdateProductInput): Promise<ProductResponse> {
  return apiFetch<ProductResponse>(`${base(organizationId, siteId)}/products/${productId}`, { method: "PATCH", body });
}

export function deleteProduct(organizationId: string, siteId: string, productId: string): Promise<void> {
  return apiFetch<void>(`${base(organizationId, siteId)}/products/${productId}`, { method: "DELETE" });
}

export interface OrdersQuery {
  siteId?: string;
  status?: OrderStatusValue;
  page: number;
}

export function listOrders(organizationId: string, query: OrdersQuery): Promise<OrderListResponse> {
  const params = new URLSearchParams({ page: String(query.page) });
  if (query.siteId) params.set("siteId", query.siteId);
  if (query.status) params.set("status", query.status);
  return apiFetch<OrderListResponse>(`/organizations/${organizationId}/orders?${params.toString()}`);
}

export function updateOrderStatus(organizationId: string, orderId: string, status: OrderStatusValue): Promise<OrderResponse> {
  return apiFetch<OrderResponse>(`/organizations/${organizationId}/orders/${orderId}`, { method: "PATCH", body: { status } });
}

/** Devolver el pago de un pedido cobrado con Mercado Pago (F5.11a). Sin `amount`: lo que queda. */
export function refundOrder(organizationId: string, orderId: string, amount?: number): Promise<OrderResponse> {
  return apiFetch<OrderResponse>(`/organizations/${organizationId}/orders/${orderId}/refund`, { method: "POST", body: amount === undefined ? {} : { amount } });
}
