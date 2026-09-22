import type { ImgHTMLAttributes } from "react";

interface SiteImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> {
  image: { url: string; alt: string; decorative?: boolean };
}

/**
 * Una sola regla para las cinco imágenes del catálogo (perfil, hero, image, gallery,
 * testimonios): `decorative: true` no oculta la imagen, pide `alt=""` para que un lector de
 * pantalla la omita (WCAG 1.1.1) en vez de anunciar un texto irrelevante. `alt` es obligatorio en
 * el esquema (F2.4) justo para que esta decisión nunca dependa de que alguien se acuerde de
 * ponerlo.
 *
 * `<img>` y no `next/image` a propósito: cada bloque de imagen trae una URL que eligió el dueño
 * del sitio (F2.4, `safeUrlSchema` solo exige http/https, no un dominio conocido de antemano).
 * `next/image` necesita declarar cada host permitido en `images.remotePatterns` — admitir
 * cualquiera anularía esa protección. Optimizar estas imágenes queda para una fase posterior,
 * probablemente junto a la biblioteca multimedia propia (PM §9.6). Este paquete tampoco depende de
 * Next.js: lo consumen tanto el render público (apps/web) como la vista previa del constructor
 * (apps/dashboard, F2.9).
 */
export function SiteImage({ image, ...rest }: SiteImageProps) {
  return <img src={image.url} alt={image.decorative ? "" : image.alt} {...rest} />;
}
