import type { NextConfig } from "next";
// Se importa por su efecto: valida el entorno apenas se carga este archivo, que es lo primero que
// `next dev`/`build`/`start` ejecutan — el equivalente más cercano a "validar al iniciar" que
// permite la arquitectura de Next.js (CLAUDE.md, no negociable). Sin esto, una variable faltante
// solo se descubriría a mitad de la primera petición real.
import "./lib/env";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
