import type { MetadataRoute } from "next";
import { env } from "../lib/env";

// Robots del sitio de la PLATAFORMA: permite indexar las páginas comerciales y los sitios publicados
// de cada negocio ([siteSlug]), pero no las rutas transaccionales o con token en la URL (no aportan
// nada a un buscador y algunas son de un solo uso -- ver "Secretos en la URL" en docs/CONTINUIDAD.md).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/baja", "/qr/", "/s/", "/pedido", "/reserva", "/informe", "/membresia", "/miembros", "/suscripcion"],
    },
    sitemap: `${env.PUBLIC_WEB_BASE_URL}/sitemap.xml`,
  };
}
