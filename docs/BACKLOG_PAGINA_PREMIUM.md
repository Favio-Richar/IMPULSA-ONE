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
| PP5 — Botón principal fijo en móvil y animaciones de entrada | Pendiente |
| PP6 — Video de fondo propio (subida y transcodificación) | Pendiente |
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

### PP6 — Video de fondo propio
**Criterios de aceptación:**
- Subida de MP4 o WebM (≤ 30 MB, ≤ 15 s), transcodificación en el worker a MP4 H.264 720p sin audio,
  más póster, dentro de la cuota del plan.

### PP7 — Verificación
**Criterios de aceptación:**
- Prueba de rendimiento con red 4G simulada (LCP < 2,5 s) sobre una página con video de fondo.
- Prueba de render con los user-agents de los navegadores internos de Instagram y TikTok.
- Revisión visual con capturas de móvil y escritorio de cada tema y cada tipo de fondo.
