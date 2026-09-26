# Prompt para Claude Code — dirección visual tipo Linktree/Beacons + catálogo de plantillas

Pega esto tal cual en Claude Code, dentro del repositorio de Impulza One.

---

Favio tomó una decisión de producto que revierte una recomendación anterior: la página pública debe
adoptar el patrón visual de las apps de enlace en bio de referencia (Linktree, Beacons), no el tema
sobrio que estaba aprobado. Esto ya quedó documentado formalmente — léelo primero, en este orden:

1. `docs/decisions/ADR-008-direccion-visual-link-in-bio.md` — la decisión completa, contexto y
   restricciones (nunca copiar logos/marca/contenido real de esas plataformas ni de las cuentas de
   referencia; solo la estructura y jerarquía visual).
2. `CLAUDE.md`, sección "No negociables de UI/UX" (actualizada 2026-09-26) — el alcance exacto:
   este cambio es **solo para la página pública del sitio del cliente final**, el dashboard/admin/sitio
   comercial de Impulza siguen con el estilo sobrio original.
3. `docs/BACKLOG_PLANTILLAS.md` — el backlog nuevo (PL1–PL5) que implementa esto.
4. `docs/research/ANALISIS_MERCADO_2026-09.md` (con su nota final) — contexto de por qué existía la
   recomendación contraria, para que entiendas el trade-off, no para que lo cuestiones.

Ya inspeccioné el código real antes de escribir esto, así que parte de esto no es nuevo para ti:

- El motor de fondo (`packages/validation/src/backgrounds/index.ts`, `SiteBackdrop` en
  `packages/blocks-renderer`) ya soporta imagen/video con overlay oscuro verificado AA, y ya existen
  degradados oscuros (`medianoche`, `grafito`, `ciruela`, `bosque`). Esto no se reconstruye.
- `THEME_CATALOG` (`packages/validation/src/themes/catalog.ts`) tiene 11 temas, los 11 de fondo
  claro. Falta la familia oscura (PL2).
- No existe ningún modelo `Template` en `schema.prisma` — solo `Theme` y el `background` de `Site`.
  Eso es lo que PL1/PL3 tienen que construir.
- `ProfileBlock` (`packages/blocks-renderer/src/blocks/profile.tsx`) y los botones
  (`ui/link-button.tsx`, `ui/stack-button.tsx`) ya tienen portada+avatar superpuesto+badge y pila de
  botones consistente — PL5 es ajustarlos al patrón de referencia (avatar más grande, variante
  "glass" sobre fondo oscuro/foto), no reescribirlos desde cero.

Ejecuta en este orden, respetando la Definición de Terminado de `CLAUDE.md` en cada historia:

1. **PL2** — familia de temas oscuros en el catálogo, con su batería de contraste AA.
2. **PL5** — ajuste del bloque de perfil y los botones al patrón de referencia (esto es lo que hace
   que cualquier tema, claro u oscuro, se vea como las referencias en vez de una lista genérica).
3. **PL1** — modelo `Template` y migración.
4. **PL3** — catálogo semilla de al menos 6 plantillas por rubro (contenido 100% ficticio, cero
   activos de Linktree/Beacons/Stan ni de las cuentas usadas como referencia).
5. **PL4** — selector de plantillas en onboarding y constructor.

Antes de marcar cualquiera de estas historias como terminada, muéstrame en el chat una captura o
descripción del resultado real (no solo "pasan los tests") para que confirme que se ve como las
referencias que envié, y confirma que ninguna combinación tema+fondo bajó de WCAG 2.2 AA.

Si encuentras una contradicción entre `ADR-008` y cualquier otro documento que no sea una
instrucción más reciente mía en el chat, avísame antes de implementar — no la resuelvas solo.

---
