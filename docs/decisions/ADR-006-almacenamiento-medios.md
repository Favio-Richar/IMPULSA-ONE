# ADR-006: Almacenamiento y entrega de medios (imágenes y video)

- **Estado:** Aceptado. Favio aprobó Cloudflare R2 y la prioridad de la página pública premium el
  2026-09-24 ("cloudflare r2 ok, adelante"). Las credenciales las configura él al final: el sistema
  se desarrolla y se prueba sin ellas.
- **Fecha:** 2026-09-24
- **Resuelve:** decisión #7 del propietario (almacenamiento y cuotas), en su parte técnica. Los
  números de cuota siguen siendo los del catálogo de planes, editables desde `apps/admin`.
- **Fuente:** `docs/research/ANALISIS_MERCADO_2026-09.md` §5; ST §3.4 (adaptadores de proveedores);
  PM §9.6 (biblioteca multimedia); `docs/BACKLOG_PAGINA_PREMIUM.md`.

## Contexto

La página pública no puede tener foto de perfil, portada, galería ni fondo con imagen o video porque
no existe subida de archivos. Los bloques ya aceptan imágenes como `{url, alt}` con cualquier URL
`https`, lo que obliga a los clientes a alojarlas en otro lado. Sin medios propios, la página no
alcanza el nivel visual que exige el producto.

## Decisión

1. **Proveedor: Cloudflare R2**, por su API compatible con S3 y porque no cobra por la descarga (lo
   que más pesa con video de fondo). Todo pasa por un `StorageAdapter` en `packages/storage` (ST
   §3.4), así que cambiar a S3, GCS o Backblaze es cambiar la configuración, no el código.
   - Desarrollo local: **MinIO** (ya está en `docker-compose.yml`, perfil `storage`), que habla el
     mismo protocolo.
   - Pruebas e2e de la API: un adaptador falso en memoria, igual que el de email. El adaptador S3
     real se prueba contra MinIO.
2. **Subida directa del navegador al bucket**, con URL prefirmada que emite la API. Los bytes no
   pasan por la API, que no se satura. La firma fija el tipo y el tamaño exactos declarados, vence
   en 10 minutos y apunta a una clave que decide el servidor
   (`org/{organizationId}/{assetId}/original`), nunca el cliente.
3. **Confirmación con verificación real:** tras subir, el panel llama a "confirmar". La API revisa
   en el bucket el tamaño real y los **bytes mágicos** del archivo (no confía en la extensión ni en
   el `Content-Type`). Si no coinciden, borra el objeto y rechaza.
4. **Procesamiento en el worker (BullMQ, ya existente):** cada imagen se re-codifica a WebP en
   anchos fijos (400, 800, 1600 px, sin agrandar nunca). Eso:
   - hace que la página pública cargue liviana en el teléfono (presupuesto: LCP < 2,5 s en 4G);
   - **elimina los metadatos EXIF**, que en fotos de celular suelen traer la **ubicación GPS** de
     quien la tomó (privacidad, Ley 21.719).

   El asset pasa por `PENDING_UPLOAD` → `PROCESSING` → `READY` (o `FAILED`). Los bloques solo pueden
   usar assets `READY`.
5. **Tipos permitidos, en lista cerrada:**
   - Imágenes: JPEG, PNG, WebP y AVIF, hasta 8 MB y 40 megapíxeles. **Nunca SVG**, porque puede
     llevar scripts y abre un XSS almacenado.
   - Video propio (historia posterior, PP6): MP4 o WebM, hasta 30 MB, transcodificado en el worker
     a MP4 H.264 de 720p sin audio, con póster.
6. **Cuota por plan:** el límite `storageMb`, que existía en el catálogo sin aplicarse, **se aplica
   desde ahora** al emitir la URL de subida, sumando lo ya guardado más lo pendiente. Esto sigue el
   mismo patrón de F4.2: 402 `PLAN_LIMIT_REACHED` y lock por organización, así dos subidas
   simultáneas no pasan juntas el límite.
7. **Entrega pública:** el bucket se lee públicamente solo por el dominio de medios
   (`STORAGE_PUBLIC_BASE_URL`, un dominio propio en R2 con CDN de Cloudflare). Las claves llevan UUID
   y no se pueden adivinar ni listar. Subir solo es posible con una URL prefirmada. El CORS del bucket
   acepta subidas solo desde el origen del panel.
8. **Borrado seguro:** no se puede borrar un asset que un bloque o un fondo esté usando; la respuesta
   dice dónde se usa. Al borrarlo, se eliminan todas sus variantes del bucket. Borrar una
   organización borra sus objetos (tarea del worker).
9. **Aislamiento (ADR-002):** `MediaAsset.organizationId` es obligatorio y cada operación se resuelve
   por membresía. Además, un bloque solo acepta una URL de medios propia si el asset pertenece a la
   misma organización; una URL de medios de otra organización se rechaza al guardar.

## Alternativas consideradas

- **Subir a través de la API (multipart):** es más simple, pero cada megabyte pasa por el proceso
  Node, bloquea recursos del monolito y complica el rate limiting. Descartada.
- **Procesar las imágenes en la API al confirmar:** ocupa CPU en la ruta de las peticiones.
  Descartada: esto es exactamente para lo que existe el worker.
- **Servir el original sin variantes:** una foto de celular pesa 3–6 MB y rompería el presupuesto de
  carga en móvil. Descartada.
- **S3 de AWS:** equivalente técnico, pero cobra por la descarga, justo lo que el video de fondo
  consume. Queda como alternativa gracias al adaptador.

## Consecuencias

- Positivo: fotos, portadas, galerías y fondos propios, livianos y sin datos de ubicación.
- Positivo: cambiar de proveedor es cambiar la configuración.
- Negativo: el worker pasa a necesitar `sharp` (y `ffmpeg` desde PP6). Esto pesa en la decisión de
  hosting (F4.8).
- Negativo: sin credenciales de R2 no hay subidas en producción. En desarrollo funciona con MinIO, y
  la API arranca igual sin configuración de almacenamiento: la biblioteca de medios responde
  "almacenamiento no configurado" en vez de fallar.
