import { mediaSrcSet } from "@impulza/validation";
import type { ImgHTMLAttributes } from "react";

/** Ancho del contenido de la página pública (`Container`: 34 rem = 544 px menos el relleno, PP8). */
const CONTENT_SIZES = "(min-width: 544px) 496px, calc(100vw - 32px)";

interface SiteImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "srcSet"> {
  image: { url: string; alt: string; decorative?: boolean };
  /** Imagen que se ve al abrir la página (perfil, portada): se pide primero y sin espera. */
  priority?: boolean;
}

/**
 * Una sola regla para todas las imágenes del catálogo (perfil, hero, image, gallery, servicio,
 * testimonios):
 *
 * - `decorative: true` no oculta la imagen: pide `alt=""` para que un lector de pantalla la omita
 *   (WCAG 1.1.1) en vez de anunciar un texto irrelevante.
 * - Una imagen de la biblioteca propia (PP2, ADR-006) se sirve con `srcset`: el teléfono baja la
 *   variante de 400 u 800 px, no la de 1600. Una URL externa se usa tal cual.
 * - Perezosa por defecto; `priority` para la que se ve al abrir la página (presupuesto LCP < 2,5 s).
 *
 * `<img>` y no `next/image` a propósito: este paquete no depende de Next.js (lo usan el render
 * público y la vista previa del constructor), y las variantes ya vienen optimizadas desde el worker.
 */
export function SiteImage({ image, priority = false, sizes = CONTENT_SIZES, ...rest }: SiteImageProps) {
  const srcSet = mediaSrcSet(image.url);
  return (
    <img
      src={image.url}
      srcSet={srcSet ?? undefined}
      sizes={srcSet ? sizes : undefined}
      alt={image.decorative ? "" : image.alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      {...rest}
    />
  );
}
