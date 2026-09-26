# ADR-007: Procesamiento de video propio con ffmpeg

- **Estado:** Aceptado. Favio aprobó PP6 (video de fondo propio) el 2026-09-26 ("aplicar ambas para
  potenciar el sistema").
- **Fecha:** 2026-09-26
- **Fuente:** `docs/BACKLOG_PAGINA_PREMIUM.md` (PP6); ADR-006 (almacenamiento y medios).

## Contexto

PP6 pide que un cliente suba su propio video de fondo (MP4 o WebM, hasta 30 MB y 15 s) y que el
sistema lo convierta a un formato que reproduzcan todos los teléfonos —en particular los navegadores
internos de Instagram y TikTok—: MP4 H.264 de 720p, sin audio, con póster. Convertir video exige
ffmpeg, y ffmpeg va a leer **archivos subidos por usuarios**: un archivo hostil es la principal
superficie de ataque de este componente.

## Decisión

1. **ffmpeg y ffprobe del sistema, no empaquetados en `node_modules`.** El worker los encuentra por
   `FFMPEG_PATH` y `FFPROBE_PATH`, con la misma regla "todo o nada" que el almacenamiento: sin
   ninguna, todo arranca y la subida de video responde `503 VIDEO_NOT_CONFIGURED`; con una sola, el
   proceso no arranca. La API lee las mismas variables solo para saber si ofrecer la subida.
   - Se descartaron `@ffmpeg-installer/*` (trae ffmpeg 4.1, de 2018: años de vulnerabilidades
     conocidas en los demuxers) y `ffmpeg-static` (descarga un binario de terceros al instalar, y es
     ffmpeg 6.1). Un binario del sistema recibe los parches de seguridad de la distribución.
   - **Producción:** el paquete `ffmpeg` de la distribución en la imagen del worker.
   - **CI:** `apt-get install ffmpeg` en el job de pruebas.
   - **Desarrollo (Windows):** compilación portable oficial enlazada desde ffmpeg.org (gyan.dev),
     verificada con su SHA-256, fuera del repositorio.
2. **Invocación endurecida.** Nunca por shell (`spawn` con argumentos en lista); ningún dato del
   usuario llega a los argumentos (las rutas son temporales y las decide el servidor):
   - demuxer **forzado** según el tipo verificado por bytes mágicos (`-f mov` o `-f matroska`),
     nunca autodetectado;
   - `-protocol_whitelist file`: un archivo manipulado (listas de reproducción, `concat`) no puede
     leer otros archivos del servidor ni hacer peticiones de red;
   - `-nostdin`, límite de tiempo por proceso (se mata al vencer) y concurrencia 1 en el worker;
   - `ffprobe` antes de convertir: tiene que haber pista de video, durar hasta 15 s y medir hasta
     4096 px por lado.
3. **Salida.** MP4 H.264 (`yuv420p`, perfil *high*, tasa acotada), lado corto hasta 720 px sin
   agrandar, hasta 30 cuadros por segundo, **sin audio y sin metadatos** (`-map_metadata -1`: un
   video de celular puede traer la ubicación), con `faststart` para empezar a reproducir antes de
   descargarse entero. Póster: el primer cuadro, en WebP con los mismos anchos que las imágenes. El
   original se borra al terminar (ADR-006 §4).
4. **Legibilidad sobre todo el video.** Los tonos extremos (PP3) se miden sobre un cuadro por
   segundo, no solo sobre el póster: la capa de oscurecido o aclarado que acepta la API alcanza AA
   en cualquier escena del video.
5. **Formatos aceptados:** MP4, WebM y también MOV (`video/quicktime`), que es lo que graba un
   iPhone. Mismo demuxer que MP4; sin él, el público principal del producto no podría subir lo que
   graba con su teléfono.

## Consecuencias

- El worker necesita CPU para convertir: concurrencia 1 para video, y los 15 s / 30 MB acotan el
  costo de cada trabajo.
- **Licencias (a revisar antes de producción):** el ffmpeg con `libx264` es GPL; se usa como
  programa aparte en nuestros servidores, sin distribuirlo, lo que en general no activa las
  obligaciones de la GPL. H.264 está cubierto por patentes (Via LA); el video por internet gratuito
  para el usuario final no paga regalías, pero el uso del codificador en un servicio comercial
  conviene confirmarlo con asesoría legal. Si hiciera falta, el formato de salida se cambia en un
  solo lugar (`packages/storage/src/video.ts`).
