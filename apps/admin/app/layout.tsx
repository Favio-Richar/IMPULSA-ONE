import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Impulza One — Administración",
  description: "Superadministración de la plataforma.",
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
