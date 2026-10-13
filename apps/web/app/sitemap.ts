import type { MetadataRoute } from "next";
import { env } from "../lib/env";

// Sitemap del sitio de la PLATAFORMA (marketing): rutas públicas y estáticas, siempre las mismas
// para cualquier visitante. No incluye los sitios de los negocios ([siteSlug]) -- esos son de cada
// organización y no son contenido de este dominio comercial.
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/producto", "/plantillas", "/planes", "/soluciones", "/recursos", "/integraciones", "/terminos", "/privacidad"];

  return routes.map((route) => ({
    url: `${env.PUBLIC_WEB_BASE_URL}${route}`,
    lastModified: new Date(),
  }));
}
