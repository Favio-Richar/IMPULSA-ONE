# ADR-027 — Estrategia de animaciones y microinteracciones para la Fase 8

- **Estado:** Aceptado
- **Fecha:** 2026-10-02
- **Fase:** 8 — Experiencia

## Contexto

La Fase 8 agrega animaciones y microinteracciones a tres superficies: el sitio comercial
(`apps/web`), el constructor/panel (`apps/dashboard`) y el onboarding. El Plan Maestro (§9.4)
exige "animaciones discretas" y la dirección visual (§15) pide estética limpia sin saturación.

Hoy el proyecto ya tiene tres enfoques de animación:

1. **Framer Motion** (`framer-motion@13.4.6`) — solo en `apps/web`, usado en `HeroCarousel`
   (ADR-014). Pesado (~33 kB gzip), pero ya está en el bundle del sitio comercial.
2. **CSS puro con `@keyframes` y `transition`** — en `blocks-renderer` (`site-block-enter`),
   en `apps/web` (`Reveal`, `ImageStreamHero`, `marketing-float`) y en `apps/dashboard`
   (`motion-rise`, `motion-pop`).
3. **Three.js** (ADR-009) — solo para la escena 3D decorativa de la portada comercial.

## Decisión

### Motor de animación por superficie

| Superficie | Motor | Razón |
|---|---|---|
| `apps/web` (sitio comercial) | Framer Motion (ya instalado) + CSS | Framer ya está; las transiciones entre secciones del hero y el carrusel lo aprovechan. Las animaciones de scroll sencillas (`Reveal`) siguen en CSS puro. |
| `apps/dashboard` (panel, constructor, onboarding) | CSS puro (`@keyframes` + `transition` de Tailwind) | No introducir Framer Motion ni otra librería de animación en el panel. Las microinteracciones (fade-in al cambiar de paso, pop al guardar, rise al añadir bloque) se resuelven con clases CSS reutilizables. |
| `packages/blocks-renderer` (página pública del cliente) | CSS puro (existente: `site-block-enter`) | Mantiene el bundle del renderer mínimo. No se añaden dependencias. |

### No se introduce ninguna librería nueva

`framer-motion` ya está autorizado en `apps/web` (ADR-014). No se instala en `apps/dashboard`.
No se introduce `gsap`, `anime.js`, `react-spring` ni ninguna otra librería de animación.

### Reglas de accesibilidad (WCAG 2.2 AA)

1. **`prefers-reduced-motion: reduce`**: toda animación se apaga o se reduce a un cambio
   instantáneo (≤50 ms). En CSS: las animaciones van dentro de
   `@media (prefers-reduced-motion: no-preference) { … }`. En Framer Motion:
   `useReducedMotion()` ya está en uso (ADR-014).
2. **Sin contenido dependiente de animación**: ningún texto, botón o elemento interactivo depende
   de que una animación termine para ser visible o accesible. Los elementos empiezan visibles en el
   DOM y la animación es decorativa.
3. **WCAG 2.2.2 (Pausa, Detener, Ocultar)**: toda animación que dure más de 5 segundos o que sea
   continua debe tener un control de pausa accesible (ya cumplido en `HeroScene` y
   `ImageStreamHero`).
4. **Sin parpadeo**: ninguna animación cambia de opaco a transparente más de 3 veces por segundo
   (WCAG 2.3.1).

### Patrón de animaciones en el panel (`apps/dashboard`)

Se definen 4 clases utilitarias en `apps/dashboard/app/globals.css` (2 ya existen):

| Clase | Efecto | Duración | Uso |
|---|---|---|---|
| `.motion-rise` | `translateY(8px) → none`, `opacity: 0 → 1` | 400 ms | Entrada de bloques, tarjetas, pasos del onboarding |
| `.motion-pop` | `scale(0.6) → 1.08 → 1` | 500 ms | Confirmaciones, insignias, guardado |
| `.motion-fade` (nueva) | `opacity: 0 → 1` | 300 ms | Transición suave entre pasos del onboarding |
| `.motion-slide-left` (nueva) | `translateX(16px) → 0`, `opacity: 0 → 1` | 350 ms | Paneles laterales, entrada de configuración |

Todas envueltas en `@media (prefers-reduced-motion: no-preference)`.

### Rendimiento

- Solo `transform` y `opacity` para animaciones (no `width`, `height`, `top`, `left`).
- `will-change: transform` solo donde sea necesario y se retira al terminar.
- Sin layout shifts: los elementos animados tienen dimensiones reservadas antes de la animación.
- Las capturas de Playwright se toman con las animaciones terminadas (esperar transición o
  `animation-fill-mode: both`).

## Alternativas consideradas

1. **Instalar Framer Motion en `apps/dashboard`**: aumenta el bundle del panel en ~33 kB gzip
   para animaciones que CSS puro resuelve igual de bien. Rechazada.
2. **Usar CSS `@starting-style`**: solo disponible en Chrome 117+ y Firefox 129+. Rechazada por
   compatibilidad con Safari < 18.2.
3. **View Transitions API**: solo en Chrome y Edge. Rechazada por compatibilidad.
4. **No añadir animaciones**: el producto se siente estático en el panel y el onboarding, y el
   Plan Maestro las exige explícitamente. Rechazada.

## Consecuencias

- El bundle de `apps/dashboard` no crece.
- El sitio comercial usa Framer Motion donde ya está; las animaciones nuevas de scroll usan el
  patrón `Reveal` de CSS que ya existe.
- Si en el futuro se necesitan animaciones complejas en el panel (ej: transiciones de layout entre
  vistas), se evaluará una librería ligera en un ADR nuevo.
- Todas las capturas de Playwright deben esperar a que las animaciones terminen antes de capturar.
