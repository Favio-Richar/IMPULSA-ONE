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
    icons: branding.faviconUrl ? [{ rel: "icon", url: branding.faviconUrl }] : undefined,
  };
}

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
