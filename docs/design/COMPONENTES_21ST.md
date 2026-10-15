# Componentes de 21st.dev integrados en el sistema

Cómo se adapta un componente de 21st.dev (u otro catálogo de demos React) a Impulza One, con los dos casos ya hechos.

## Dónde van y por qué no en `/components/ui`

Las instrucciones de 21st.dev asumen un proyecto shadcn de una sola app con los componentes en `/components/ui`. Impulza One es
un monorepo (ADR-001) con **dos sistemas de componentes distintos a propósito**:

| Paquete | Para qué | Tokens |
|---|---|---|
| `packages/ui` (`@impulza/ui`) | El panel, la administración y el sitio comercial: el "shadcn adaptado" del proyecto. Cumple el papel de `/components/ui`. | `--color-*` (fijos) |
| `packages/blocks-renderer` | Lo que ve el **visitante** en la página pública de cada cliente y en la vista previa del constructor. No depende de Next.js. | `--site-*` (por sitio) |

Un componente pensado para la página pública **no se copia a `/components/ui`**: se convierte en un diseño (o un bloque) de
`packages/blocks-renderer`, para que la página pública y la vista previa del editor muestren exactamente lo mismo y para que tome
los colores, radio, sombra y fuentes del tema de cada sitio. Copiarlo a una carpeta `components/ui` de una app lo dejaría fuera
de la página pública y con colores fijos.

## Reglas de adaptación (obligatorias)

1. **TypeScript estricto**, sin `any` ni props sin tipo.
2. **Contenido del negocio, nunca el del demo**: ni nombres, cuentas, correos, coordenadas, relojes ni imágenes de terceros.
   Las fotos de ejemplo de las plantillas son de Unsplash y se verifican con una petición real antes de usarlas.
3. **Tokens del tema** (`--site-*`) en vez de colores fijos.
4. **WCAG 2.2 AA**: teclado, foco visible, nombres accesibles, contraste verificado en el peor caso, pausa del movimiento
   automático (2.2.2) y respeto de "reducir movimiento".
5. **Sin aleatoriedad en el render** (servidor y navegador dibujan lo mismo) y **sin JavaScript se ve el contenido**.
6. **Rendimiento**: animaciones con un solo `requestAnimationFrame` que escribe en el DOM, no estado de React por cuadro;
   detenidas fuera de pantalla.
7. **Dependencias revisadas, también su licencia.** GSAP **no se usa**: su licencia estándar prohíbe usarlo en herramientas que
   permiten crear animaciones con una interfaz visual o que compiten con Webflow (decisión de Favio, 2026-10-14).
8. **Sin bloques nuevos si alcanza un diseño de uno existente** (un valor más en su `layout`, opcional y compatible).

## Integrados

### Esfera de imágenes (`img-sphere`) → galería, diseño «Esfera 3D» (`layout: "sphere"`)

- Archivo: `packages/blocks-renderer/src/blocks/gallery-sphere.tsx`; esquema: `gallerySchema.layout` en `@impulza/validation`.
- Fibonacci con variación fija por índice; con menos de 18 fotos se repiten (las copias no se anuncian ni se enfocan).
- Arrastre con inercia, flechas del teclado, giro automático con botón «Pausar giro», visor `<dialog>` nativo (foco atrapado,
  Escape cierra). Sin JavaScript: cuadrícula.
- Se usa en: `contenido-suscripcion`, `evento-unico`, `chef-catering`, `estudio-tatuajes` (páginas internas).

### Portafolio musical (`music-portfolio`) → vitrina, diseño «Índice con portada» (`layout: "index"`)

- Archivo: `packages/blocks-renderer/src/blocks/showcase-index.tsx`; esquema: `showcaseSchema.layout`.
- Cada fila es una pieza de la vitrina (título, subtítulo, insignia, portada, enlace). Al pasar o **enfocar** una fila, su portada
  aparece de fondo bajo un velo negro al 78 % y el texto pasa a blanco (≥ 7:1 sobre cualquier foto); el texto se "descifra" con
  un efecto propio (sin GSAP). Una sola ola de la lista al entrar en pantalla (< 2 s). En teléfono, miniatura por fila.
- Sin el reloj, las coordenadas ni las redes del demo.
- Se usa en: `video-corto-creador`, `fotografia-bodas`, `musica-podcast`, `corredor-propiedades`, `freelancer-diseno`.

Pruebas: `packages/blocks-renderer/src/blocks/portal-layouts.test.tsx` y `packages/e2e/tests/plantillas-portales.spec.ts`.
