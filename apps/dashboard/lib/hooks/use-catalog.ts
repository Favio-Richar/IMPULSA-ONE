import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderStatusValue, ProductCategoryInput, ProductInput, UpdateProductInput } from "@impulza/validation";
import {
  createProduct,
  createProductCategory,
  deleteProduct,
  deleteProductCategory,
  listOrders,
  listProductCategories,
  listProducts,
  renameProductCategory,
  refundOrder,
  updateOrderStatus,
  updateProduct,
  type OrdersQuery,
} from "../api/catalog";

// Catálogo y pedidos (F5.5).

const catalogRoot = (organizationId: string, siteId: string) => ["catalog", organizationId, siteId] as const;
const ordersRoot = (organizationId: string) => ["orders", organizationId] as const;

/** Categorías y productos se muestran juntos: cualquier cambio invalida el catálogo del sitio. */
function useInvalidateCatalog(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: catalogRoot(organizationId, siteId) });
}

export function useProductCategories(organizationId: string, siteId: string) {
  return useQuery({ queryKey: [...catalogRoot(organizationId, siteId), "categories"], queryFn: () => listProductCategories(organizationId, siteId) });
}

export function useCreateProductCategory(organizationId: string, siteId: string) {
  const invalidate = useInvalidateCatalog(organizationId, siteId);
  return useMutation({ mutationFn: (body: ProductCategoryInput) => createProductCategory(organizationId, siteId, body), onSuccess: invalidate });
}

export function useRenameProductCategory(organizationId: string, siteId: string) {
  const invalidate = useInvalidateCatalog(organizationId, siteId);
  return useMutation({
    mutationFn: ({ categoryId, name }: { categoryId: string; name: string }) => renameProductCategory(organizationId, siteId, categoryId, { name }),
    onSuccess: invalidate,
  });
}

export function useDeleteProductCategory(organizationId: string, siteId: string) {
  const invalidate = useInvalidateCatalog(organizationId, siteId);
  return useMutation({ mutationFn: (categoryId: string) => deleteProductCategory(organizationId, siteId, categoryId), onSuccess: invalidate });
}

export function useProducts(organizationId: string, siteId: string) {
  return useQuery({ queryKey: [...catalogRoot(organizationId, siteId), "products"], queryFn: () => listProducts(organizationId, siteId) });
}

export function useCreateProduct(organizationId: string, siteId: string) {
  const invalidate = useInvalidateCatalog(organizationId, siteId);
  return useMutation({ mutationFn: (body: ProductInput) => createProduct(organizationId, siteId, body), onSuccess: invalidate });
}

export function useUpdateProduct(organizationId: string, siteId: string) {
  const invalidate = useInvalidateCatalog(organizationId, siteId);
  return useMutation({
    mutationFn: ({ productId, changes }: { productId: string; changes: UpdateProductInput }) => updateProduct(organizationId, siteId, productId, changes),
    onSuccess: invalidate,
  });
}

export function useDeleteProduct(organizationId: string, siteId: string) {
  const invalidate = useInvalidateCatalog(organizationId, siteId);
  return useMutation({ mutationFn: (productId: string) => deleteProduct(organizationId, siteId, productId), onSuccess: invalidate });
}

export function useOrders(organizationId: string, query: OrdersQuery) {
  return useQuery({
    queryKey: [...ordersRoot(organizationId), query],
    queryFn: () => listOrders(organizationId, query),
    placeholderData: keepPreviousData,
  });
}

/** Cambiar un pedido mueve stock: se invalidan los pedidos y los catálogos de la organización. */
export function useUpdateOrderStatus(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: OrderStatusValue }) => updateOrderStatus(organizationId, orderId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ordersRoot(organizationId) });
      void queryClient.invalidateQueries({ queryKey: ["catalog", organizationId] });
    },
  });
}

export function useRefundOrder(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, amount }: { orderId: string; amount?: number }) => refundOrder(organizationId, orderId, amount),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ordersRoot(organizationId) });
    },
  });
}
