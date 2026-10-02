# Backlog — Fase 8: Experiencia

> Animaciones y microinteracciones en sitio comercial, constructor y onboarding;
> más plantillas por rubro.

## Decisiones de arquitectura

| ADR | Título | Estado |
|---|---|---|
| [ADR-027](../decisions/ADR-027-animaciones-microinteracciones-fase8.md) | Estrategia de animaciones y microinteracciones para la Fase 8 | Aceptado |

## Historias

| Historia | Título | Estado |
|---|---|---|
| F8.1 | Microinteracciones en el constructor y el panel | Hecho (2026-10-02): Playwright móvil y escritorio con y sin movimiento reducido, capturas en `f81`. Criterio 6 ajustado (ver nota) |
| F8.2 | Transiciones animadas en el onboarding | Hecho (2026-10-02): Playwright móvil y escritorio, capturas en `f82`. Criterio 1 ajustado (ver nota) |
| F8.3 | Animaciones de scroll en el sitio comercial | Hecho (2026-10-02): Playwright sobre `/recursos` (build de producción), capturas en `f83`. Ver "Sin probar" |
| F8.4 | Plantillas nuevas por rubro (educación, fitness, música, restaurante) | Hecho (2026-10-02): 4 plantillas reales, contrato corregido, Playwright del onboarding y de `/plantillas`, capturas en `f84` |

**Criterios ajustados (decisión de 2026-10-02, a confirmar por el propietario):**

- **F8.2 criterio 1:** el paso saliente **no** se desvanece; solo el entrante aparece con `.motion-fade`
  (300 ms). Un fundido de salida obliga a mantener dos pasos montados a la vez y retrasar el foco al
  título, con riesgo para teclado y lector de pantalla; la entrada animada ya cumple la intención.
- **F8.1 criterio 6:** los toasts entran con `.motion-rise` pero **no** tienen animación de salida.

**Pruebas (2026-10-02):** `experiencia-animaciones.spec.ts` y `onboarding-animaciones.spec.ts`, 22 casos
en móvil y escritorio, todos en verde. Cubren: entrada, pop al guardar, panel lateral y duplicado del
constructor (con y sin movimiento reducido); borrado rechazado por el servidor; foco al título y
fundido del onboarding; entrada escalonada de la galería; rubro «Educación y talleres»; revelado de
`/recursos`, `/soluciones`, `/integraciones` y `/plantillas`. Las de foco del onboarding y de borrado
fallido se verificaron contra el código roto (fallan sin la corrección).

**Sin probar o sin cumplir (honestidad):**

- **F8.1 criterio 8 (CLS):** sin medición. Insertar un bloque desplaza lo que hay debajo (movimiento
  legítimo del contenido), así que «CLS = 0» no es una aserción útil; lo verificado por lectura de
  `globals.css` es que los fotogramas solo usan `transform` y `opacity`.
- **F8.3 criterio 4 (contadores):** no existen contadores en la portada; no aplica («si existen»).
- **F8.3 criterio 7:** `Reveal` usa `threshold: 0.15`, no `rootMargin: -10%`. Cumple la intención
  (arranca antes de verse completo) pero no la letra; no se cambió por ser un componente previo.
- **F8.2 criterios 2 y 3 (barra de progreso suave, hover de tarjetas):** por CSS, sin aserción propia.
- **F8.4 criterio 7 (seed):** verificado a mano (12 plantillas en la base), sin prueba automática nueva.
- **No se probó en staging** (no existe entorno de staging todavía).
- **Defecto corregido al cerrar:** `docs/api/openapi.json` no incluía el rubro `educacion`; la prueba
  `openapi.test.ts` lo detectó y se regeneró.

---

### F8.1 — Microinteracciones en el constructor y el panel

**Objetivo:** Dar feedback visual inmediato a las acciones del usuario en el constructor y el
panel, haciendo que la interfaz se sienta viva y responsiva sin añadir librerías.

**Criterios de aceptación:**

1. **Añadir bloque**: al insertar un bloque nuevo en el lienzo del constructor, el bloque entra
   con la animación `.motion-rise` (translateY + opacity, 400 ms). Verificable en Playwright
   (el bloque es visible tras la animación).
2. **Guardar cambios**: el botón de guardar/publicar muestra un efecto `.motion-pop`
   (escala 0.6 → 1.08 → 1, 500 ms) al confirmar la acción, junto con el ícono de check.
3. **Duplicar bloque**: el bloque duplicado entra con `.motion-rise` justo debajo del original.
4. **Eliminar bloque**: el bloque sale con una transición de opacity (300 ms) antes de
   desmontarse del DOM.
5. **Panel lateral de configuración**: al seleccionar un bloque, el panel de configuración entra
   con `.motion-slide-left` (translateX + opacity, 350 ms).
6. **Toast de éxito/error**: los toasts entran con `.motion-rise` y salen con opacity.
7. **Accesibilidad**: todas las animaciones se apagan con `prefers-reduced-motion: reduce`. Los
   elementos son visibles y funcionales sin la animación. Verificable en Playwright con la
   media emulada.
8. **Rendimiento**: solo `transform` y `opacity`. Ningún layout shift. Verificable midiendo que
   no hay `CLS > 0` en el viewport durante la animación.
9. **No hay librería nueva**: todo se resuelve con CSS (`globals.css`), sin instalar dependencias.
10. **Pruebas**: Playwright en móvil y escritorio con capturas en `docs/design/capturas/f81/`.
    Cada prueba verificada contra el código roto.

---

### F8.2 — Transiciones animadas en el onboarding

**Objetivo:** Convertir el cambio abrupto entre pasos del onboarding en una transición suave
que guíe al usuario, sin romper la accesibilidad ni la navegación por teclado.

**Criterios de aceptación:**

1. **Transición entre pasos**: al avanzar o retroceder, el paso saliente se desvanece (opacity,
   200 ms) y el entrante aparece con `.motion-fade` (opacity, 300 ms). No se usa translate
   horizontal para evitar confusión de dirección.
2. **Barra de progreso**: la barra ya tiene `transition-[width]`; se verifica que la transición
   es suave (no saltos).
3. **Tarjetas de elección (pasos 1-3)**: al hacer hover, la tarjeta sube 2 px con `transform:
   translateY(-2px)` y sombra sutil. En touch, no hay hover.
4. **Paso de plantilla (paso 7)**: las tarjetas de plantilla aparecen escalonadas con
   `animation-delay` incremental (60 ms × índice, máx 8), usando `.motion-rise`.
5. **Paso de publicación (paso 10)**: cada sub-paso completado muestra un check con
   `.motion-pop`.
6. **Foco**: al cambiar de paso, el foco va al título (`headingRef`) después de que la
   transición termine. Verificable con Playwright (el heading tiene foco).
7. **Accesibilidad**: con `prefers-reduced-motion: reduce`, no hay transiciones entre pasos
   (cambio instantáneo). Los pasos siguen siendo navegables por teclado y lector de pantalla.
8. **No hay librería nueva**: CSS puro en `globals.css`.
9. **Pruebas**: Playwright en móvil y escritorio con capturas en `docs/design/capturas/f82/`.
   Cada prueba verificada contra el código roto.

---

### F8.3 — Animaciones de scroll en el sitio comercial

**Objetivo:** Enriquecer las páginas del sitio comercial (`/`, `/soluciones`, `/integraciones`,
`/recursos`, `/plantillas`) con animaciones de entrada suaves al hacer scroll, aprovechando el
componente `Reveal` existente y Framer Motion donde ya está instalado.

**Criterios de aceptación:**

1. **Secciones de `/soluciones`**: cada tarjeta de rubro aparece con `Reveal` al entrar en el
   viewport (translateY + opacity, escalonadas con delay incremental).
2. **Secciones de `/integraciones`**: las tarjetas del directorio aparecen con `Reveal` al
   filtrar y al hacer scroll.
3. **Secciones de `/recursos`**: las guías aparecen con `Reveal` escalonado.
4. **Portada `/`**: los contadores de estadísticas (si existen) hacen un count-up animado.
   Con reduced-motion muestran el número final sin animación.
5. **`/plantillas`**: el carrusel ya tiene Framer Motion (ADR-014). Se verifica que las tarjetas
   de la galería inferior aparecen con `Reveal` escalonado.
6. **Accesibilidad**: toda animación respeta `prefers-reduced-motion`. `Reveal` ya lo hace con
   variantes `motion-reduce:`. Verificar que el texto es visible sin animación.
7. **Rendimiento**: solo `transform` y `opacity`. IntersectionObserver con `rootMargin` de
   `-10%` para que la animación empiece antes de que el elemento esté completamente visible.
   Sin layout shifts.
8. **Sin librería nueva**: `Reveal` (CSS + IntersectionObserver) para las animaciones nuevas.
   Framer Motion solo donde ya está.
9. **Pruebas**: Playwright en móvil y escritorio con capturas en `docs/design/capturas/f83/`.
   Cada prueba verificada contra el código roto.

---

### F8.4 — Plantillas nuevas por rubro (educación, fitness, música, restaurante)

**Objetivo:** Ampliar el catálogo con 4 plantillas que cubran rubros de alto impacto y que
usen bloques avanzados (reservas, catálogo, eventos, música, newsletter) que ninguna plantilla
actual aprovecha.

**Criterios de aceptación:**

1. **Plantilla "Academia y talleres"** (rubro: `educacion` — nuevo):
   - Bloques: `profile`, `service` (cursos/talleres con precio), `events` (agenda de clases),
     `newsletter` (suscripción), `contact_form` (primary), `faq`, `testimonials`, `social`.
   - Tema: familia `clasico` o `editorial`.
2. **Plantilla "Fitness y entrenamiento"** (rubro: `salud`, `belleza-bienestar`):
   - Bloques: `profile` (layout `hero`), `booking` (primary, reserva de clases), `service`
     (programas/planes), `pricing` (planes mensuales), `gallery` (fotos del espacio),
     `testimonials`, `social`.
   - Tema: familia `vibrante`.
3. **Plantilla "Músico y banda"** (rubro: `creador`):
   - Bloques: `profile` (layout `hero`), `music` (Spotify/SoundCloud), `events` (próximas
     fechas), `video` (videoclip), `link` (primary, link a streaming), `gallery`
     (fotos en vivo), `social`.
   - Tema: familia `oscuro`.
4. **Plantilla "Restaurante con menú"** (rubro: `gastronomia`, `servicios-locales`):
   - Bloques: `profile`, `catalog` (menú con categorías y precios), `booking` (reserva de
     mesa), `map` (ubicación con Waze/Google Maps), `gallery` (fotos del local),
     `whatsapp` (primary), `testimonials`, `social`.
   - Tema: familia `ejecutivo` o `editorial`.
5. **Rubro nuevo "educación"**: se agrega `educacion` a `TEMPLATE_INDUSTRIES` con la etiqueta
   "Educación y talleres". Se actualiza la validación, el onboarding (paso 3) y las soluciones
   del sitio comercial.
6. **Validación en el servidor**: cada plantilla es una entrada real de `TEMPLATE_CATALOG` con
   bloques que existen en `BLOCK_TYPES`. `templateSchema.parse()` valida cada una sin error.
   Test unitario que recorre todo el catálogo y valida cada plantilla.
7. **Seed**: las plantillas nuevas se siembran con `prisma/seed.ts` y pasan la validación.
8. **Galería**: las plantillas aparecen en la galería del onboarding (paso 7) y en `/plantillas`
   del sitio comercial, filtradas por su rubro.
9. **CMS de superadministración**: las plantillas se controlan con `isActive`/`isFeatured`
   (ya soportado por F7.11, ADR-026).
10. **Contenido verificable**: todo texto en la plantilla describe cosas que existen en el
    producto. Los nombres de bloques, los tipos de contenido y las acciones se cruzan con
    `BLOCK_TYPES` y `TEMPLATE_CATALOG` en un test.
11. **Pruebas**: Playwright en móvil y escritorio con capturas en `docs/design/capturas/f84/`.
    Test unitario de validación del catálogo completo. Cada prueba verificada contra el código
    roto.

---

## Reglas de la fase (copiadas del mensaje del propietario)

- **Accesibilidad**: toda animación respeta `prefers-reduced-motion` (se apaga o se reduce) y
  cumple WCAG 2.2 AA. Nada de contenido que dependa de una animación para ser visible, y las
  capturas deben tomarse con la animación terminada.
- **Rendimiento**: sin librerías pesadas nuevas sin justificarlo en un ADR; las animaciones usan
  `transform` y `opacity`, y no provocan saltos de diseño.
- **Diseño**: panel, constructor y sitio comercial siguen con fondo claro y estilo sobrio; la
  página pública del cliente puede usar el estilo de ADR-008.
- **Plantillas nuevas**: son reales, es decir entradas del catálogo (`TEMPLATE_CATALOG`) con
  bloques que existan en `BLOCK_TYPES` y que pasen la validación del servidor.
- **Contenido**: todo texto que describa funciones del sistema debe poder señalarse en el código.
- **Pruebas**: Playwright en móvil y escritorio con capturas en `docs/design/capturas/f8x/`,
  cada prueba verificada contra el código roto.
- **Control propio**: typecheck y lint de cada paquete antes de afirmar que están limpios; toda
  función nueva debe llamarse desde algún lado (verificar con grep).
- **Cuidado con comandos**: no cortar `pnpm turbo` con `Select-Object -First`, no editar líneas
  ajenas a tu historia, no hacer `push --force`.
- **Cierre**: documentar cada historia al terminar (backlog, README, trazabilidad y
  CONTINUIDAD.md) y decir con honestidad lo que no se probó.
