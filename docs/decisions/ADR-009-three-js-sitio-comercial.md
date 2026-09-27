# ADR-009: Usar three.js para gráficos 3D, solo en el sitio comercial de Impulza

- **Estado:** Aceptado
- **Fecha:** 2026-09-27
- **Fuente:** pedido explícito de Favio en el chat (2026-09-27): "el sistema debe ser desarrollado con
  lógica y diseño avanzado y herramientas muy buenas, como three.js". Se le propuso limitarlo al
  sitio comercial y respondió "me parece perfecto, adelante".

## Contexto

El stack aprobado (`CLAUDE.md`, `docs/architecture/ARCHITECTURE.md`) no incluye una librería 3D. El
propietario pidió un nivel visual más avanzado con herramientas como three.js. Hay tres superficies
web con reglas distintas:

- **Página pública del cliente final** (`apps/web/app/[siteSlug]`): se abre sobre todo desde el
  navegador de Instagram/TikTok en teléfonos, con presupuesto de rendimiento medido en PP7 y la
  dirección visual de ADR-008.
- **Panel** (`apps/dashboard`) y superadministración (`apps/admin`): herramientas de trabajo, fondo
  claro y sobrio.
- **Sitio comercial de Impulza** (`apps/web`, rutas `/`, `/producto`, `/plantillas`, `/planes`):
  la vitrina del producto; es donde un efecto visual aporta a la venta.

## Decisión

1. Se agrega `three` (versión exacta, `apps/web`) para escenas 3D **solo en el sitio comercial**.
   Primera escena: la "constelación de enlaces" del hero de la portada.
2. Se usa three.js directo, sin `@react-three/fiber` ni `drei`: una escena decorativa no necesita un
   reconciliador de React y así se suma una sola dependencia.
3. Reglas de carga y accesibilidad (obligatorias para cualquier escena futura):
   - `three` se importa de forma dinámica en el cliente, después del primer pintado y cuando el
     navegador está ocioso: nunca entra en el paquete inicial ni retrasa el LCP.
   - Sin WebGL, con `Save-Data` o si la escena falla, queda el fondo CSS de siempre; nada se rompe.
   - Con `prefers-reduced-motion: reduce` se pinta un cuadro fijo y no hay animación.
   - Se pausa fuera de pantalla y con la pestaña oculta; la densidad baja en teléfonos y la
     resolución se limita (`devicePixelRatio` ≤ 2).
   - Es decoración: `aria-hidden`, sin eventos de puntero, y nunca pasa por detrás del texto con
     intensidad que afecte el contraste WCAG 2.2 AA (se enmascara fuera de la columna de texto).
   - Toda la geometría (posiciones, conexiones, calidad según dispositivo) vive en funciones puras
     con pruebas unitarias; el componente solo dibuja.

## Alternativas consideradas

- **`@react-three/fiber` + `drei`:** más cómodo para escenas interactivas grandes, pero suma dos
  dependencias y un reconciliador para una escena decorativa de pocos objetos. Se reconsidera si
  llega una escena interactiva compleja (p. ej. un configurador 3D).
- **Solo CSS/SVG (lo que había):** liviano, pero no alcanza el nivel visual pedido.
- **Video pregrabado:** pesa más que la escena, no reacciona al puntero y no se adapta al tema.
- **Usarlo también en la página pública del cliente:** descartado por rendimiento en teléfonos y
  navegadores de apps (PP7); si se quisiera, requiere un ADR nuevo con medición.

## Consecuencias

- Positivas: portada con una escena 3D propia, sin costo en el primer pintado; patrón reutilizable
  (carga diferida + fallback + movimiento reducido) para otras páginas del sitio comercial.
- Negativas: ~150 kB comprimidos más, cargados después; WebGL gasta batería mientras la escena está
  en pantalla (mitigado con pausa y densidad por dispositivo).
- Seguimiento: revisar si Lighthouse móvil de la portada baja de 90 en rendimiento o si el TBT sube
  más de 100 ms respecto de la versión sin escena.

## Restricciones asociadas

- `three` no se importa en `app/[siteSlug]`, `components/site-*`, `packages/blocks-renderer`,
  `apps/dashboard` ni `apps/admin` sin un ADR nuevo.
- Ninguna escena se importa de forma estática: siempre `import("three")` dentro del cliente.
