import { Container } from "@impulza/blocks-renderer";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DownloadPanel } from "../../../../components/download-panel";
import { SiteShell } from "../../../../components/site-shell";
import { getPublicSite } from "../../../../lib/api";
import { getDownload } from "../../../../lib/download";

// Descarga del archivo comprado (F5.11b, ADR-015): a donde lleva el enlace del correo de pago. El
// enlace es una credencial: nunca se indexa, nunca se cachea, sin referer.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu descarga",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function DescargaPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const query = await searchParams;
  const download = await getDownload(token);
  if (download === null) {
    notFound();
  }
  if (download === "unavailable") {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">Tu descarga</h1>
        <p className="mt-2 text-sm">No pudimos cargar tu descarga ahora. Intenta de nuevo en un momento.</p>
      </main>
    );
  }
  const error = typeof query.error === "string" ? query.error : null;
  const site = await getPublicSite(download.siteSlug);
  const content = (
    <Container className="py-10">
      <DownloadPanel token={token} download={download} error={error} />
    </Container>
  );
  return site ? <SiteShell site={site}>{content}</SiteShell> : <main>{content}</main>;
}
