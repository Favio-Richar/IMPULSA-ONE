import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewsletterConfirmCard } from "../../../components/newsletter-confirm-card";
import { getNewsletterConfirmation } from "../../../lib/newsletter";

// Confirmación de la newsletter (F7.4, ADR-019): la página a la que lleva el enlace del correo. El
// enlace es una credencial: nunca se indexa, nunca se cachea y no se comparte con terceros.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirmar suscripción",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SuscripcionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await getNewsletterConfirmation(token);
  if (state === null) {
    notFound();
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      {state === "unavailable" ? (
        <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Confirmar suscripción</h1>
          <p className="mt-2 text-sm text-slate-700">No pudimos cargar esta página ahora. Intenta de nuevo en un momento.</p>
        </section>
      ) : (
        <NewsletterConfirmCard token={token} initial={state} />
      )}
    </main>
  );
}
