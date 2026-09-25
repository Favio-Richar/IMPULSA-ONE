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
| PP2 — Biblioteca de medios y selector en los bloques | Pendiente |
| PP3 — Fondo premium de la página (color, degradado, imagen, video de biblioteca) | Pendiente |
| PP4 — Familias de temas "Ejecutivo" y "Vibrante" y encabezado de perfil | Pendiente |
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

### PP4 — Familias de temas y encabezado de perfil
**Criterios de aceptación:**
- Temas nuevos en dos líneas, **Ejecutivo** (sobrio y formal) y **Vibrante** (juvenil y con más
  color), con pareja tipográfica real alojada en el propio sitio (sin cargar fuentes de terceros en
  el navegador del visitante), todos con contraste AA verificado.
- Encabezado de perfil con avatar sobre la portada, nombre, verificación, bio y fila de redes con
  logos reales.

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
