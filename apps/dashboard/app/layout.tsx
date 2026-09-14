import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Impulza One — Panel",
  description: "Panel del propietario, colaboradores y modo agencia.",
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
