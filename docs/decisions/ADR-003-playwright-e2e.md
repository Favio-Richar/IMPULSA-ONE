# ADR-003: Usar Playwright para las pruebas de interfaz de extremo a extremo

- **Estado:** Aceptado
- **Fecha:** 2026-09-22
- **Fuente:** F2.9 (constructor visual) — el criterio "responsive real" no se podía verificar con
  las herramientas que había en el repositorio.

## Contexto

Hasta F2.9 el repositorio no tenía ninguna prueba de interfaz. El criterio de testing vigente era
"lógica pura con Vitest, interfaz verificada a mano en el navegador", y alcanzó mientras las
pantallas fueron formularios y listas: lo que podía romperse de verdad vivía en funciones puras
(validación, saneo, resolución de SEO, permisos) y eso sí tenía cobertura.

El constructor visual rompió ese equilibrio en dos puntos concretos:

1. **"Responsive real" no es verificable a mano acá.** La Definición de Terminado exige que toda
   pantalla funcione en móvil y escritorio. Verificarlo requiere un viewport angosto de verdad, y
   la herramienta de navegador disponible en las sesiones de desarrollo asistido no cambia el
   viewport real de esta máquina: se midió `window.innerWidth` por JavaScript después de pedir el
   cambio de tamaño y siguió en 1920 sin importar el tamaño solicitado. La historia quedó
   bloqueada, sin forma de cerrarse, por falta de herramienta.
2. **El defecto que apareció no era visible en el código.** El constructor aplicaba en una sola
   columna el alto fijo y el recorte que necesita su layout de tres columnas, así que en un
   teléfono los tres paneles quedaban apilados en franjas de ~200px con scroll propio, cortando el
   contenido. Las clases responsive estaban escritas con la misma convención que el resto del
   panel: leyendo el código parecía correcto. Solo se ve ejecutándolo en un viewport angosto.

## Decisión

Se agrega **Playwright** (`@playwright/test`) como la herramienta de pruebas de extremo a extremo
sobre navegador real, en un paquete propio del monorepo: `packages/e2e` (`@impulza/e2e`).

- Corre contra la **API real** (Postgres y Redis de verdad), igual que las pruebas de integración
  de `apps/api`. Nada de mocks de servidor: una prueba de interfaz que miente sobre el backend no
  sirve para lo que se compró.
- Dos proyectos de Playwright, `movil` y `escritorio`, sobre el mismo archivo de pruebas — el
  punto es justamente contrastar los dos extremos.
- Script propio (`pnpm test:e2e`), **fuera** de `pnpm test`: estas pruebas necesitan servidores
  levantados y son de otro orden de duración; mezclarlas volvería lento y frágil el ciclo corto.
- No reemplaza nada: Vitest sigue siendo la herramienta para lógica pura y para las pruebas de
  integración de la API. Playwright cubre lo que ninguna de las dos puede ver.

## Alternativas consideradas

- **Seguir verificando a mano, y que el responsive lo revise el propietario en su teléfono.**
  Funciona una vez y no deja nada: al siguiente cambio de layout, el mismo defecto puede volver sin
  que nada avise. Además deja la historia dependiendo de la disponibilidad de una persona para
  poder cerrarse, lo que en la práctica significa que se cierra sin verificar.
- **React Testing Library / jsdom.** Es la opción natural para componentes y sería útil para otras
  cosas, pero no resuelve *este* problema: jsdom no hace layout — no calcula alturas, no aplica
  media queries de Tailwind, no sabe qué se desborda. Un defecto puramente de layout le es
  invisible por construcción. Sigue abierta como decisión aparte para pruebas de componente.
- **Cypress.** Alternativa legítima y madura. Se eligió Playwright por el soporte de varios
  viewports/dispositivos como "proyectos" de primera clase (que es exactamente el eje de esta
  necesidad), por no requerir un servicio externo para el modo headless en CI y por su manejo de
  esperas automáticas, que reduce las pruebas intermitentes.
- **Comparación de capturas (pruebas de regresión visual).** Detectaría el defecto, pero se rompe
  con cualquier cambio legítimo de diseño y obliga a revisar y volver a aprobar imágenes en cada
  PR. Se prefirió afirmar **propiedades** del layout (que nada se desborde, que ningún panel tenga
  scroll anidado en una sola columna, que los controles queden dentro de la pantalla): sobreviven a
  los cambios de estilo y explican en su mensaje de fallo qué se rompió.

## Consecuencias

- **Positivas:** el criterio "responsive real" pasa a ser verificable y repetible en CI en vez de
  una promesa. Queda además la base para cubrir de extremo a extremo los recorridos críticos que
  vienen (formularios, reservas, pagos en fases posteriores), donde "lo probé a mano" es un
  estándar claramente insuficiente.
- **Negativas:** una dependencia de desarrollo más y la descarga de un navegador (~115 MB) en cada
  entorno, incluido CI; un job de CI más lento que los demás, porque necesita Postgres, Redis, la
  API y el dashboard levantados a la vez. Se acota corriendo solo Chromium: el objetivo es la
  geometría del layout, no la compatibilidad entre navegadores, que es otro problema.
- **Seguimiento:** revisar esta decisión si el job de e2e se vuelve intermitente de forma
  recurrente (un CI en el que nadie confía es peor que no tenerlo), o si aparece la necesidad real
  de probar contra Firefox/WebKit, que cambiaría el cálculo de costo.

## Restricciones asociadas

- Toda pantalla nueva con layout responsive no trivial suma su prueba a `packages/e2e` antes de
  que su historia pueda marcarse como terminada. "Se ve bien en mi pantalla" no cierra una
  historia (CLAUDE.md, Definición de Terminado).
- Las pruebas de e2e afirman propiedades del layout y recorridos del usuario, **nunca** comparan
  capturas de pantalla pixel a pixel.
- `pnpm test` debe seguir corriendo sin servidores levantados. Nada de e2e entra en esa tarea.
