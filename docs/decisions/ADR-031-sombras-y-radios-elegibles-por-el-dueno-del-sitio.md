# ADR-031: Ofrecer sombras marcadas y un radio redondeado como opción del dueño del sitio

- **Estado:** Aceptado
- **Fecha:** 2026-10-14
- **Fuente:** `docs/PROMPT_EDITOR_PORTAL_FUNCIONES_FALTANTES.md` §3 y decisión explícita de Favio en el chat (2026-10-14):
  «Como Linktree, con ADR».

## Contexto

`CLAUDE.md` fija para la página pública "bordes moderados (nada de pill extremo salvo que ADR-008 lo autorice) y sombras
discretas". Por eso los tokens de tema solo tenían 3 radios (`none`/`subtle`/`moderate`) y 2 sombras (`none`/`subtle`).

Al comparar el editor de apariencia con el de las apps de enlace en bio de referencia, Favio pidió que el **dueño de cada sitio**
pueda elegir 4 niveles de sombra (sin sombra, suave, fuerte, dura) y un radio más redondeado que "moderado" para sus botones.
Esa opción contradice la regla vigente, así que la decisión se registra acá antes de implementarla.

## Decisión

1. `RADIUS_SCALES` pasa a `none | subtle | moderate | rounded`. `rounded` vale `1.25rem`: bien redondeado, **sin llegar a
   píldora** (un botón de la pila mide 56 px; la píldora serían 28 px de radio).
2. `SHADOW_SCALES` pasa a `none | subtle | strong | hard`:
   - `strong`: sombra difusa marcada (`0 12px 28px -8px` + `0 4px 10px -4px`, pizarra al 32 % y 18 %).
   - `hard`: sombra sólida desplazada sin desenfoque (`4px 4px 0 0`) del color del texto **de la página**
     (`--site-color-foreground`, el que el fondo ajusta para AA): oscura sobre fondo claro, clara sobre fondo oscuro, así
     siempre se distingue. (Una primera versión usaba el texto del tema y desaparecía con un tema claro sobre fondo oscuro;
     lo detectó la prueba visual del editor.)
3. Son **opciones que elige el dueño del sitio** en el editor de temas. Los temas del catálogo de Impulza siguen usando los
   valores sobrios (`themes.test.ts` lo verifica) y el resto del producto (panel, constructor, administración, sitio comercial)
   no cambia: allí siguen valiendo los bordes moderados y las sombras discretas de `packages/ui`.
4. Ningún tema guardado cambia: los valores existentes conservan exactamente su CSS (`css-variables.test.ts`).

## Alternativas consideradas

- **4 niveles sobrios** (la sombra más fuerte sigue siendo limpia, sin sombra sólida; radio redondeado moderado). Respetaba
  `CLAUDE.md` sin excepción, pero no da el estilo de sombra sólida "brutalista" que Favio quería ofrecer.
- **No ampliar las sombras.** Cumplía la regla, pero dejaba el editor por debajo de la referencia en una opción visible y
  frecuente.

## Consecuencias

- Positivas: el dueño del sitio tiene el mismo rango expresivo que en las apps de referencia, con valores cerrados (enums),
  nunca CSS libre.
- Negativas: un sitio puede verse más "pesado" que la dirección sobria del catálogo. Es una elección explícita del dueño, no un
  valor por defecto.
- Accesibilidad: ninguna sombra lleva texto encima ni sustituye un borde esencial, así que no afecta el contraste (WCAG 2.2 AA
  sigue verificándose igual en paleta y fondo).
- Seguimiento: si algún día un tema **del catálogo** necesita `strong`, `hard` o `rounded`, se decide aparte (hoy una prueba lo
  impide a propósito).

## Restricciones asociadas

- Solo la página pública del sitio del cliente final, y solo por elección del dueño en su tema propio.
- `rounded` nunca supera la mitad del alto de un botón de la pila (sin píldoras).
- Los valores viven en un solo lugar (`themeRadiusValue`/`themeShadowValue`, `packages/validation`); el editor los reutiliza.
