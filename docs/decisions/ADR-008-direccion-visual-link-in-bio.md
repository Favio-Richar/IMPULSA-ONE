# ADR-008: Adoptar el patrón visual de las apps de enlace en bio para la página pública

- **Estado:** Aceptado. Favio revirtió explícitamente la recomendación de `ANALISIS_MERCADO_2026-09.md`
  §5 el 2026-09-26: pidió que la página pública se vea como Linktree/Beacons (avatar sobre portada,
  pila de botones full-width, fondo oscuro con foto/bokeh cuando corresponda), no como el tema sobrio
  que estaba aprobado como diferenciador.
- **Fecha:** 2026-09-26
- **Fuente:** instrucción directa del propietario en chat, con 5 referencias visuales (perfiles reales
  de Linktree y Beacons). Reemplaza, solo para la página pública del sitio del cliente final, la
  recomendación §5 de `docs/research/ANALISIS_MERCADO_2026-09.md` y la frase "no copiar la interfaz
  visual de Linktree/Beacons/Stan" del `CLAUDE.md` original.

## Contexto

`docs/research/ANALISIS_MERCADO_2026-09.md` (24/09/2026, aprobado por Favio) recomendó explícitamente
NO copiar el look de Linktree/Beacons y construir en cambio "temas con carácter propio" sobrios,
como diferenciador frente a la "estética de creador" de la competencia. Bajo esa dirección se
construyó todo `docs/BACKLOG_PAGINA_PREMIUM.md` (PP1–PP8): temas claros, fondo con imagen/video y
overlay AA, botón principal fijo — motor completo, pero con catálogo de temas 100 % claro.

El 26/09/2026 Favio revisó capturas de perfiles reales de Instagram/Linktree/Beacons y determinó que
quiere que la página pública de Impulza se vea así — no un tema sobrio distinto. Es una decisión de
producto explícita del propietario, que por `CLAUDE.md` §"Orden de autoridad documental" tiene
prioridad sobre cualquier análisis o ADR anterior.

## Decisión

1. La página pública del sitio (`SitePage`/`SiteShell`/`blocks-renderer`) adopta el patrón
   estructural de Linktree/Beacons: portada a sangre o fondo con foto/video oscurecido, avatar
   circular superpuesto sobre el borde inferior de la portada, nombre + badge de verificado, bio
   corta y **una sola pila vertical de botones full-width** (ícono/miniatura a la izquierda, texto
   centrado, alto uniforme). Todo lo que se toca es un botón de esa pila: enlaces, WhatsApp, **cada
   red social** (logo + nombre de la red, no una fila de íconos), **cada servicio** (miniatura,
   nombre, "precio · acción") y **las reseñas** (insignia "★ 4,9 · 128 reseñas"). Nada de tarjetas
   de contenido aparte en medio de la pila. *(Corregido el 2026-09-26, PL6: la primera redacción
   decía "fila de íconos sociales" y "tarjetas de contenido con imagen/precio/CTA", y así se
   construyó; Favio lo rechazó al verlo en el navegador.)*
2. **Nunca se copian activos reales**: logos, nombres de marca, textos o imágenes de Linktree,
   Beacons, Stan o de las cuentas usadas como referencia. Se copia la estructura y jerarquía visual,
   no el contenido ni la identidad de esas plataformas ni de sus usuarios.
3. El motor construido en PP1–PP8 **no cambia**: temas, fondo con imagen/video/degradado y overlay
   AA, `StorageAdapter`, procesamiento de video ya soportan este patrón. Lo que cambia es (a) qué
   tan oscuro/fotográfico puede ser el catálogo de temas por defecto, y (b) la composición del
   bloque de perfil y de la pila de botones para acercarse más a la referencia.
4. Se amplía `THEME_CATALOG` (`packages/validation/src/themes/catalog.ts`) con una familia nueva
   (p. ej. `"editorial-oscuro"`) de al menos 3 temas de fondo oscuro, cada uno verificado con la
   misma batería de contraste WCAG 2.2 AA que ya exige `themes.test.ts` — la prueba
   `"todos los fondos son claros"` se reescribe para excluir explícitamente a esta familia nueva
   (nunca se relaja el contraste, solo la exigencia de fondo claro).
5. Este cambio **se limita a la página pública** del sitio del cliente final. El dashboard, el panel
   de administración y el sitio comercial de Impulza One siguen con el estilo sobrio original
   (`CLAUDE.md` sin cambios en esa parte).
6. `docs/research/ANALISIS_MERCADO_2026-09.md` no se reescribe (es un registro histórico de esa
   fecha); queda con una nota que apunta a este ADR como la decisión vigente.

## Alternativas consideradas

- **Mantener el tema sobrio como identidad única** (lo recomendado por el análisis de mercado):
  descartada por instrucción directa y explícita del propietario, quien prioriza que el producto se
  perciba como una app de enlace en bio reconocible de inmediato por sobre la diferenciación de marca
  identificada en la investigación.
- **Ofrecer ambos como familias separadas sin tocar el default** (mantener sobrio como default,
  agregar oscuro/foto como opción adicional): esta era la recomendación de Claude en el chat; el
  propietario la rechazó explícitamente y pidió que el sistema completo siga el patrón de referencia,
  no solo un segmento.

## Consecuencias

- Positivo: la página pública se acerca de inmediato a un patrón que el mercado ya reconoce y sabe
  usar (menor fricción de adopción para el visitante).
- Negativo: se pierde parte de la diferenciación visual identificada en `ANALISIS_MERCADO_2026-09.md`
  frente a Linktree/Beacons; el riesgo de "verse genérico" que esa investigación advertía vuelve a
  estar presente y hay que mitigarlo con calidad de tipografía, fotografía real del cliente y
  jerarquía de un solo CTA principal (no con el layout en sí).
- Seguimiento: si en producción los visitantes o los propios clientes de Impulza perciben la página
  como "igual a Linktree" de forma negativa (soporte, cancelaciones, feedback), revisar esta decisión
  con datos reales, no solo con la impresión inicial de un mockup.

## Variante adicional pedida por Favio (2026-09-26): portada de cuerpo entero, monocromo

Favio mandó una captura de referencia estructural adicional (perfil real de Linktree, foto de
cuerpo entero como portada — sin avatar circular separado —, pila de botones todos del mismo tono
neutro con miniatura a la izquierda, texto centrado y un menú de opciones "···" a la derecha; muy
minimalista). Pide que las plantillas puedan verse así también, "más elegante". **Se toma solo la
estructura, nunca contenido de esa cuenta** (misma restricción de siempre).

Para la próxima sesión que toque diseño: evaluar una variante de `ProfileBlock` sin el avatar
circular superpuesto — la portada ocupa toda la cabecera y el nombre/bio van directamente debajo,
sin foto redonda — y una variante de botón "monocromo" (todos del mismo color neutro, sin distinguir
primario/secundario por color, con miniatura y un ícono de opciones opcional a la derecha). Debe
pasar por la misma matriz de contraste AA que las demás variantes antes de ofrecerse en el
selector de temas/plantillas. No crear un ADR nuevo para esto: es una variante dentro de la misma
dirección visual de ADR-008, documentarla como historia nueva en `BACKLOG_PLANTILLAS.md` cuando se
tome.

## Restricciones asociadas

No usar logos, nombres, colores de marca ni contenido real de Linktree, Beacons, Stan o de las
cuentas usadas como referencia (Katy Perry, Jamie Oliver, garyvee, etc.). Todo contenido de ejemplo
en el código, seeds o mockups debe ser ficticio.
