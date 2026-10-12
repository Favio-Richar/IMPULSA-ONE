import { buildManifest } from "@impulza/pwa";
import type { MetadataRoute } from "next";

// App instalable del panel (F10.5): se abre como aplicación, con su propio ícono y sin la barra del navegador.
export default function manifest(): MetadataRoute.Manifest {
  return buildManifest({
    name: "Impulza One — Panel",
    description: "Panel del propietario, colaboradores y modo agencia.",
    startUrl: "/",
    scope: "/",
    themeColor: "#0f766e",
    backgroundColor: "#ffffff",
  });
}
