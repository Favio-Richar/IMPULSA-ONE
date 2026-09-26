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
| PL1 — Modelo `Template` y migración | Pendiente |
| PL2 — Familia de temas "Editorial oscuro" (ADR-008) | Lista para tu revisión (capturas mostradas en el chat) |
| PL3 — Catálogo semilla de plantillas por rubro | Pendiente |
| PL4 — Selector de plantillas en onboarding y constructor | Pendiente |
| PL5 — Rediseño del bloque de perfil y la pila de botones (patrón enlace en bio) | Pendiente |

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

### PL5 — Rediseño del bloque de perfil y la pila de botones (patrón enlace en bio)
**Criterios de aceptación:**
- `ProfileBlock` (`packages/blocks-renderer/src/blocks/profile.tsx`) y los componentes de botón
  (`link-button.tsx`, `stack-button.tsx`) se ajustan a la estructura de ADR-008: portada a sangre,
  avatar superpuesto más grande, badge de verificado, pila de botones con ícono/miniatura fija a la
  izquierda y texto centrado, alto uniforme, variante "glass" opcional sobre fondo oscuro/foto.
- Sigue pasando `profile.test.tsx` y los tests de contraste — ninguna combinación tema+fondo puede
  bajar de AA.
- Revisado con las skills `design-critique` y `accessibility-review` antes de darse por terminado.
