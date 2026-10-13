import type { PublicSeoResponse } from "@impulza/contracts";

// Termina de armar los datos estructurados (schema.org) que ya resolvió la API (F11, "SEO
// avanzado", decisión del propietario 2026-10-13): les agrega `url`/`mainEntityOfPage` con la
// base pública de este proceso -- igual que el resto del SEO (`seo-metadata.ts`), nunca con el
// header `Host` de la petición (CLAUDE.md: una URL de SEO mal armada es manipulable, no solo un
// bug cosmético) -- y agrega un `BreadcrumbList` cuando la página no es el inicio del sitio.
//
// `baseUrl` llega por parámetro (no se importa `lib/env.ts` acá) a propósito: así este módulo se
// puede probar sin que la prueba dependa de que las variables de entorno de todo el proceso estén
// cargadas -- mismo criterio que `seo-metadata.ts`, que tampoco importa `env`.
//
// NOTA DE SEGURIDAD (la misma que ../components/json-ld.tsx): los nodos que devuelve esto llegan
// a `JSON.stringify` dentro de un `<script type="application/ld+json">`, nunca escapados de otra
// forma -- el que los imprime (`JsonLd`) es quien escapa `<` para que un texto del propietario del
// sitio (nombre, pregunta de FAQ...) no pueda cerrar la etiqueta antes de tiempo.

/** El primer nodo de negocio (`Organization`/`LocalBusiness`) que ya resolvió la API, si hay uno
 *  -- siempre lo hay salvo que `structuredData` venga vacío (una respuesta en caché de antes de
 *  F11, sin este campo). */
function withEntityUrl(nodes: PublicSeoResponse["structuredData"], url: string): Array<Record<string, unknown>> {
  const [first, ...rest] = nodes ?? [];
  if (!first) {
    return [];
  }
  return [{ ...first, url }, ...rest];
}

function breadcrumbList(
  siteName: string,
  page: { title: string; isHome: boolean; url: string },
  siteHomeUrl: string,
): Record<string, unknown> | null {
  if (page.isHome) {
    return null;
  }
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: siteName, item: siteHomeUrl },
      { "@type": "ListItem", position: 2, name: page.title, item: page.url },
    ],
  };
}

/**
 * Datos estructurados listos para `<script type="application/ld+json">`, uno por nodo (Google
 * recomienda varios `<script>` antes que un solo arreglo `@graph` cuando los nodos son
 * independientes entre sí, que es el caso acá: negocio, FAQ, eventos y servicios no se referencian
 * entre ellos).
 */
export function siteStructuredData(
  seo: Pick<PublicSeoResponse, "structuredData" | "canonicalPath" | "title">,
  site: { name: string; isHome: boolean; homePath: string },
  baseUrl: string,
): Array<Record<string, unknown>> {
  const pageUrl = `${baseUrl}${seo.canonicalPath}`;
  const withUrl = withEntityUrl(seo.structuredData, pageUrl);
  const breadcrumb = breadcrumbList(site.name, { title: seo.title, isHome: site.isHome, url: pageUrl }, `${baseUrl}${site.homePath}`);
  return breadcrumb ? [...withUrl, breadcrumb] : withUrl;
}
