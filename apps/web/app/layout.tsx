import type { Metadata } from "next";
import { env } from "../lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: "Impulza One",
  description: "Sitio comercial y páginas públicas de Impulza One.",
  // Base para resolver toda URL relativa en metadata de cualquier segmento hijo — canonical y
  // Open Graph de cada sitio público (F2.8) mandan rutas relativas (`/mi-sitio/...`) y Next arma
  // la URL absoluta con esto, nunca con el header `Host` de la petición (ver `lib/env.ts`).
  metadataBase: new URL(env.PUBLIC_WEB_BASE_URL),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
