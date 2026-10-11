import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MEMBER_TOKEN_PATTERN } from "@impulza/validation";
import { MemberEnterCard } from "../../../components/member-enter-card";

// Enlace de acceso de un miembro (F10.1): el enlace es una credencial. Nunca se indexa, nunca se cachea y no se comparte con
// terceros (sin referer). El canje ocurre con un clic (POST), no al abrir la página.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Acceso de miembros",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function MiembrosPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Una forma que no puede ser un token ni se pregunta: 404, igual que cualquier ruta inexistente.
  if (!MEMBER_TOKEN_PATTERN.test(token)) {
    notFound();
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <MemberEnterCard token={token} />
    </main>
  );
}
