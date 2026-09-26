# Backlog — Catálogo de plantillas (PL)

Origen: `PLAN_MAESTRO_PLATAFORMA_IDENTIDAD_DIGITAL.md` §7.4 (Plantillas: buscador, filtros por
industria/objetivo/estilo/color, galería, preview, "Usar esta plantilla") y ERD (`Template`,
pendiente — nunca se implementó). Decisión de dirección visual: `docs/decisions/ADR-008-direccion-visual-link-in-bio.md`.

**Brecha confirmada el 2026-09-26:** no existe ningún modelo `Template` en
`packages/database/prisma/schema.prisma`. Hoy solo existen `Theme` (color/tipografía) y el
`background` de `Site` (fondo). Una plantilla es la combinación de ambos más un set inicial de
bloques y copy de ejemplo por rubro — eso es lo que falta.

Cada historia cumple la Definición de Terminado general (`CLAUDE.md`) más sus criterios propios.

**Decisiones de Favio al arrancar (2026-09-26, en el chat), ante contradicciones detectadas:**

1. **Boceto vs ADR-008.** El texto de `docs/design/perfil-impulza-mockup.html` dice "no botones
   apilados" y lo presenta como reemplazo de la "lista de enlaces"; ADR-008 pide la pila de botones a
   lo ancho. Decisión: **ambos combinados** — estructura de ADR-008 (avatar sobre portada, pila de
   botones a lo ancho y del mismo alto) con la jerarquía del boceto (un solo botón principal
   destacado, el resto secundario, y tarjetas de servicio/precio y reseñas debajo cuando el rubro
   las usa). El texto del boceto se toma como histórico.
2. **Onboarding.** PL4 pide el selector "en el onboarding (PM §8.2.7)", que no existía. Decisión:
   **construir el onboarding que indica el plan maestro** (§8.2), con el paso de plantilla incluido
   (ver PL4).
3. **Tipografía.** El boceto usa Fraunces desde Google Fonts. Decisión: **Fraunces alojada en el
   propio sitio** (OFL, como las demás fuentes), nunca desde Google.

## Estado

| Historia | Estado |
|---|---|
| PL1 — Modelo `Template` y migración | Lista para tu revisión (sin UI: se revisa por API y pruebas) |
| PL2 — Familia de temas "Editorial oscuro" (ADR-008) | Lista para tu revisión (capturas mostradas en el chat) |
| PL3 — Catálogo semilla de plantillas por rubro | Lista para tu revisión (capturas en la galería de PL4) |
| PL4 — Selector de plantillas en onboarding y constructor | Lista para tu revisión (capturas en `docs/design/capturas/pl4/`) |
| PL5 — Rediseño del bloque de perfil y la pila de botones (patrón enlace en bio) | Lista para tu revisión (capturas mostradas en el chat) |

### Bitácora de avance (para retomar)

Orden obligatorio: PL2 → PL5 → PL1 → PL3 → PL4. Cada entrada dice dónde quedó el trabajo.

- **2026-09-26 — PL1 terminada** (commit `feat(templates): ... (PL1)`), en "Lista para tu revisión".
  Siguiente: PL3.
- **2026-09-26 — PL3 terminada** (commit `feat(templates): catalogo semilla ... (PL3)`), en "Lista
  para tu revisión". 7 plantillas sembradas. Siguiente: PL4.
- **2026-09-26 — PL4 en progreso.** Hecho el servidor (commit `d8bcef6`): `POST .../pages/:pageId/apply-template`
  con personalización, 409 `UNPUBLISHED_CHANGES`, apariencia anterior para deshacer, auditoría y
  e2e con aislamiento. Falta: onboarding de 11 pasos (panel) y selector en el constructor.
- **2026-09-26 — PL4 terminada** (commit `feat(onboarding): ... (PL4)`), en "Lista para tu
  revisión". **Todo el backlog PL1-PL5 queda en "Lista para tu revisión"**: nada está marcado como
  terminado hasta tu aprobación. Siguiente: tu revisión de PL2, PL5, PL1, PL3 y PL4.
- Notas de entorno de esta sesión (no son de PL1-PL4): (1) con `packages/database/.env` presente,
  Prisma recarga variables y falla `revalidate-web.service.test.ts` ("no llama a nada si
  WEB_APP_URL…"); sin ese archivo pasa. (2) `admin.e2e.test.ts` "quitar la marca directo en la
  base…" falló una vez en la corrida completa y pasó en las siguientes (3/3 aislada, y la suite
  completa después); parece depender del reloj del código 2FA. Quedan para revisar aparte.

### PL1 — Modelo `Template` y migración
**Criterios de aceptación:**
- Nuevo modelo Prisma `Template`: `id`, `code`, `name`, `description`, `industryTags[]`,
  `objectiveTags[]` (captar/vender/reservar/mostrar/compartir, PM §7.1.4), `themeCode` (FK lógica a
  `THEME_CATALOG`), `background` (mismo esquema que `Site.background`), `previewImageUrl`,
  `blocksSeed` (JSON: lista ordenada de bloques con config de ejemplo, mismo formato que
  `PageVersion`/`BlockVersion`), `family` (reutiliza `ThemeFamily` + la nueva familia oscura).
- Migración reversible, sin tocar `Site`/`Page`/`Block` existentes.
- `blocksSeed` se valida con los mismos esquemas Zod de bloques que usa el constructor — una
  plantilla con un bloque inválido no puede guardarse.

> **Estado (2026-09-26): lista para revisión de Favio.** No tiene pantalla: se revisa por la API
> (`GET /api/v1/templates`) y las pruebas.
>
> - **Esquema** `templateSchema` (`packages/validation/src/templates/index.ts`): los campos pedidos
>   más `sortOrder` (orden de galería). `blocksSeed` pasa por `BLOCK_CATALOG` (tipo conocido, versión
>   vigente, config válida), la regla de texto alternativo de PP2, a lo sumo una acción principal y
>   solo en un bloque de acción (PP5), y un formulario siempre sin conectar (`formId: null`).
>   `family` tiene que ser la del tema. Etiquetas cerradas: `TEMPLATE_INDUSTRIES` (segmentos de PM
>   §4) y `TEMPLATE_OBJECTIVES`.
> - **Fondo limitado a color o degradado** (`templateBackgroundSchema`): una foto o un video
>   necesitan un archivo de la biblioteca de la organización y sus tonos medidos para verificar AA;
>   una plantilla no puede traer medios de nadie.
> - **Modelo** `Template` / tabla `templates`, catálogo global sin `organizationId`. Migración
>   `20260926060434_pl1_templates` solo aditiva, con `down.sql`; probado aplicar → revertir →
>   reaplicar en Postgres 18. Sin FK desde `Site`/`Page` (ver nota en `ERD.md`): aplicar copia.
> - **API** `GET /api/v1/templates` (filtros `industry`, `objective`, `family`, combinables; valor
>   fuera del catálogo = 400) y `GET /api/v1/templates/:code`. Sin sesión, como el catálogo de
>   planes (la galería del onboarding se ve antes de tener organización); límite de tasa por IP
>   (60/120 por minuto). Cada fila se revalida al leer: una rota se omite de la lista, responde
>   404 en el detalle y deja un log estructurado `error` con el campo exacto. La respuesta trae el
>   tema con sus tokens para pintar la vista previa sin otra petición. OpenAPI regenerado.
> - **Seed**: `TEMPLATE_CATALOG` + `templateSchema.parse` antes de cada upsert (una plantilla
>   inválida detiene el seed); nunca borra filas. El catálogo se llena en PL3.
> - **Pruebas**: 16 unitarias del esquema y 6 e2e (contrato, orden, filtros, 400, 404, fila rota
>   omitida, límite de tasa). Aislamiento entre organizaciones: no aplica, no hay datos de tenant.

### PL2 — Familia de temas "Editorial oscuro" (ADR-008)
**Criterios de aceptación:**
- Al menos 3 temas nuevos en `THEME_CATALOG` (`packages/validation/src/themes/catalog.ts`), familia
  nueva (p. ej. `"oscuro"`), fondo oscuro, que pasan la misma batería de contraste AA que el resto
  (`themes.test.ts`).
- El test `"todos los fondos son claros"` se actualiza para excluir explícitamente esta familia por
  nombre, dejando un comentario que referencia ADR-008 — nunca se relaja el número de contraste.
- Estos temas se combinan por defecto con uno de los degradados oscuros ya existentes
  (`medianoche`, `grafito`, `ciruela`) o con fondo de imagen/video + overlay oscuro (ya soportado).

> **Estado (2026-09-26): lista para revisión de Favio.**
>
> - **Línea `oscuro`** (`THEME_FAMILIES`), 4 temas: **Noche** (negro cálido, botón principal claro
>   como el boceto; degradado `grafito`), **Índigo** (lavanda; `medianoche`), **Esmeralda** (menta;
>   `bosque`) y **Ciruela** (coral; `ciruela`). Márgenes de contraste amplios: texto 14,7–17,6:1,
>   texto secundario sobre tarjeta ≥ 8,6:1, primario como texto sobre fondo ≥ 7,5:1.
> - **Pareja tipográfica `editorial`**: Fraunces (títulos) + Inter (texto), Fraunces alojada en el
>   propio sitio (`@fontsource-variable/fraunces`, OFL, 36 KB el subconjunto latino), nunca desde
>   Google (decisión 3 de arriba).
> - **Fondo por defecto del tema** (`defaultBackground` + `backgroundForDisplay`): un sitio con tema
>   oscuro y sin fondo propio se ve con su degradado; solo presentación, nada se guarda en el sitio
>   y el panel sigue mostrando "Del tema" como elección.
> - **Pruebas:** "todos los fondos son claros" excluye **por nombre** la línea `oscuro` (comentario
>   con ADR-008), sin tocar ningún umbral; prueba nueva de que la línea oscura es realmente oscura,
>   con títulos editoriales y degradado. **Matriz tema × fondo** (`theme-background-matrix.test.ts`):
>   los 15 temas sobre los 13 fondos ofrecidos (del tema, 8 degradados, color claro y oscuro, foto
>   con capa oscura y clara) = 195 combinaciones, verificando AA para el texto directo sobre cada
>   color del fondo (ambos extremos de un degradado; el peor tono de una foto bajo su capa) y para
>   tarjetas y botones; más la consistencia de las capas aceptadas sobre una foto desconocida.
>   Confirmado que la matriz falla (16 casos) si un degradado oscuro se marca con texto oscuro.
> - **Panel:** la sección "Apariencia" muestra la línea "Oscuro" primero.

### PL3 — Catálogo semilla de plantillas por rubro
**Criterios de aceptación:**
- Mínimo 6 plantillas semilla cubriendo: Profesional/Servicios, Café/Gastronomía, Comercio/Retail,
  Creador/Personal (con el tema oscuro de PL2), Salud/Bienestar, Eventos/Turismo — alineadas a los
  segmentos de `PLAN_MAESTRO` §4.
- Cada plantilla trae: bloque `profile` con headline/bio de ejemplo (marcado claramente como
  contenido de ejemplo, nunca dato real de un tercero), 1-2 bloques `link`/`whatsapp`, un bloque
  `service` o `gallery` según el rubro, `social`, y `faq` cuando el rubro lo justifique.
- Ningún texto, logo ni imagen de Linktree/Beacons/Stan ni de las cuentas usadas como referencia —
  contenido íntegramente ficticio (ver restricción de ADR-008).
- Seed en `packages/database/prisma/seed.ts`, igual que `THEME_CATALOG` hoy.

> **Estado (2026-09-26): lista para revisión de Favio.** Las capturas de cada plantilla renderizada
> salen de la galería de PL4 (ahí se ven en tamaño real, móvil y escritorio).
>
> - **7 plantillas** en `TEMPLATE_CATALOG` (`packages/validation/src/templates/catalog.ts`):
>
>   | Código | Rubro | Tema | Fondo | Acción principal |
>   |---|---|---|---|---|
>   | `profesional-servicios` | Profesional/Servicios | Ejecutivo marino | del tema | WhatsApp |
>   | `cafe-gastronomia` | Café/Gastronomía | Editorial | degradado Arena | WhatsApp |
>   | `comercio-tienda` | Comercio/Retail | Vibrante coral | del tema | WhatsApp |
>   | `creador-personal` | Creador/Personal | **Oscuro Noche** (PL2) | degradado Grafito del tema | Enlace |
>   | `salud-bienestar` | Salud/Bienestar | Océano | degradado Brisa | WhatsApp |
>   | `eventos-turismo` | Eventos/Turismo | **Oscuro Índigo** (PL2) | degradado Medianoche del tema | WhatsApp |
>   | `belleza-barberia` | Barbería y belleza (extra, PM §4) | Ejecutivo grafito | del tema | WhatsApp |
>
> - **Composición** (decisión 1: estructura ADR-008 + jerarquía del boceto): perfil, **una** acción
>   principal, 1 enlace secundario, tarjetas de servicio con precio de ejemplo en CLP, reseñas y
>   preguntas frecuentes donde el rubro las usa, y la fila de redes al final.
> - **Contenido ficticio y marcado**: nombres "Tu …", bio que empieza con "Texto de ejemplo",
>   precios, reseñas y respuestas "de ejemplo"; enlaces a `example.com` (dominio reservado para
>   ejemplos), redes a la portada de cada red (nunca una cuenta), teléfono de relleno
>   `+56900000000`. Sin imágenes: el perfil muestra el monograma (PP8) hasta que el cliente sube su
>   foto. Sin formulario de contacto: sin conectar se vería vacío en la página publicada.
> - **Contraste**: todas las combinaciones tema + fondo usadas están dentro de la matriz AA de PL2
>   (`theme-background-matrix.test.ts`, 15 temas × 13 fondos).
> - **Pruebas**: `catalog.test.ts` verifica cada criterio sobre el catálogo real (≥ 6, los 6 rubros,
>   creador oscuro, perfil primero con texto de ejemplo, 1-2 enlaces/WhatsApp con una sola acción
>   principal, servicio o galería, redes, sin URLs de terceros ni cuentas reales, sin nombrar a
>   Linktree/Beacons/Stan). Seed idempotente comprobado (dos corridas, 7 filas). E2E: la API sirve
>   el catálogo completo sin omitir ninguna plantilla.

### PL4 — Selector de plantillas en onboarding y constructor
**Criterios de aceptación:**
- Paso de plantilla en el onboarding (PM §8.2.7): galería con filtro por industria/objetivo/estilo,
  preview a tamaño real (móvil y escritorio), acción "Usar esta plantilla" que crea el `Site` con el
  `theme`, `background` y bloques iniciales de la plantilla elegida — editables de inmediato, nunca
  bloqueados a la plantilla de origen.
- Accesible también desde el constructor para un sitio ya publicado, con confirmación explícita
  antes de reemplazar los bloques actuales (acción destructiva reversible vía historial de
  versiones, ya existente).
- Estados de carga/vacío/error; responsive.

> **Estado (2026-09-26): lista para revisión de Favio.** Capturas (móvil y escritorio) en
> `docs/design/capturas/pl4/`.
>
> - **Onboarding de 11 pasos** en `/bienvenida` (PM §8.2, decisión 2): tipo de cuenta → objetivo →
>   industria → nombre visible → dirección (sugerida desde el nombre, validada con
>   `publicSlugSchema`) → redes y enlaces → plantilla → perfil y acción principal → vista previa →
>   publicación → checklist. Marco propio sin barra lateral, barra de progreso, foco al título en
>   cada paso. El borrador vive en `sessionStorage` (sobrevive a una recarga, se descarta si entra
>   otra cuenta). Entradas: el inicio sin organización ("Empezar con el asistente", la creación
>   manual sigue debajo) y la lista de sitios ("Crear con una plantilla"; "Crear sitio" vacío sigue).
> - **Galería** (onboarding y constructor): filtros por industria, objetivo y estilo (arrancan con lo
>   elegido en los pasos 2 y 3), miniatura real de cada plantilla, vista previa **a tamaño real**
>   (móvil 390 px, escritorio 1280 px; si no cabe se reduce proporcionalmente y lo indica) y "Usar
>   esta plantilla". Carga, vacío (con "Ver todas") y error con reintento.
> - **Vista previa = lo que se guarda**: la personalización se aplica con `personalizeTemplateBlocks`
>   (`@impulza/validation`), la misma función que usa la API al guardar, y se pinta con el mismo
>   `SiteBackdrop` + `PageBlocks` del sitio público.
> - **Publicación (paso 10)**: crea la organización (solo si no hay ninguna; si no, usa la activa),
>   el sitio, aplica la plantilla y publica, por los endpoints de siempre. Cada resultado queda en el
>   borrador: "Reintentar" sigue desde donde falló sin duplicar nada. Dirección tomada → vuelve al
>   paso 5 con el aviso; límite de plan → aviso con enlace a planes; "Guardar sin publicar" también.
> - **Checklist (paso 11)**: QR (→ Enlaces y QR), analítica, primer contacto (→ constructor, bloque
>   Formulario) y dominio propio marcado "Próximamente": todavía no existe esa función en el panel
>   (no se inventó una pantalla).
> - **Constructor**: botón "Usar una plantilla" → galería → confirmación explícita (cuántos bloques
>   se reemplazan; casilla para aplicar también tema y fondo, avisando que se ven en vivo) → si la
>   API responde `UNPUBLISHED_CHANGES`, segundo paso que explica qué se pierde ("Descartar los
>   cambios y aplicar" o cancelar para publicar antes). Después: aviso con enlace al historial de
>   versiones (bloques) y **"Deshacer tema y fondo"** (vuelve a los anteriores que devolvió la API).
> - **API** (commit `d8bcef6`): `POST .../pages/:pageId/apply-template` (ver arriba y OpenAPI). Se
>   sumó `personalization.primaryLink` para las plantillas cuya acción principal es un enlace.
> - **Corrección en `blocks-renderer`**: `PageBlocks` acepta `primaryActionBar={false}` (por defecto
>   `true`: el sitio público y el constructor no cambian). Las miniaturas lo usan: con varias en la
>   misma pantalla, el ancla `#accion-principal` se repetía y la barra fija del teléfono aparecía
>   duplicada sobre la miniatura.
> - **Pruebas**: unitarias de la personalización y `slugify`; 8 e2e de API (incluye aislamiento
>   entre organizaciones); Playwright `plantillas.spec.ts` en móvil y escritorio (onboarding completo
>   hasta la página publicada con los datos del usuario, validaciones de nombre/dirección/WhatsApp,
>   vista previa a 390/1280 px, sin scroll horizontal; constructor con 409, descarte, tema aplicado y
>   deshecho). Cada prueba usa su propia cuenta: el sitio del fixture no se toca.
> - **Decisiones menores a revisar**: (1) el tipo de cuenta, objetivo e industria se guardan en la
>   auditoría (`page.template_applied`), no en columnas nuevas: nada los consume todavía y el modo
>   agencia es de otra fase; (2) "Importación de redes" = pegar las direcciones (la red se reconoce
>   sola); conectarse a las cuentas es de Integraciones (PM §9.15); (3) el filtro por **color** de PM
>   §7.4 no está (el backlog pide industria/objetivo/estilo); (4) al aplicar una plantilla desde el
>   constructor, el perfil vuelve al contenido de ejemplo ("Tu Nombre"): se edita en el bloque.

### PL5 — Rediseño del bloque de perfil y la pila de botones (patrón enlace en bio)
**Criterios de aceptación:**
- **Reservas y toda acción "abrir un sistema interno" (agendar, cotizar, etc.) se muestran como un botón más de la misma pila uniforme** (ícono/miniatura + texto, mismo alto y estilo que el resto), nunca como una tarjeta aparte con su propio mini-botón de texto fijo tipo "Reserva tu mesa". El botón es configurable: solo aparece si el propietario del sitio activa esa función, y su acción es abrir el flujo interno de reservas (modal o pantalla propia dentro del sitio), no un enlace externo. Esto aplica a cualquier bloque con acción interna (reserva, cotización rápida, cita), no solo al de gastronomía.
- `ProfileBlock` (`packages/blocks-renderer/src/blocks/profile.tsx`) y los componentes de botón
  (`link-button.tsx`, `stack-button.tsx`) se ajustan a la estructura de ADR-008: portada a sangre,
  avatar superpuesto más grande, badge de verificado, pila de botones con ícono/miniatura fija a la
  izquierda y texto centrado, alto uniforme, variante "glass" opcional sobre fondo oscuro/foto.
- Sigue pasando `profile.test.tsx` y los tests de contraste — ninguna combinación tema+fondo puede
  bajar de AA.
- Revisado con las skills `design-critique` y `accessibility-review` antes de darse por terminado.

> **Estado (2026-09-26): lista para revisión de Favio.** Estructura de ADR-008 con la jerarquía del
> boceto (decisión 1 de arriba).
>
> - **Portada a sangre:** en una columna de teléfono ocupa todo el ancho y, si el perfil es el primer
>   bloque, toca el borde superior; en pantallas anchas queda redondeada en la columna. Por
>   *container query* (`styles/site.css`), así la vista previa del constructor en modo teléfono se ve
>   igual que un teléfono; el relleno de `Container` pasó también a container query.
> - **Avatar más grande** (128 px, antes 112) montado sobre la portada, con marco del color de fondo;
>   el monograma sin foto crece igual. Nombre en la fuente de títulos del tema + badge de verificado.
> - **Variante "glass"** (`buttonStyle: "glass"`, `GLASS_ALPHA` = 12 %): secundarios translúcidos
>   con el texto de la página y desenfoque; la acción principal sigue sólida. La usa el tema Índigo.
>   La matriz tema × fondo verifica AA de glass en las 195 combinaciones.
> - **Un solo primario** (boceto): con acción principal, WhatsApp y correo/teléfono bajan a
>   secundario en vez de competir en sólido; los enlaces conservan el estilo que eligió la persona.
> - **Tarjeta de servicio** como el boceto (imagen arriba, título y precio, texto, botón a lo ancho) y
>   **reseñas en carrusel** horizontal con `snap`, enfocable y con nombre (`role="region"`).
> - **Correcciones de accesibilidad encontradas en la revisión:**
>   - descripción de los botones con `opacity-80`: bajaba el contraste sin verificarlo — ahora el
>     mismo color que el título;
>   - contorno de foco: usaba el primario del tema, que sobre una foto oscurecida quedaba ≈ 2,6:1
>     (WCAG 1.4.11 pide 3:1). Ahora `--site-focus` = color de enlace de la página, fijado en la raíz
>     (verificado ≥ 4,5:1 contra cualquier fondo); dentro de una tarjeta, el primario del tema;
>   - video de fondo sin forma de pausarlo (WCAG 2.2.2): botón de pausa/reproducción de 44 px, fuera
>     de la capa decorativa, que refleja el estado **real** del video (en un teléfono puede no haber
>     arrancado; Chrome no reproduce videos silenciados fuera de pantalla).
> - **Auditoría medida en el navegador** (3 escenarios: Índigo glass, Claro profesional, Coral sobre
>   foto): un `h1`, `lang="es"`, foto con alternativo y portada decorativa, ningún enlace sin nombre,
>   ningún blanco de toque < 44 px, orden de tabulación lógico, sin desborde a 320 px (zoom 400 %).
> - **Revisión de diseño** (skill `design-critique`): encontró la competencia entre botones sólidos,
>   corregida arriba.
>
> **Verificación:** pruebas del render (glass solo en secundarios, sólido fuera de glass, descripción
> sin opacidad, carrusel accesible, un solo primario, portada a sangre en el CSS, `--site-focus`);
> Playwright: pausa del video y color de foco sobre video oscurecido (falla sin la corrección).
