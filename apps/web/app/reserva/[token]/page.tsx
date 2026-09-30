import { Container } from "@impulza/blocks-renderer";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingManage } from "../../../components/booking-manage";
import { SiteShell } from "../../../components/site-shell";
import { getPublicSite } from "../../../lib/api";
import { getManagedBooking } from "../../../lib/booking-manage";

// "Tu reserva" (F5.4): la página a la que lleva el enlace del correo. El enlace es una credencial:
// nunca se indexa, nunca se cachea, y no se comparte con terceros (sin referer).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu reserva",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ReservaPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  // Al volver de pagar la seña, Mercado Pago agrega `payment_id` (o `collection_id`).
  const query = await searchParams;
  const raw = query.payment_id ?? query.collection_id;
  const paymentId = typeof raw === "string" && /^\d{1,30}$/.test(raw) ? raw : undefined;
  const booking = await getManagedBooking(token, paymentId);
  if (booking === null) {
    notFound();
  }
  if (booking === "unavailable") {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">Tu reserva</h1>
        <p className="mt-2 text-sm">No pudimos cargar tu reserva ahora. Intenta de nuevo en un momento.</p>
      </main>
    );
  }
  const site = await getPublicSite(booking.siteSlug);
  const content = (
    <Container className="py-10">
      <BookingManage token={token} initial={booking} refreshHref={`/reserva/${encodeURIComponent(token)}${paymentId ? `?payment_id=${paymentId}` : ""}`} />
    </Container>
  );
  // Con el tema del negocio si su página está publicada; si no, igual se puede gestionar.
  return site ? <SiteShell site={site}>{content}</SiteShell> : <main>{content}</main>;
}
