# ADR-014: Portadas del sitio comercial con corredor de fotos y carrusel editorial (framer-motion)

- **Estado:** Aceptado
- **Fecha:** 2026-09-30
- **Fuente:** pedido del propietario (chat del 2026-09-30): usar dos componentes de referencia
  (`image-stream-hero` y `hero-carousel`) en el sitio web público de Impulza One.

## Contexto

El sitio comercial (`apps/web`) no traía librería de animación (el `Reveal` usa CSS y el hero 3D usa
three.js, ADR-009). El carrusel pedido usa `framer-motion` (resortes, arrastre y salidas animadas).

## Decisión

1. Los componentes viven en `apps/web/components/ui/` (convención shadcn) con `cn` en
   `apps/web/lib/utils.ts` (sin dependencias).
2. **Home:** el corredor de fotos (`ImageStreamHero`, solo CSS 3D) es la portada, con el `h1` y los
   botones principales encima; la sección anterior (mosaico, teléfono y constelación three.js de
   ADR-009) sigue debajo como "Así se ve tu portal".
3. **/plantillas:** el carrusel editorial (`HeroCarousel`) es la portada: una diapositiva por cada
   plantilla real del catálogo, con solo funciones que ya existen.
4. Se agrega `framer-motion` **13.4.6** (versión fija) solo en `apps/web`: lo usa únicamente el
   carrusel de /plantillas (no entra en el paquete de la home).
5. Fotos de Unsplash (licencia que permite uso comercial) enlazadas desde su CDN, revisadas una por
   una; se descartó una con marca comercial visible. Nunca las imágenes de demostración del prompt.

## Cambios respecto del código de referencia (defectos corregidos)

- Movimiento reducido no funcionaba en el corredor: el `animation` en línea reiniciaba
  `animation-play-state` y le ganaba a la regla del sistema. Se usa `!important`.
- El corredor se mueve sin fin: se agrega un botón visible de pausa (WCAG 2.2.2).
- El carrusel capturaba la rueda del mouse (trampa de scroll en medio de una página): apagado por
  defecto (`wheel`). Se agregan botones Anterior/Siguiente (en teléfono no hay teclado) y textos de
  accesibilidad en español.
- El título del carrusel se leía "Cafés yrestaurantes" (líneas en bloque sin espacio): `aria-label`.
- El código recibido tenía `split("\n")` roto en dos líneas (no compilaba).

## Consecuencias

- Positivas: portada más atractiva y centrada en negocios reales; accesible y probada
  (`sitio-portadas.spec.ts`, `sitio-comercial.spec.ts`).
- Negativas: una dependencia más (~40 KB gz en /plantillas); fotos servidas por un tercero (Unsplash).
- Seguimiento: si se agrega una política CSP al sitio comercial, permitir `images.unsplash.com` en
  `img-src` o servir las fotos desde nuestro almacenamiento (R2).
