import type { Metadata } from "next";
import { brandCssVariables } from "@impulza/validation";
import { getPlatformBranding } from "../lib/api/branding";
import { Providers } from "./providers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getPlatformBranding();
  return {
    title: `${branding.name} — Panel`,
    description: "Panel del propietario, colaboradores y modo agencia.",
    icons: branding.faviconUrl ? [{ url: branding.faviconUrl }] : undefined,
  };
}

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
      </body>
    </html>
  );
}
