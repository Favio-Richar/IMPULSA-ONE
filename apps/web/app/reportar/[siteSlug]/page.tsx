import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportAbuseForm } from "../../../components/report-abuse-form";
import { getPublicSite } from "../../../lib/api";

// Reporte de abuso (F9.9d): la página a la que lleva el enlace «Reportar esta página» de cada sitio. Nunca se indexa
// ni se cachea: es un formulario, y un sitio despublicado debe dejar de ofrecerlo en el acto (404).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reportar una página",
  robots: { index: false, follow: false },
};

export default async function ReportarPage({ params }: { params: Promise<{ siteSlug: string }> }) {
  const { siteSlug } = await params;
  const site = await getPublicSite(siteSlug);
  if (!site) {
    notFound();
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <ReportAbuseForm siteSlug={site.slug} siteName={site.name} />
    </main>
  );
}
