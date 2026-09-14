import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Impulza One",
  description: "Sitio comercial y páginas públicas de Impulza One.",
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
