# Backlog — Página pública premium

Aprobado por Favio el 2026-09-24 como prioridad por delante de F4.9 ("cloudflare r2 ok, adelante a
trabajar"). Origen: `docs/research/ANALISIS_MERCADO_2026-09.md` §5. La brecha principal frente a la
competencia no es de funciones, es **lo que ve el visitante al tocar el enlace desde Instagram o
TikTok**. Decisión técnica de medios: `docs/decisions/ADR-006-almacenamiento-medios.md`.

Cada historia cumple la Definición de Terminado general (`CLAUDE.md`) **más** sus criterios propios.
Y todas comparten estas **reglas de la página pública**:

- **Rendimiento:** LCP < 2,5 s en un teléfono con 4G. Primero se ve una imagen fija; el video llega
  después y nunca bloquea el contenido.
- **Navegadores internos de Instagram y TikTok:** ahí se abre la mayoría de las visitas. El video usa
  `muted` + `playsinline` + `autoplay` + `loop` (la única combinación que esos navegadores
  reproducen sola), y se prueba con sus user-agents.
- **Respeto por el visitante:** con `prefers-reduced-motion` o "ahorro de datos" (`Save-Data`), se
  muestra la imagen fija en vez del video y no hay animaciones.
- **Legibilidad garantizada:** sobre imagen o video, el texto va sobre una capa de oscurecido o
  aclarado calculada para contraste AA. El usuario elige la intensidad, pero el servidor no guarda
  una combinación ilegible.
- **Identidad propia:** nada copiado del aspecto de Linktree, Beacons o Stan (`CLAUDE.md`).

## Estado

| Historia | Estado |
|---|---|
| PP1 — Almacenamiento y subida de imágenes | Terminada (local; falta que Favio cargue las credenciales de R2) |
| PP2 — Biblioteca de medios y selector en los bloques | Terminada (local) |
| PP3 — Fondo premium de la página (color, degradado, imagen, video de biblioteca) | En progreso (falta el contenido de la biblioteca de videos, que aprueba Favio) |
| PP4 — Familias de temas "Ejecutivo" y "Vibrante" y encabezado de perfil | Terminada (local) |
| PP5 — Botón principal fijo en móvil y animaciones de entrada | Terminada (local) |
| PP6 — Video de fondo propio (subida y transcodificación) | Terminada (local; licencias a revisar antes de producción, ADR-007) |
| PP7 — Verificación de rendimiento y navegadores internos | Pendiente |

### PP1 — Almacenamiento y subida de imágenes
**Criterios de aceptación:**
- `packages/storage` con `StorageAdapter` (URL prefirmada de subida, `head`, lectura de los primeros
  bytes, borrado), adaptador S3 compatible con R2 y MinIO, y adaptador en memoria para pruebas.
  Variables validadas al iniciar; sin ellas la API arranca y la subida responde "no configurado".
- Modelo `MediaAsset` (organización, tipo, estado, tamaño, dimensiones, variantes, quién lo subió) con
  migración no destructiva.
- `POST .../media/uploads` emite la URL prefirmada (lista cerrada de tipos, 8 MB, cuota `storageMb`
  con lock); `POST .../media/:id/confirm` verifica tamaño y bytes mágicos y encola el procesamiento.
- Worker: variantes WebP 400/800/1600 sin EXIF, `READY` o `FAILED`, y reintentos idempotentes.
- `GET`/`DELETE` de assets; el borrado se rechaza si el asset está en uso.
- Pruebas: contrato, tipos rechazados (SVG y archivos disfrazados con extensión falsa), cuota,
  aislamiento entre organizaciones, borrado en uso y procesamiento completo contra MinIO.

> **Estado (2026-09-25): terminada en local.**
>
> - **`packages/storage`:** `StorageAdapter`, adaptador S3 (R2 en producción, MinIO en desarrollo)
>   y adaptador en memoria para pruebas; detección del tipo real por bytes mágicos; claves que decide
>   el servidor; `processMediaAsset` (endereza según EXIF, genera WebP de 400/800/1600 sin agrandar,
>   **sin metadatos** y con caché inmutable, borra el original); `cleanupAbandonedMedia`; y el script
>   `setup:local`, que crea el bucket local con lectura pública.
> - **Configuración:** variables `STORAGE_*` con regla todo o nada. Sin ninguna, la API y el worker
>   arrancan y la subida responde `503 STORAGE_NOT_CONFIGURED`; con algunas faltando, no arrancan y
>   dicen cuáles faltan. **Para producción solo hay que poner los valores de R2 en el `.env`.**
> - **API `/organizations/:id/media`:** biblioteca con uso de cuota, pedir URL de subida (permiso
>   nuevo `media.manage` para propietario, administrador y editor; rate limit 60/h), confirmar
>   (verifica tamaño exacto y tipo real, e idempotente), ver y borrar. El borrado se rechaza con
>   `409 MEDIA_IN_USE` si un bloque vigente o la versión publicada vigente usa el archivo, y queda
>   auditado.
> - **Cuota:** `storageMb` del plan **se aplica desde ahora**, con lock por organización. El uso
>   aparece en el plan (`usage.storageMb`), en el panel y en la administración.
> - **Worker:** cola `media-process` (concurrencia 2, 3 intentos) y limpieza cada hora de las subidas
>   abandonadas (> 1 h) y de las fallidas viejas (> 7 días).
> - **CI:** el job de pruebas levanta MinIO y prepara el bucket, así las pruebas del adaptador real no
>   se omiten.
>
> **Verificación:** 13 pruebas e2e de medios. Entre otras cubren: una foto de celular girada y con
> EXIF sale enderezada y sin metadatos, un HTML disfrazado de JPEG se rechaza y se borra, cuota con
> 402, permisos por rol, aislamiento, borrado en uso, limpieza y la instalación sin almacenamiento.
> Se confirmó que fallan al quitar los bytes mágicos, la cuota, el chequeo de uso y la eliminación de
> EXIF. 4 pruebas de integración del adaptador contra MinIO real, incluido que el bucket rechaza una
> subida con otro tipo o tamaño que el firmado. Recorrido manual real: API → subida directa a MinIO →
> confirmación → worker → variantes servidas públicamente (22,9 KB → 3,1 KB). `@impulza/api` pasa
> 318/318 y `lint`/`typecheck`/`test`/`build` pasan 62/62. OpenAPI regenerado.

### PP2 — Biblioteca de medios y selector en los bloques
**Criterios de aceptación:**
- Pantalla `/medios` en el panel: grilla, subida con arrastrar y soltar y con progreso, estados
  (subiendo, procesando, listo, error) y uso de cuota.
- Selector de imagen reutilizable en los bloques perfil (avatar), portada (hero), imagen y galería:
  elegir de la biblioteca o subir en el momento, con texto alternativo obligatorio (o marcar como
  decorativa) y guía de proporción (avatar cuadrado, portada 16:9).
- El render público usa `srcset` con las variantes (el teléfono baja 400/800, no el original).
- Una URL de medios de otra organización se rechaza al guardar el bloque.

> **Estado (2026-09-25): terminada en local.**
>
> - **`/medios` en el panel:** grilla con miniaturas (variante de 400 px), subida con arrastrar y
>   soltar **y** botón (el arrastre no existe en el teléfono ni por teclado), progreso real de la
>   subida directa al bucket y luego cada paso del servidor (verificando, optimizando, lista, error),
>   uso de cuota con aviso al 90 % y enlace al plan, aviso de "no configurado", y borrado con
>   confirmación que, si la imagen está en uso, dice en qué página.
> - **Selector de imagen** (`ImageField` + `MediaPicker` sobre el nuevo `Dialog` de `@impulza/ui`,
>   Radix) en perfil, portada, imagen, galería, servicio y testimonios: elegir de la biblioteca o
>   subir en el momento (queda elegida sola), guía de proporción (avatar cuadrado, portada 16:9),
>   vista previa, y la opción de enlace externo para no romper bloques existentes.
> - **Texto alternativo obligatorio al guardar** (o marcar como decorativa): regla de escritura
>   `findImagesWithoutAlt` en `@impulza/validation`, aplicada por la API (422 con la ruta del campo)
>   y por el formulario del panel (aviso junto al campo). No se agregó al esquema `imageSchema` a
>   propósito: ese esquema también valida lo ya guardado, y endurecerlo dejaría de mostrar bloques
>   antiguos con `alt` vacío en la página pública.
> - **Render público con `srcset`** (`mediaSrcSet`): el teléfono baja la variante de 400 u 800 px;
>   carga perezosa por defecto y `fetchpriority="high"` en perfil y portada (presupuesto LCP).
> - **Aislamiento:** una URL de medios de otra organización, o de un archivo que aún se procesa, se
>   rechaza al guardar el bloque (ADR-006 §9). Las URLs externas siguen permitidas.
> - **Corrección encontrada en el camino:** el panel de configuración comparaba la respuesta del
>   servidor con `JSON.stringify`, sensible al orden de las claves; PostgreSQL (JSONB) las reordena,
>   así que el eco del propio autoguardado se tomaba por un cambio externo, reiniciaba el formulario y
>   volvía a "Sin cambios". Ahora compara por valor (`sameConfig`).
>
> **Verificación:** e2e de API (imagen de otra organización, imagen en proceso, texto alternativo
> vacío en galería y al editar, decorativa aceptada), pruebas unitarias de `mediaSrcSet`,
> `SiteImage`, `findImagesWithoutAlt` y `sameConfig`, y Playwright en móvil y escritorio contra la
> API, MinIO y el worker reales: subir desde `/medios` y ver la miniatura WebP de 400 px, rechazar un
> SVG antes de subir, y en el constructor subir una imagen desde el selector, ver el aviso de texto
> alternativo, guardarla, recargar y conservarla, sin desplazamiento horizontal. La prueba del
> constructor fallaba con la comparación anterior (confirmado en ambos viewports).

### PP3 — Fondo premium de la página
**Criterios de aceptación:**
- Por sitio: fondo de color, degradado (catálogo curado), imagen de la biblioteca o **video de la
  biblioteca curada de Impulza**, con capa de legibilidad (oscura o clara, en 3 intensidades)
  verificada para AA en el servidor.
- Biblioteca curada de videos: 20–30 loops profesionales con licencia comercial verificada, cortos
  (≤ 12 s), 720p, sin audio y con póster. **El contenido lo aprueba Favio antes de publicarse.**
- Render: primero el póster, video solo si no hay reducir movimiento ni ahorro de datos, y
  `playsinline muted autoplay loop`.
- Vista previa idéntica en el constructor.

> **Estado (2026-09-25): en progreso — todo construido y probado salvo el contenido de la biblioteca
> de videos**, que por criterio de aceptación **aprueba Favio** (20–30 loops con licencia comercial
> verificada). La biblioteca (`BACKGROUND_VIDEOS` en `@impulza/validation`) está vacía a propósito:
> mientras lo esté, el panel no ofrece la opción de video y la API rechaza cualquier código.
>
> - **Modelo:** `sites.background` (JSON opcional, en vivo como el tema) y `media_assets.tones`
>   (`{darkest, lightest}`), migración no destructiva `20260925230000_site_background`.
> - **Fondos:** color, 8 degradados curados (4 claros, 4 oscuros), imagen de la biblioteca propia y
>   video curado, con capa oscura o clara en 3 intensidades. Siempre valores cerrados, nunca CSS.
> - **Legibilidad verificada en el servidor:**
>   - el texto que va directo sobre el fondo cambia a una paleta clara u oscura cuando la del tema
>     no alcanza AA, y un color con el que ningún texto se lee (un gris medio) se rechaza;
>   - cada degradado se verifica con su paleta en todos sus colores (prueba);
>   - sobre una imagen, el worker calcula sus tonos extremos (percentiles 2 y 98 de una versión
>     reducida, así un reflejo suelto no decide nada) y la API rechaza la intensidad que no alcanza
>     AA en el peor punto (422 con `legibleStrengths`). "Fuerte" alcanza AA sobre cualquier imagen,
>     así que siempre hay una opción válida;
>   - las tarjetas (enlaces, servicios, testimonios, formularios) vuelven a la paleta del tema
>     (`SURFACE_SCOPE`), y los enlaces de texto y los botones de contorno usan `--site-color-link`
>     en vez del primario, que puede no leerse sobre una foto oscura.
> - **Imagen de fondo:** solo un archivo listo de la biblioteca de la misma organización (una URL
>   externa se rechaza: no se puede verificar su legibilidad); se guarda su URL canónica, se sirve
>   con `srcset` y prioridad alta, y no se puede borrar de la biblioteca mientras sea fondo.
> - **Render (`SiteBackdrop`, compartido por el sitio público y la vista previa):** color de base
>   igual al de la capa mientras carga la imagen; el video muestra primero el póster y solo se agrega
>   si no hay "reducir movimiento" ni "ahorro de datos", con `muted playsInline autoPlay loop`.
> - **Panel:** tarjeta "Fondo de la página" en el sitio, con vista previa en vivo, color con aviso
>   de legibilidad al escribirlo, degradados y selector de imagen; las intensidades que no alcanzan
>   AA sobre la foto elegida aparecen desactivadas.
> - **Corrección de paso:** aplicar un tema no invalidaba la caché de la página pública (se veía
>   recién al volver a publicar). Ahora el tema y el fondo avisan a `apps/web` al cambiar.
>
> **Verificación:** 14 pruebas unitarias del módulo de fondos (cada degradado legible en todos sus
> colores, "fuerte" legible sobre cualquier imagen, gris medio rechazado, nunca CSS), 3 de
> `computeImageTones` (un reflejo aislado no decide el tono; lo transparente cuenta como peor caso),
> 5 de `SiteBackdrop` (el video no viaja en el HTML inicial, solo el póster) y 11 e2e de API (capa
> insuficiente → 422 con `legibleStrengths`, URL canónica, imagen externa/ajena/en proceso
> rechazadas, borrado bloqueado mientras es fondo, auditoría, permisos por rol, aislamiento y
> respuesta pública). Playwright en móvil y escritorio (6 pruebas): degradado aplicado desde el panel
> y visto en el constructor con el texto blanco y la portada con el color del tema; color ilegible
> no aplicable; sobre una foto clara solo "Fuerte" habilitada. Confirmado que fallan al quitar la
> verificación de la capa, el bloqueo del borrado y `SURFACE_SCOPE`. Revisión manual de la página
> pública real (`apps/web` en el 3001, con invalidación de caché) con capturas de degradado, imagen y
> tema, sin desplazamiento horizontal. `lint`/`typecheck`/`build` 47/47, `test` 25/25, Playwright
> 65 pasan. OpenAPI regenerado (116 operaciones).
>
> **Falta para cerrarla:** que Favio apruebe los videos (fuente, licencia, contenido), subirlos al
> bucket en `curated/` con su póster y declararlos en `BACKGROUND_VIDEOS` con sus tonos.

### PP4 — Familias de temas y encabezado de perfil
**Criterios de aceptación:**
- Temas nuevos en dos líneas, **Ejecutivo** (sobrio y formal) y **Vibrante** (juvenil y con más
  color), con pareja tipográfica real alojada en el propio sitio (sin cargar fuentes de terceros en
  el navegador del visitante), todos con contraste AA verificado.
- Encabezado de perfil con avatar sobre la portada, nombre, verificación, bio y fila de redes con
  logos reales.

> **Estado (2026-09-25): terminada en local.**
>
> - **Parejas tipográficas alojadas en el propio sitio:** `fontFamily` suma `executive` (Source
>   Serif 4 en títulos + Inter en texto) y `vibrant` (Bricolage Grotesque + Manrope). Son fuentes
>   OFL-1.1 de `@fontsource-variable/*`, declaradas en `packages/blocks-renderer/src/styles/fonts.css`
>   y empaquetadas por cada app en sus propios estáticos (`/_next/static/media/`): **el navegador del
>   visitante no le pide nada a Google ni a ningún tercero**. Solo se descarga la fuente que el tema
>   usa y el subconjunto latino (~25–50 KB cada una), con `font-display: swap` (no frena el LCP) y
>   pila del sistema de respaldo. Nueva variable `--site-font-heading` para `h1`–`h4`
>   (`[data-site-root]` en `SiteBackdrop`); en las familias anteriores vale lo mismo que el texto,
>   así que los sitios existentes no cambian.
> - **Catálogo por líneas:** `THEME_FAMILIES` (`ejecutivo`, `vibrante`, `clasico`) y 6 temas nuevos:
>   Ejecutivo — Marino, Grafito, Borgoña; Vibrante — Coral, Violeta, Turquesa. Fondos siempre claros
>   (los vibrantes, teñidos), bordes moderados, sombras discretas. La API devuelve `family` en cada
>   tema (sale del catálogo en código, sin migración; `null` en los propios) y el panel agrupa la
>   sección "Apariencia" por línea, con cada tarjeta mostrando su pareja tipográfica real y su botón.
> - **Contraste:** los 11 temas del catálogo alcanzan AA también en pares que el esquema no exigía y
>   el render sí usa — texto secundario sobre tarjeta, y el primario como **texto** de enlaces y de
>   botones de contorno (≥ 4,5 sobre fondo y tarjeta, no solo 3). Nueva prueba del catálogo.
> - **Encabezado de perfil:** el bloque perfil suma `cover` (portada) y `socials` (hasta 8 redes con
>   su logo real), ambos opcionales y **sin subir la versión del esquema** (un perfil guardado sigue
>   igual; un despliegue anterior ignora los campos nuevos). La portada no lleva texto encima: el
>   avatar se monta sobre su borde con un marco del color del fondo, y nombre, verificación, frase,
>   bio y redes van debajo, sobre el fondo de la página (cuyo contraste ya garantiza PP3). Redes en
>   círculos de 44 px (`SocialIconLinks`, compartido con el bloque "redes"). La portada hereda todas
>   las reglas de imágenes: texto alternativo obligatorio al guardar, solo medios propios de la
>   organización, `srcset` y prioridad alta, y bloqueo de borrado mientras esté en uso.
> - **Constructor:** campos "Portada" (guía 16:9) y "Redes bajo la biografía" en el bloque perfil.
>
> **Verificación:** pruebas unitarias de las parejas (títulos ≠ texto, respaldo del sistema, familias
> anteriores intactas), del catálogo (líneas con ≥ 3 temas y su pareja, AA en los pares nuevos, tema
> por defecto sin cambios), del esquema del perfil (configuración anterior válida sin cambios, 8
> redes como máximo, red desconocida o `javascript:` rechazados), de `ProfileBlock` (4) y de
> `fonts.css` (cada fuente nombrada por un tema está declarada; todas OFL, locales y con `swap`).
> e2e de API: `family` por tema y `null` en la copia, tema propio con pareja aceptado y nombre de
> fuente libre rechazado, portada sin texto alternativo → 422 en `cover.alt`, red con `javascript:`
> rechazada, y portada con imagen de otra organización rechazada. Playwright en móvil y escritorio:
> aplicar "Marino" desde el panel y ver en el constructor los títulos en Source Serif 4 y el texto en
> Inter, con la fuente **cargada de verdad y servida desde el mismo origen**; encabezado con el
> avatar cruzando el borde de la portada, centrado, redes de ≥ 44 px y sin desplazamiento horizontal.
> Confirmado que fallan al romper el nombre de una fuente y al quitar `family` de la respuesta.
> Revisión visual con capturas reales de la vista previa (Marino, Grafito, Coral, Violeta; móvil y
> escritorio). `@impulza/api` 335/335, `lint`/`typecheck` 26/26, `build` 15/15, `test` 25/25,
> Playwright 69/69. OpenAPI regenerado.
>
> **Despliegue:** los 6 temas nuevos llegan a una base existente con
> `pnpm --filter @impulza/database run db:seed` (upsert idempotente por `code`; no toca los temas
> propios de las organizaciones).

### PP5 — Botón principal y animaciones
**Criterios de aceptación:**
- El dueño marca un bloque de acción (WhatsApp, enlace, formulario) como **principal**: se destaca y,
  en el teléfono, queda fijo abajo sin tapar contenido.
- Entrada suave de los bloques (sin animación con reducir movimiento).

> **Estado (2026-09-26): terminada en local.**
>
> - **Modelo:** `blocks.is_primary` con un **índice único parcial** (`WHERE is_primary`): a lo sumo
>   un bloque principal por página, garantizado por la base y no solo por el código. Migración
>   aditiva `20260926010000_block_primary_action`.
> - **API:** `PUT .../pages/:pageId/blocks/primary` con `{ blockId }` (o `null` para quitarla),
>   permiso `page.manage`, auditado (`page.primary_block_set`). Solo bloques de acción
>   (`PRIMARY_ACTION_BLOCK_TYPES`: WhatsApp, enlace, formulario; 422 si no), el bloque tiene que ser
>   de esa página y organización (404 si no), y dos cambios simultáneos terminan en 409 en vez de dos
>   principales. `isPrimary` en cada bloque de la respuesta.
> - **Publicación:** la marca viaja en el snapshot **solo cuando es verdadera**, así una versión
>   publicada antes de PP5 es idéntica al estado vivo y ninguna página aparece de pronto con cambios
>   sin publicar; restaurar una versión la recupera. La respuesta pública agrega `primary` (opcional
>   en el contrato, para tolerar respuestas en caché anteriores) y la API vuelve a exigir que sea un
>   bloque de acción: una marca puesta a mano en otro tipo no se publica.
> - **Render:** el bloque principal se destaca (sólido aunque su estilo sea de contorno, más alto y
>   con un halo del color primario) y `PrimaryActionBar` lo repite abajo en el teléfono:
>   - `position: sticky` al final del contenido: pegada al borde al recorrer y asentada en su propio
>     lugar al final, así que **no tapa** el último bloque;
>   - solo en contenedores de menos de 40 rem, por *container query*: la vista previa del
>     constructor en modo teléfono se comporta igual que un teléfono real. El contenedor es un
>     envoltorio propio de `PageBlocks` y no la raíz del sitio, porque `container-type` crearía
>     contención de layout y rompería el fondo `fixed` de PP3;
>   - se esconde (e `inert`) mientras el bloque original está a la vista (`IntersectionObserver`),
>     y sin JavaScript queda siempre visible;
>   - un formulario principal lleva a su ancla en la misma pestaña; un formulario sin elegir no
>     genera barra;
>   - los clics de la barra se atribuyen al bloque principal por los mismos `data-block-*` (F3.6).
> - **Entrada de los bloques:** subir 12 px y aparecer, escalonado 60 ms (tope 8), solo con
>   `prefers-reduced-motion: no-preference`. Parte de opacidad 0,01 y no 0 para no sacar la foto de
>   perfil del cálculo del LCP.
> - **Constructor:** interruptor "Acción principal" en el panel de los bloques de acción, con
>   actualización optimista (la casilla, el lienzo y la vista previa cambian al instante y se
>   revierten si el servidor lo rechaza) y aviso de que reemplaza a la actual; marca "Principal" en
>   el lienzo. El marco de la vista previa pasa de `overflow-hidden` a `overflow-clip`: recorta
>   igual, pero no crea un contenedor de scroll que anularía el `sticky`.
>
> **Verificación:** 6 e2e de API (marcar, mover y quitar con auditoría; tipo no válido, bloque de
> otra página, cuerpo inválido; el índice rechaza una escritura directa y 4 cambios simultáneos
> dejan exactamente uno; duplicar no copia la marca; publicar, respuesta pública, borrador no
> visible y restaurar; una marca manual en un texto no se publica) más el aislamiento
> multi-tenant de la ruta nueva. 7 pruebas del render (barra solo con acción principal, enlace de
> WhatsApp con mensaje, atribución, formulario por ancla, enlace de contorno forzado a sólido,
> escalonado) y 2 del CSS (animación solo sin "reducir movimiento"; nunca desde opacidad 0).
> Playwright en móvil y escritorio: marcar desde el constructor, barra escondida con el original a
> la vista, pegada abajo a mitad del recorrido, debajo del último bloque al final, e inexistente en
> un marco de 640 px o más; animación presente y ausente con `reducedMotion: reduce`. Confirmado que
> fallan al quitar el filtro de tipo en la respuesta pública, la marca del snapshot, la *container
> query* y el `overflow-clip`. Revisión visual con capturas (de ahí salió el halo: sin él, el
> principal no se distinguía de otro botón sólido). `@impulza/api` 341/341, `lint`/`typecheck` 26/26,
> `build` 15/15, Playwright 73/73. OpenAPI regenerado (117 operaciones).

### PP6 — Video de fondo propio
**Criterios de aceptación:**
- Subida de MP4 o WebM (≤ 30 MB, ≤ 15 s), transcodificación en el worker a MP4 H.264 720p sin audio,
  más póster, dentro de la cuota del plan.

> **Estado (2026-09-26): terminada en local.** Decisión técnica en
> `docs/decisions/ADR-007-procesamiento-video.md`.
>
> - **ffmpeg del sistema** por `FFMPEG_PATH`/`FFPROBE_PATH`, todo o nada: sin ellas, todo funciona y la
>   subida de video responde `503 VIDEO_NOT_CONFIGURED` (el panel ni la ofrece); a medias o con una
>   ruta inexistente, la API y el worker no arrancan. Se descartaron los binarios empaquetados en npm
>   (`@ffmpeg-installer` trae ffmpeg 4.1 de 2018; `ffmpeg-static` descarga un binario al instalar).
>   En desarrollo: ffmpeg 9.0.2 portable oficial, verificado por SHA-256, fuera del repo. En CI:
>   `apt-get install ffmpeg`. En producción: el paquete de la distribución en la imagen del worker.
> - **Formatos:** MP4, WebM y **también MOV** (`video/quicktime`), que es lo que graba un iPhone
>   (ampliación sobre el criterio, anotada en el ADR). Hasta 30 MB y 15 s, dentro de la cuota.
>   Verificados por bytes mágicos al confirmar (una imagen AVIF/HEIC o un HTML no pasan).
> - **Invocación endurecida:** sin shell, demuxer **forzado** según el tipo verificado,
>   `-protocol_whitelist file`, `-nostdin`, límite de tiempo. Se comprobó que sin el demuxer forzado
>   una lista `ffconcat` con nombre `.mp4` hacía que ffmpeg leyera **otro archivo del servidor**
>   como si fuera el subido: la prueba lo cubre.
> - **Salida:** MP4 H.264 `yuv420p` con lado corto hasta 720 px (sin agrandar, dimensiones pares),
>   hasta 30 cuadros por segundo, tasa acotada, **sin audio ni metadatos** (la ubicación del teléfono
>   se elimina) y `faststart`. Póster (primer cuadro) en las mismas variantes WebP que una imagen. El
>   original se borra.
> - **Legibilidad sobre todo el video:** los tonos se miden en un cuadro por segundo, no solo en el
>   póster; la API solo acepta la capa que alcanza AA en la escena más exigente.
> - **Worker:** cola propia `media-video` con concurrencia 1 y bloqueo de 5 min (una conversión larga
>   nunca se ejecuta dos veces); el error técnico de ffmpeg queda en el log estructurado y el usuario
>   ve un motivo legible.
> - **Fondo `own_video`:** solo un video listo de la misma organización, con URLs canónicas del MP4 y
>   del póster que decide el servidor; se resuelve al mismo `video` que ya pinta `SiteBackdrop`
>   (póster primero; sin reproducción con "reducir movimiento" o "ahorro de datos"). No se puede
>   borrar mientras sea fondo. Un video tampoco se acepta como imagen dentro de un bloque.
> - **Panel:** `/medios` acepta video (marca "Video" en la grilla, estado "Convirtiendo el video…");
>   "Fondo de la página → Video" lista los videos propios y los curados, con la vista previa en
>   movimiento y las intensidades ilegibles desactivadas; sin videos, enlaza a Medios. El selector de
>   imágenes de los bloques sigue mostrando solo imágenes.
>
> **Verificación:** 7 pruebas unitarias (bytes mágicos de MP4/MOV/WebM y disfraces, tonos
> combinados, configuración todo o nada) y 4 de integración con ffmpeg real (720p H.264 sin audio,
> sin ubicación, ≤ 30 cps y con `faststart`; video chico sin agrandar y con dimensiones pares; más de
> 15 s rechazado; `ffconcat` disfrazado frenado). 6 e2e de API de punta a punta (subida, conversión y
> cola propia; HTML disfrazado y video largo rechazados; tamaño y formato; fondo con capa verificada,
> URLs canónicas, respuesta pública y borrado bloqueado; aislamiento y tipos; instalación sin
> ffmpeg). Playwright en móvil y escritorio: subir un video, verlo convertido, elegirlo de fondo con
> la capa suave desactivada y verlo en el constructor con el texto aclarado. Confirmado que fallan al
> quitar `-map_metadata`, el demuxer forzado, la verificación de legibilidad del video y la
> restricción de imágenes en bloques. Revisión visual con capturas (de ahí salió la marca de video
> legible en el selector). `@impulza/api` 347/347, `@impulza/storage` 30/30, `lint`/`typecheck` 26/26,
> `build` 15/15, Playwright 75/75. OpenAPI regenerado.
>
> **Pendiente antes de producción (no de código):** confirmar con asesoría legal el uso comercial de
> ffmpeg con `libx264` (GPL, como programa aparte) y de H.264 (ADR-007, "Consecuencias").

### PP7 — Verificación
**Criterios de aceptación:**
- Prueba de rendimiento con red 4G simulada (LCP < 2,5 s) sobre una página con video de fondo.
- Prueba de render con los user-agents de los navegadores internos de Instagram y TikTok.
- Revisión visual con capturas de móvil y escritorio de cada tema y cada tipo de fondo.
