import { Container } from "@impulza/blocks-renderer";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MembershipStatus } from "../../../components/membership-status";
import { SiteShell } from "../../../components/site-shell";
import { getPublicSite } from "../../../lib/api";
import { getMembershipStatus } from "../../../lib/memberships";

// «Tu membresía» (F10.2): a donde vuelve el comprador desde Mercado Pago y a donde lleva el enlace del correo. El enlace es una
// credencial: nunca se indexa, nunca se cachea, sin referer.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu membresía",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function MembresiaPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const query = await searchParams;
  // Mercado Pago vuelve con `payment_id` (o `collection_id` en integraciones antiguas).
  const raw = query.payment_id ?? query.collection_id;
  const paymentId = typeof raw === "string" ? raw : undefined;
  const status = await getMembershipStatus(token, paymentId);
  if (status === null) {
    notFound();
  }
  if (status === "unavailable") {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">Tu membresía</h1>
        <p className="mt-2 text-sm">No pudimos cargar tu compra ahora. Intenta de nuevo en un momento.</p>
      </main>
    );
  }
  const refreshHref = `/membresia/${encodeURIComponent(token)}${paymentId && /^\d{1,30}$/.test(paymentId) ? `?payment_id=${paymentId}` : ""}`;
  const site = await getPublicSite(status.siteSlug);
  const content = (
    <Container className="py-10">
      <MembershipStatus status={status} refreshHref={refreshHref} />
    </Container>
  );
  return site ? <SiteShell site={site}>{content}</SiteShell> : <main>{content}</main>;
}
