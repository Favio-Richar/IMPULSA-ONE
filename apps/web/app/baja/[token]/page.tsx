import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UnsubscribeCard } from "../../../components/unsubscribe-card";
import { getUnsubscribe } from "../../../lib/unsubscribe";

// Baja de campañas (F5.6): la página a la que lleva el enlace de cada correo. El enlace es una
// credencial: nunca se indexa, nunca se cachea, y no se comparte con terceros (sin referer).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Darse de baja",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function BajaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await getUnsubscribe(token);
  if (state === null) {
    notFound();
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      {state === "unavailable" ? (
        <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Darse de baja</h1>
          <p className="mt-2 text-sm text-slate-700">No pudimos cargar esta página ahora. Intenta de nuevo en un momento.</p>
        </section>
      ) : (
        <UnsubscribeCard token={token} initial={state} />
      )}
    </main>
  );
}
