import type { Metadata } from "next";
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
