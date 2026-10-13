import type { MetadataRoute } from "next";
import { env } from "../lib/env";

// Sitemap del sitio de la PLATAFORMA (marketing): rutas públicas y estáticas, siempre las mismas
// para cualquier visitante. No incluye los sitios de los negocios ([siteSlug]) -- esos son de cada
// organización y no son contenido de este dominio comercial.
//
// `priority`/`changeFrequency` (F11, "SEO avanzado"): una señal relativa de qué tan seguido
// revisar cada ruta, nunca una promesa de ranking -- Google documenta que las ignora para decidir
// posición, pero las sigue usando para presupuestar el rastreo. El inicio y las páginas de
// conversión (planes, plantillas, producto) cambian más seguido que un documento legal.
const CONVERSION_ROUTES = new Set(["/producto", "/plantillas", "/planes"]);

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/producto", "/plantillas", "/planes", "/soluciones", "/recursos", "/integraciones", "/terminos", "/privacidad"];

  return routes.map((route) => ({
    url: `${env.PUBLIC_WEB_BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" || CONVERSION_ROUTES.has(route) ? "weekly" : "monthly",
    priority: route === "" ? 1 : CONVERSION_ROUTES.has(route) ? 0.8 : 0.5,
  }));
}
