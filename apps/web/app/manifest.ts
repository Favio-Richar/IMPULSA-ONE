import { buildManifest } from "@impulza/pwa";
import type { MetadataRoute } from "next";

// App instalable del sitio de la plataforma (F10.5). Cada sitio de un negocio tiene el suyo en `/:sitio/manifest.webmanifest`.
export default function manifest(): MetadataRoute.Manifest {
  return buildManifest({
    name: "Impulza One",
    description: "Tu portal biográfico, tu mini-CRM y tu analítica en un solo enlace.",
    startUrl: "/",
    scope: "/",
    themeColor: "#0f766e",
    backgroundColor: "#ffffff",
  });
}
