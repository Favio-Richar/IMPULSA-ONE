import { PwaClient } from "@impulza/pwa";
import type { Metadata } from "next";
import { getPlatformBranding } from "../lib/api";
import { env } from "../lib/env";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getPlatformBranding();
  return {
    title: {
      default: branding.name,
      template: `%s — ${branding.name}`,
    },
    description: `Sitio comercial y páginas públicas de ${branding.name}.`,
    metadataBase: new URL(env.PUBLIC_WEB_BASE_URL),
    // F11: `icons.icon` siempre debe traer un valor -- si este objeto se declara aquí con SOLO
    // `apple`, Next deja de inyectar el favicon por convención de archivo (`app/icon.png`) para el
    // resto, así que una organización/plataforma sin favicon propio (el caso por defecto, ver
    // `DEFAULT_PLATFORM_BRANDING.faviconUrl === null`) terminaba sin ningún favicon. Por eso el
    // respaldo es explícito, no un objeto vacío.
    icons: {
      icon: branding.faviconUrl ? [{ url: branding.faviconUrl }] : [{ url: "/icon.png" }],
      apple: "/icons/apple-touch-icon.png",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        {children}
        {/* F10.5: registra el service worker y avisa cuando hay una versión nueva (nunca la activa sola). */}
        <PwaClient className="fixed inset-x-0 bottom-0 z-50 border-t border-[#d1d5db] bg-white px-4 py-3 text-sm text-[#111827] shadow-lg" />
      </body>
    </html>
  );
}
