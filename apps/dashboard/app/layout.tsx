import { PwaClient } from "@impulza/pwa";
import type { Metadata, Viewport } from "next";
import { brandCssVariables } from "@impulza/validation";
import { getPlatformBranding } from "../lib/api/branding";
import { Providers } from "./providers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getPlatformBranding();
  return {
    title: `${branding.name} — Panel`,
    description: "Panel del propietario, colaboradores y modo agencia.",
    icons: {
      // `icon` siempre con valor (igual que apps/web): con solo `apple`, Next no inyecta ningún favicon.
      icon: branding.faviconUrl ? [{ url: branding.faviconUrl }] : [{ url: "/icons/icon-192.png" }],
      apple: "/icons/apple-touch-icon.png",
    },
  };
}

// F10.5: color de la barra del sistema cuando se abre como app instalada.
export const viewport: Viewport = { themeColor: "#0f766e" };

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // El color de marca configurado por el propietario (F9.1) sobrescribe los tokens de la interfaz.
  // `brandCssVariables` valida cada color como hexadecimal: nada sin validar llega a un <style>.
  const branding = await getPlatformBranding();
  const brandCss = brandCssVariables(branding.primaryColor, branding.secondaryColor);
  return (
    <html lang="es">
      <head>{brandCss ? <style>{brandCss}</style> : null}</head>
      <body>
        <Providers>{children}</Providers>
        {/* F10.5: registra el service worker, avisa de versiones nuevas (sin activarlas solas) y ofrece instalar la app. */}
        <PwaClient showInstall className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background px-4 py-3 text-sm text-foreground shadow-lg" />
      </body>
    </html>
  );
}
