import type { NextConfig } from "next";
// Se importa por su efecto: valida el entorno apenas se carga este archivo, que es lo primero que
// `next dev`/`build`/`start` ejecutan — el equivalente más cercano a "validar al iniciar" que
// permite la arquitectura de Next.js (CLAUDE.md, no negociable). Sin esto, una variable faltante
// solo se descubriría a mitad de la primera petición real.
import { env } from "./lib/env";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // CSP y cabeceras de seguridad en todas las respuestas (ST §15, ADR-016).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          development: process.env.NODE_ENV === "development",
          https: env.PUBLIC_WEB_BASE_URL.startsWith("https://"),
          mediaOrigin: env.STORAGE_PUBLIC_BASE_URL ?? null,
          storageOrigin: env.STORAGE_ENDPOINT ?? null,
        }),
      },
    ];
  },
};

export default nextConfig;
