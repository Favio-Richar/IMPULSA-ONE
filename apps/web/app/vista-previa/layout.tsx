import type { Metadata } from "next";

// Vista previa temporal compartida desde el asistente: nunca debe indexarse.
export const metadata: Metadata = {
  title: "Vista previa — Impulza One",
  robots: { index: false, follow: false },
};

export default function VistaPreviaLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <>{children}</>;
}
