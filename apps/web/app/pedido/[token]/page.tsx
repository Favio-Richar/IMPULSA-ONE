import { Container } from "@impulza/blocks-renderer";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderStatus } from "../../../components/order-status";
import { SiteShell } from "../../../components/site-shell";
import { getPublicSite } from "../../../lib/api";
import { getOrderStatus } from "../../../lib/order-status";

// "Tu pedido" (F5.9): a donde vuelve el comprador desde Mercado Pago y a donde lleva el enlace del
// correo. El enlace es una credencial: nunca se indexa, nunca se cachea, sin referer.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu pedido",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PedidoPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const query = await searchParams;
  // Mercado Pago vuelve con `payment_id` (o `collection_id` en integraciones antiguas).
  const raw = query.payment_id ?? query.collection_id;
  const paymentId = typeof raw === "string" ? raw : undefined;
  const order = await getOrderStatus(token, paymentId);
  if (order === null) {
    notFound();
  }
  if (order === "unavailable") {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">Tu pedido</h1>
        <p className="mt-2 text-sm">No pudimos cargar tu pedido ahora. Intenta de nuevo en un momento.</p>
      </main>
    );
  }
  const refreshHref = `/pedido/${encodeURIComponent(token)}${paymentId && /^\d{1,30}$/.test(paymentId) ? `?payment_id=${paymentId}` : ""}`;
  const site = await getPublicSite(order.siteSlug);
  const content = (
    <Container className="py-10">
      <OrderStatus order={order} refreshHref={refreshHref} />
    </Container>
  );
  return site ? <SiteShell site={site}>{content}</SiteShell> : <main>{content}</main>;
}
