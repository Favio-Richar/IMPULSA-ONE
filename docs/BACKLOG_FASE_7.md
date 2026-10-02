# Backlog — Fase 7 (Crecimiento: integraciones, bloques, embudos) y fases siguientes

Fuente: `PLAN_MAESTRO_PLATAFORMA_IDENTIDAD_DIGITAL.md` §7, §9.3, §9.10–9.15, §12, §14 y §18–19;
`02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` §9–§13. Creado el 2026-09-30 al cruzar el plan
maestro con lo construido. Cada historia usa la Definición de Terminado de `CLAUDE.md`.

## Estado

| Historia | Estado |
|---|---|
| F7.1 — Integraciones de medición: Google Analytics 4 y píxel de Meta (con consentimiento) | Lista para tu revisión (ADR-016; capturas en `docs/design/capturas/f71/`) |
| F7.2 — Webhooks salientes firmados (contacto, reserva, pedido) y conector para Zapier/Make | Lista para tu revisión (ADR-017; capturas en `docs/design/capturas/f72/`) |
| F7.3 — Bloques nuevos: cuenta regresiva, tabla de precios, mapa, video y música incrustados (lista cerrada, sin HTML libre), eventos | Lista para tu revisión (ADR-018; capturas en `docs/design/capturas/f73/`) |
| F7.4 — Suscripción a newsletter con doble confirmación | Lista para tu revisión (ADR-019; capturas en `docs/design/capturas/f74/`) |
| F7.5 — Secuencias de correo automáticas (bienvenida, seguimiento) sobre las automatizaciones | Lista para tu revisión (ADR-020; capturas en `docs/design/capturas/f75/`) |
| F7.6 — Embudos de conversión: pasos, tasas y abandono por paso | Lista para tu revisión (ADR-021; capturas en `docs/design/capturas/f76/`) |
| F7.7 — Modo campaña: página temporal con fecha de inicio/fin y vuelta automática | Lista para tu revisión (ADR-022; capturas en `docs/design/capturas/f77/`) |
| F7.8 — Tienda: variantes, cupones y carrito | Lista para tu revisión (ADR-023): F7.8a variantes, F7.8b cupones y F7.8c carrito (capturas en `docs/design/capturas/f78a/`, `f78b/` y `f78c/`) |
| F7.9 — Reservas: varios profesionales y sucursales; Google Calendar | Lista para tu revisión (ADR-024): F7.9a profesionales y sucursales, F7.9b horarios y bloqueos, F7.9c feed iCal y Google Calendar (capturas en `docs/design/capturas/f79/`). Google Calendar real queda pendiente de tus credenciales OAuth; probado con Google simulado |
| F7.10 — Sitio comercial: Soluciones por rubro, Integraciones, Recursos, Política de privacidad | Lista para tu revisión, contenido corregido (ADR-025; capturas en `docs/design/capturas/f710/`). La política de privacidad es un borrador: faltan datos del responsable, correo de privacidad y revisión legal |
| F7.11 — Superadministración: estado técnico, colas, feature flags, CMS de plantillas | Lista para tu revisión, corregida (ADR-026; capturas en `docs/design/capturas/f711/`) |
| F7.12 — Aislamiento y seguridad de Fase 7 | Lista para tu revisión |

## Historias

### F7.1 — Medición con Google Analytics 4 y píxel de Meta, con consentimiento (ADR-016)

Criterios de aceptación:
- En el panel, cada sitio configura su **ID de medición de GA4** (`G-…`) y su **ID de píxel de Meta**
  (solo dígitos); se validan en el servidor, se pueden quitar, exigen `site.update` y quedan
  auditados. Nunca se acepta un fragmento de código ni una URL: solo el identificador.
- La página pública **no carga nada de terceros sin consentimiento previo**. Si el sitio tiene una
  integración activa, el visitante ve un aviso con **Aceptar** y **Rechazar** con el mismo peso y
  **Configurar** (analítica y publicidad por separado). La elección se recuerda por sitio y
  versión; "Preferencias de cookies" al pie la reabre, y retirar el consentimiento deja de medir.
  La analítica propia anónima de Impulza (ADR-004) sigue igual: no necesita consentimiento.
- Con consentimiento se envían: vista de página, clic en WhatsApp, formulario enviado, reserva
  creada y pedido creado (con valor y moneda), **sin datos personales** (ni nombre, ni correo, ni
  teléfono). La vista previa del constructor nunca mide.
- **CSP y cabeceras de seguridad en `apps/web`** (faltaban, ST §15): la política permite solo los
  orígenes que la página usa de verdad más los dos proveedores, y se prueba que ninguna pantalla
  existente la viole.
- Pruebas: unitarias (validación, consentimiento, mapeo de eventos, cabeceras), e2e de API
  (permisos, validación, aislamiento, auditoría, respuesta pública) y Playwright (nada de terceros
  antes de aceptar; rechazar no carga nada; aceptar carga y mide conversiones; sin violaciones de
  CSP; teléfono y escritorio).

> **Estado (2026-09-30): F7.1 lista para revisión.**
> - Base: migración aditiva `20260930070000_f71_site_measurement` (dos columnas en `sites` con `CHECK`
>   de formato: la base rechaza `G-<script>`) y `down.sql` probado.
> - API: `GET`/`PUT /organizations/:org/sites/:site/measurement` (`site.update`; ANALYST solo lee),
>   validación de solo identificadores (GA4 normalizado a mayúsculas), auditoría **sin** los valores,
>   invalidación de la caché de la página. La respuesta pública lleva `measurement` (opcional en el
>   contrato: una respuesta en caché anterior sigue siendo válida). OpenAPI 164 rutas.
> - Web: aviso de consentimiento con los colores del tema (Aceptar y Rechazar con el mismo peso,
>   Configurar por categoría, "Preferencias de cookies" al pie, elección por sitio y versión en el
>   navegador, 6 meses; leída con `useSyncExternalStore`, sin diferencias de hidratación). GA4 con
>   señales de Google y personalización de anuncios apagadas; píxel de Meta con `consent grant/revoke`;
>   retirar el consentimiento apaga y borra sus cookies. Conversiones por un evento del navegador que
>   anuncian los bloques (formulario, reserva, pedido con valor y moneda) y el clic en WhatsApp, sin
>   datos personales; la vista previa del constructor no mide.
> - **CSP y cabeceras de seguridad en `apps/web` (deuda de ST §15):** política construida desde lo
>   que la página usa de verdad (inventario de orígenes), `form-action` incluye el almacenamiento para
>   la descarga pagada de F5.11b, HSTS y `upgrade-insecure-requests` solo con https. Zod en el
>   navegador sin compilar con `eval` (la prueba de CSP detectó el intento; la configuración ahora se
>   importa antes que cualquier esquema).
> - Panel: tarjeta "Medición" en el sitio con estado Activo/Apagado, dónde encontrar cada ID, aviso de
>   privacidad y validación con las mismas reglas del servidor.
> - Pruebas: validación +4, web +6 (cabeceras), API e2e 4 + casos en la suite central (la prueba de
>   "sin ids internos" en la respuesta pública pidió justificar el campo nuevo), Playwright
>   `medicion.spec.ts` 10/10: **ninguna petición a terceros antes de consentir**, rechazar no carga
>   nada, aceptar carga y mide la vista y el pedido sin datos personales, configurar por categoría y
>   retirar, sin violaciones de CSP. **Suite completa de Playwright 246/246** con la CSP activa; API
>   554/554.
> - Encontrado y corregido en el camino: el panel mostraba el ID tal como se escribió y no el guardado
>   (normalizado); la CSP habría bloqueado la redirección de la descarga pagada sin `form-action`.
> - Decisión abierta para el propietario: si la medición de terceros se restringe por plan
>   (decisión #4). Hoy está disponible en todos.

### F7.2 — Webhooks salientes firmados y conexión con Zapier/Make (ADR-017)

Criterios de aceptación:
- El dueño o un ADMIN (`webhooks.manage`) registra destinos (URL `https`, descripción, eventos) —
  hasta 10 —, los activa o pausa, los edita y los borra; el secreto de firma se muestra una sola
  vez y se puede rotar. Todo queda auditado.
- Eventos: contacto creado, reserva creada o cancelada, pedido creado o pagado, y un evento de
  prueba desde el panel. Cada envío va firmado (HMAC con marca de tiempo), con id de evento
  estable, y se entrega desde el worker con reintentos; nunca hace fallar la operación que lo
  originó.
- **Protección SSRF** probada: URLs a IPs privadas, loopback, metadata de la nube, IPv6 local o
  dominios que resuelven a ellas se rechazan, también si el DNS cambia después de guardar; sin
  redirecciones; tiempo máximo acotado.
- Registro de entregas con estado, código, duración, error e intentos; reenvío manual; `410` o 15
  fallas seguidas desactivan el destino y avisan al dueño; entregas borradas a los 30 días.
- Panel "Integraciones": lista, formulario, secreto con copiar, prueba, registro, y guía de Zapier y
  Make con ejemplos de cada evento y cómo verificar la firma. Estados de carga, vacío, error y éxito;
  teléfono y escritorio.
- Pruebas: unitarias (firma, SSRF, carga útil), e2e de API (permisos, validación, aislamiento,
  auditoría, emisión desde cada evento), worker contra un servidor HTTP real (entrega, reintentos,
  desactivación, retención) y Playwright del panel.

Implementación (2026-09-30):
- `packages/webhooks`: firma, `lookup` anti-SSRF (IPv4, IPv6 y mapeadas; IP literales revisadas antes
  de conectar), envío sin redirecciones (10 s, 4 KB), calendario de 8 intentos, creación y
  procesamiento de entregas (reclamo condicional: nunca dos envíos), mantenimiento y carga útil.
- API `organizations/:id/webhooks` (`webhooks.manage`): alta con el secreto una vez, edición,
  pausa/reanudación, rotación, prueba (`ping` o **ejemplo de cualquier evento** con `test: true`, para
  que Zapier o Make aprendan los campos), registro con filtro y detalle, y reenvío. Tope de 10, URL
  única por organización, todo auditado con el host (nunca la URL ni el secreto).
- Emisión en contactos (API y formularios), reserva pública y anotada, cancelación por el negocio,
  por el cliente y por seña vencida (worker), pedido público, y pago manual o por Mercado Pago.
- Worker: cola `webhook-deliveries` (concurrencia 10), aviso al dueño al desactivar, mantenimiento
  cada hora (reencola entregas colgadas y borra las de más de 30 días).
- Panel "Integraciones": destinos, secreto con copiar, envío de ejemplos, registro con motivo en
  palabras, y guía de Zapier/Make con la forma de cada evento y el código de verificación (probado
  contra el firmador real).
- Pruebas: 16 del paquete, 8 e2e de API + caso en `multi-tenant-isolation`, 9 del worker contra un
  servidor HTTP real, 4 de textos del panel y Playwright en teléfono y escritorio.
- Pendiente del propietario: app propia en el directorio de Zapier (requiere cuenta de desarrollador).

### F7.3 — Bloques nuevos: cuenta regresiva, precios, mapa, música y eventos (ADR-018)

Criterios de aceptación:
- **Cuenta regresiva:** título, fecha y hora en la zona del negocio, texto al terminar y botón
  opcional; al terminar se oculta o muestra su mensaje (a elección). Días, horas, minutos y segundos
  en vivo; la fecha escrita se ve sin JavaScript y es lo que oyen los lectores de pantalla.
- **Tabla de precios:** hasta 4 planes con nombre, precio entero en la unidad mínima y moneda,
  periodo (único, mensual, anual), descripción, hasta 12 características, insignia y plan
  destacado, y botón con enlace seguro.
- **Mapa:** dirección y nombre del lugar; tarjeta propia con "Cómo llegar" (Google Maps y Waze) y
  "Ver mapa", que carga el mapa de Google solo si el visitante lo pide.
- **Música:** enlace de Spotify, SoundCloud o Apple Music, reconocido y guardado como proveedor +
  id; cualquier otro enlace o código de inserción se rechaza con un mensaje claro.
- **Video:** suma TikTok y videos verticales (Shorts), que se ven 9:16.
- **Eventos:** hasta 20 fechas con nombre, inicio y fin opcional (zona del negocio), lugar,
  descripción, imagen y enlace de entradas; se muestran ordenados, los pasados se ocultan solos, y
  cada uno ofrece "Agregar a mi calendario" (.ics). Sin eventos futuros, el bloque no se muestra.
- Todo con validación del servidor (esquemas del catálogo), sin HTML libre; CSP con solo los orígenes
  nuevos; editor del constructor con los campos nuevos (fecha y hora, zona, enlaces) y vista previa
  idéntica a la página publicada; salud de página avisa una cuenta regresiva terminada o eventos
  vencidos. WCAG 2.2 AA, teléfono y escritorio, tema claro y oscuro de la página pública.
- Pruebas: esquemas y analizadores de enlaces (unitarias), render de cada bloque, API (crear cada
  bloque, rechazar enlaces y código ajeno), salud de página, CSP, y Playwright del constructor y de
  la página publicada.

Implementación (2026-09-30):
- `@impulza/validation`: esquemas `countdown`, `pricing`, `map`, `music`, `events` (versión 1);
  analizador de enlaces de música (`music.ts`) y TikTok/Shorts en el de video; fecha de pared + zona
  (`time.ts`, reutiliza las funciones de zona de las reservas). Nuevo `embedFromUrlSchema`: el
  mensaje de un enlace rechazado llega al campo (antes una unión de Zod lo tapaba con "Invalid
  input", también en el video existente). Un `refine` de Zod 4 corre aunque la regex falle: la
  fecha mal formada ya no puede lanzar una excepción en el servidor.
- `@impulza/blocks-renderer`: los cinco bloques; reloj compartido sin desajuste de hidratación
  (`lib/clock.ts`); eventos con .ics y JSON-LD `Event` de schema.org escapado contra `</script>`.
- CSP de `apps/web`: `frame-src` con solo los orígenes nuevos, y una prueba que cruza cada plantilla
  de iframe con la política.
- Constructor: controles de fecha y hora, lista por líneas y música; zona horaria; semillas en la
  zona del negocio. Corrige un defecto previo: un perfil sin `layout` fallaba al primer autoguardado.
- Salud de página: `countdown_ended` y `events_all_past`; botones de precios/eventos revisados; la
  música cuenta como medio pesado.
- Pruebas: 12 de validación nuevas + catálogo, 2 de salud, 13 de render, 7 de CSP, 10 del motor de
  campos, 2 e2e de API y Playwright (constructor y página publicada, teléfono y escritorio).

### F7.4 — Suscripción a newsletter con doble confirmación (ADR-019)

Criterios de aceptación:
- Bloque **Newsletter** en el constructor: título, texto, nombre opcional, texto del botón y mensaje
  final. En la página pública: correo (y nombre si se pidió), casilla de consentimiento explícita y no
  premarcada, honeypot, estados de envío, éxito y error accesibles; en la vista previa no envía.
- La solicitud no crea un contacto: guarda una confirmación pendiente (token hasheado, 48 h) y envía
  el correo con el enlace. Respuesta idéntica exista o no el contacto; a quien ya está suscrito le
  llega un aviso sin enlace. Topes por IP y 3 correos por dirección y sitio cada 24 h.
- `/suscripcion/:token` muestra el negocio y el correo enmascarado y confirma con un clic (no al
  abrir). Al confirmar: contacto creado o actualizado, consentimiento de marketing con fuente,
  versión y fecha, etiqueta `newsletter`, evento en el historial, auditoría, y webhooks/automatizaciones
  de contacto nuevo si corresponde. Idempotente; enlace vencido o inválido con su mensaje.
- El suscriptor queda en la audiencia de las campañas (F5.6) y su baja sigue funcionando igual.
- Panel: en Campañas, suscriptores confirmados, pendientes y nuevos de los últimos 30 días.
- Worker: borra solicitudes no confirmadas vencidas y confirmadas de más de 30 días.
- Medición: `sign_up` (GA4) y `Lead` (Meta) con consentimiento, sin datos personales.
- Pruebas: unitarias (esquemas, correo), API e2e (flujo completo, enumeración, topes, honeypot,
  vencido, idempotencia, aislamiento), worker (purga) y Playwright (bloque publicado y confirmación).

Implementación (2026-09-30):
- Tabla `newsletter_confirmations` (migración `20260930120000_f74_newsletter`, con `down.sql`
  verificada) y valor `NEWSLETTER` en `ContactEventType`.
- API: `POST /public/sites/:slug/newsletter` (202 siempre igual; solo sitios con el bloque en una
  página publicada), `GET|POST /public/newsletter/:token` (ver y confirmar, 410 si venció) y
  `GET /organizations/:id/newsletter/stats`. Token de 32 bytes, solo su SHA-256 en la base.
- `apps/web`: `/suscripcion/:token` (sin índice, sin caché, sin referer) y rutas proxy con los datos
  del visitante para el límite de tasa.
- Bloque `newsletter` en el catálogo, el render y el constructor; tarjetas de suscriptores en
  Campañas; purga diaria en el worker; conversión `sign_up`/`Lead` (ADR-016).
- El foco del resultado (enviado, confirmado) se mueve después de pintar: con `requestAnimationFrame`
  a veces se perdía (lo encontró Playwright en escritorio).
- Pruebas: 4 de validación + medición, 3 de render, 6 e2e de API (incluido aislamiento), 1 del worker
  y Playwright en teléfono y escritorio.

### F7.5 — Secuencias de correo automáticas (ADR-020)

Criterios de aceptación:
- Panel "Secuencias": crear, editar, encender o apagar y borrar secuencias (hasta 10) con un
  disparador del catálogo de automatizaciones más **suscripción confirmada a la newsletter**, y hasta
  10 pasos: espera (horas o días desde el paso anterior), asunto y cuerpo enriquecido con `{{nombre}}`.
  Vista previa, envío de prueba al propio correo, registro de inscripciones con su avance y opción de
  detener una. Estados de carga, vacío, error y éxito; teléfono y escritorio.
- Escribir exige `campaign.manage` (OWNER, ADMIN); ver, cualquier miembro. Cada cambio queda auditado.
- El worker inscribe al contacto una sola vez por secuencia, solo con consentimiento de marketing
  vigente; envía cada paso a su hora, con enlace de baja y `List-Unsubscribe`, sin pasarse del
  límite por hora del plan (compartido con las campañas) y sin duplicar aunque se reintente. La baja
  (desde una secuencia o una campaña) detiene todas sus secuencias; apagar una secuencia la pausa.
- La confirmación de la newsletter (F7.4) dispara el nuevo evento `newsletter_subscribed`, también
  disponible para las automatizaciones.
- Pruebas: unitarias (esquemas, personalización escapada, firma de baja), API e2e (permisos,
  validación, aislamiento, auditoría, evento encolado), worker contra la base real (inscripción,
  envío a su hora, consentimiento, baja, tope por hora, idempotencia, pasos editados) y Playwright.

Implementación (2026-10-01):
- Tablas `email_sequences`, `email_sequence_steps`, `email_sequence_enrollments` y
  `email_sequence_sends` (migración `20261001090000_f75_email_sequences`, reversa verificada).
- `@impulza/validation`: disparador `newsletter_subscribed` (también para automatizaciones),
  esquemas de secuencias, `personalize` (`{{nombre}}` escapado; sin nombre no deja comas sueltas) y
  `sequenceEmail`. `@impulza/auth`: firma de baja con propósito propio para secuencias.
- API `organizations/:id/email-sequences` (CRUD, inscripciones, detener, prueba por paso); el evento
  se encola si hay automatizaciones **o** secuencias; la confirmación de newsletter emite
  `newsletter_subscribed`; `/public/unsubscribe/:token` acepta enlaces de campañas y de secuencias y
  la baja detiene todas las secuencias del contacto.
- Worker: `enrollInSequences` dentro del procesamiento del evento y `dispatchSequences` cada minuto
  (reclamo con concesión de 15 min, fila única por envío, cupo por hora compartido con campañas).
  Verificado contra el código roto: sin el reclamo y la fila única salen 8 correos en vez de 4.
- Panel "Secuencias": lista con cadencia y avance, pausa, personas inscritas y detener; editor con
  pasos ordenables, espera en horas o días, recorrido, vista previa personalizada y prueba por paso.
- Pruebas: 4 de validación, 1 de auth, 6 e2e de API + aislamiento central, 6 del worker, Playwright.

### F7.6 — Embudos de conversión: pasos, tasas y abandono por paso (ADR-021)

Criterios de aceptación:
- Panel "Analítica → Embudos": por sitio, crear, editar, reordenar pasos y borrar embudos (hasta 10
  por sitio, de 2 a 6 pasos). Cada paso tiene un nombre y uno o más eventos del catálogo: vista de
  página (opcionalmente **una** página), clic en bloque (opcionalmente **un** bloque), clic en
  WhatsApp, envío de formulario, contacto nuevo, reserva, pedido y **pago** (pedido pagado o seña
  pagada). Botón "Usar el embudo sugerido" (visita → interacción → contacto/reserva/pedido → pago,
  plan maestro §14.3).
- Informe por rango de fechas (y por dispositivo, opcional): personas-día que llegan a cada paso
  **en orden**, conversión desde el paso anterior y desde el inicio, abandono (cantidad y %) y
  tiempo mediano desde el paso anterior; destaca el paso con más abandono. Gráfico de barras
  accesible (con tabla equivalente), estados de carga, vacío, error y éxito, teléfono y escritorio.
- Datos según ADR-021: visita anonimizada del día (ADR-004 intacto), cálculo en SQL sobre
  `analytics_events` con la columna nueva `subject_id`, pago cruzado con pedidos/reservas sin tocar
  código de cobro. Mismo límite de historial del plan (402) y un año por consulta.
- Leer, cualquier miembro; escribir, `page.manage`. Validación en servidor (pasos, eventos, página o
  bloque del mismo sitio). Auditoría de cada cambio. Log estructurado con la duración del cálculo.
- Pruebas: unitarias (esquemas), API e2e (orden estricto, abandono, pago cruzado, filtros, permisos,
  validación, aislamiento entre organizaciones, auditoría, 402), worker (persiste `subject_id`) y
  Playwright en teléfono y escritorio.

Implementación (2026-10-01):
- Migración `20261001120000_f76_funnels` (reversa verificada: aplicar, `down.sql`, reaplicar):
  columna `analytics_events.subject_id`, índice `(site_id, type, created_at)` y tabla `funnels`.
  El worker (`processAnalyticsEvent`) ya guarda el sujeto de cada evento.
- `@impulza/validation`: `funnelStepSchema`/`funnelStepsSchema`, `createFunnelSchema`,
  `updateFunnelSchema`, `funnelReportQuerySchema` y `SUGGESTED_FUNNEL`; contratos en
  `@impulza/contracts/funnels`.
- API `organizations/:id/sites/:siteId/funnels` (CRUD + `/:funnelId/report`). El cálculo es una
  sola consulta SQL con un CTE por paso; el pago se cruza por la clave de idempotencia de
  `order_created`/`booking_created` con `orders.paid_at` y `bookings.deposit_paid_at` (el sujeto de
  esos eventos es el producto o el servicio y no se cambió). Log `embudo calculado` con la duración.
- Panel "Analítica → Embudos" (pestañas Resumen/Embudos): sitio, período, dispositivo de entrada,
  lista de embudos, sugerido, editor con pasos ordenables y página o bloque opcional, informe con
  indicadores, embudo dibujado con abandono y mediana entre pasos, paso crítico destacado con ícono y
  texto, tabla equivalente, aviso de límite del plan. El resumen enlaza a los embudos.
- Pruebas: 9 de validación, 7 e2e de API (verificadas contra el código roto: sin el orden estricto o
  con el pago tomado de la creación del pedido, fallan), caso en el aislamiento central, persistencia
  del sujeto en el pipeline y Playwright (2 casos × teléfono y escritorio).
- Límite conocido (ADR-021): "recurrencia" no se mide (exige identificar a una persona entre días).

### F7.7 — Modo campaña: página temporal con fecha de inicio/fin y vuelta automática (ADR-022)

Criterios de aceptación:
- Panel "Modo campaña" por sitio: crear, editar, cancelar y borrar campañas (hasta 50 por sitio) con
  nombre, objetivo, página publicada del sitio (nunca el inicio), inicio y fin, `utm_campaign` y la
  opción **tomar el inicio**. Lista con estado (programada, activa, terminada, cancelada) y cuenta
  regresiva al próximo cambio. Estados de carga, vacío, error y éxito; teléfono y escritorio.
- Página temporal: fuera de su ventana la página de la campaña responde 404 y no aparece en el menú
  ni en el sitemap; dentro, se ve normal. Con "tomar el inicio", la raíz del sitio muestra la página
  de la campaña durante la ventana (con los metadatos del inicio) y vuelve sola al terminar.
- Sin solapes: una página en una sola campaña a la vez y un solo "tomar el inicio" por sitio a la vez
  (409 con código estable). Validación en servidor (fechas, página del sitio y publicada, UTM).
- Hora exacta: el worker invalida la caché del sitio al empezar y al terminar cada campaña, una sola
  vez cada una; crear, editar, cancelar o borrar invalida al instante.
- URL con UTM lista para copiar y QR con el módulo existente; reporte separado (visitas a la página
  en la ventana y, de ellas, interacción, contacto, reserva, pedido y pago, por fuente).
- Leer, cualquier miembro; escribir, `site.update`. Auditoría. Log estructurado.
- Pruebas: unitarias (esquemas, estado), API e2e (permisos, validación, solapes, 404 fuera de
  ventana, toma del inicio, reporte, aislamiento entre organizaciones, auditoría), worker (aviso al
  empezar y terminar, una vez) y Playwright en teléfono y escritorio.

Implementación (2026-10-01):
- Migración `20261001150000_f77_page_campaigns` (reversa verificada: aplicar, `down.sql`, reaplicar):
  tabla `page_campaigns` con CHECK `ends_at > starts_at`, índices por sitio y ventana, y las marcas
  `start_revalidated_at`/`end_revalidated_at` del worker.
- `@impulza/validation/page-campaigns`: esquemas de crear/editar, `pageCampaignStatus` (la única
  regla de "vigente", compartida por API, worker y panel; el fin es exclusivo),
  `suggestUtmCampaign` y `pageCampaignUrl`; contratos en `@impulza/contracts/page-campaigns` y
  `homePageSlug` en la respuesta pública del sitio.
- API `organizations/:id/sites/:siteId/page-campaigns` (CRUD, `/:id/cancel`, `/:id/report`).
  Solapes comprobados en una transacción con bloqueo consultivo por sitio (409
  `PAGE_CAMPAIGN_OVERLAP` / `HOME_TAKEOVER_OVERLAP`). La API pública oculta del menú y responde 404
  para páginas de campañas no vigentes, y `apps/web` sirve en la raíz la página que toma el inicio.
  El reporte es SQL: visitas que vieron la página en la ventana y lo que hicieron después, por
  `utm_source`, con el pago cruzado igual que en ADR-021.
- Worker `revalidatePageCampaignBoundaries` cada minuto (segundo 15): reclama la marca de inicio o
  fin, avisa una vez por sitio a `POST {WEB_APP_URL}/api/revalidate` y libera la marca si el aviso
  falla. Se activa con `WEB_APP_URL` y `WEB_REVALIDATE_SECRET` (opcionales en el worker).
- Panel "Sitios → su sitio → Modo campaña": lista agrupada (activas, programadas, terminadas o
  canceladas) con estado recalculado cada 30 s, cuenta regresiva, chip "Toma el inicio", editor con
  UTM que se arma sola y validación con el mismo esquema que la API (al editar solo se envía lo que
  cambió), mensajes de la API por código, "Terminar ahora"/"Cancelar" y "Borrar" con confirmación en
  pantalla, reporte con indicadores y fuentes, enlace por fuente para copiar y QR de la campaña con el
  módulo de Enlaces y QR.
- Pruebas: 9 de validación, 3 de mensajes del panel, 6 e2e de API, 3 del worker (verificadas contra
  el código roto: sin ocultar, sin solapes, sin orden en el reporte o sin liberar la marca, fallan),
  caso en el aislamiento central y Playwright (teléfono y escritorio, contra el build de producción
  de `apps/web`).
- Límite conocido (ADR-022): los bloques programados de F2 siguen sin cambiar a la hora exacta en
  la página en caché; queda como seguimiento.

### F7.8 — Tienda: variantes, cupones y carrito (ADR-023)

Se entrega en tres partes, cada una con su commit y su Definición de Terminado.

**F7.8a — Variantes y líneas de pedido.** Criterios de aceptación:
- En el catálogo del panel, cada producto puede tener hasta 30 variantes (nombre visible, precio
  opcional, stock opcional, SKU opcional, orden, activa). Estados de carga, vacío, error y éxito;
  teléfono y escritorio.
- En la página pública, un producto con variantes activas pide elegir una (con su precio y si queda
  stock) antes de pedir; la API lo exige y toma precio y stock de la variante.
- Cada pedido nuevo guarda sus líneas (`order_items`) con la copia de producto, variante, precio y
  cantidad, y dónde reservó stock; los pedidos existentes reciben su línea con una migración que solo
  inserta. Cancelar devuelve el stock a la variante; reabrir lo vuelve a reservar o responde 409.
- Panel de pedidos, correos y webhooks muestran la variante. Nada cambia en cobros, descargas ni
  reembolsos para un pedido de una línea.
- Escribir variantes, `catalog.manage` (el mismo permiso del catálogo). Auditoría. Validación en
  servidor. Pruebas: unitarias, API e2e (stock por variante sin carreras, exigir variante, variante
  de otro producto u organización, cancelar y reabrir, aislamiento), Playwright.

Implementación de F7.8a (2026-10-01) — lista para tu revisión:
- Migración `20261001180000_f78a_variants_order_items` (reversa verificada: aplicar, `down.sql`,
  reaplicar; el relleno de líneas probado con un pedido de prueba en una transacción revertida):
  tablas `product_variants` y `order_items` con CHECK de stock, precio, cantidad, total de línea y
  fuente de stock; cada pedido existente recibe su línea.
- `@impulza/validation`: `productVariantSchema`, `updateProductVariantSchema`,
  `MAX_VARIANTS_PER_PRODUCT` (30), `productWithVariantName` y `variantId` en el pedido público.
  Contratos: `variants` en el producto y en el catálogo público (precio ya resuelto, sin stock
  exacto), `items` en el pedido.
- API: `POST/PATCH/DELETE .../catalog/products/:productId/variants[/:variantId]` (`catalog.manage`,
  auditoría, 409 por nombre repetido, 422 por tope). El pedido público exige una variante activa del
  mismo producto si tiene alguna, toma su precio y descuenta su stock con actualización condicional;
  el nombre del pedido queda "Producto (Variante)", así correos, Mercado Pago y panel la muestran sin
  cambios. Cancelar y reabrir trabajan por línea (todas o ninguna). Webhooks: `items` en la carga.
- Panel: sección "Variantes" en cada producto del catálogo (agregar, editar, ordenar, pausar,
  borrar); el pedido muestra sus líneas cuando son varias. Página pública: selector de opción
  (radios accesibles, la agotada deshabilitada), precio "Desde" en el botón y total según la opción.
- Pruebas: 4 de validación, 4 del monto escrito en el panel, 1 del precio "Desde", 5 e2e de API
  (verificadas contra el código roto: descontar el stock del producto en vez del de la variante, o no
  devolverlo al cancelar, fallan), caso en el aislamiento central, carga útil de webhooks sin ids
  internos y Playwright (3 casos × teléfono y escritorio). Las pruebas de tienda y cobro existentes
  siguen pasando.
- Hallazgo y corrección en devoluciones (F5.11a): el candado por pago se soltaba antes de guardar lo
  devuelto, y el saldo se validaba con una lectura previa al candado. Dos clics podían responder 200
  los dos (el dinero no se devolvía dos veces gracias a la clave de idempotencia, pero dos parciales
  distintos podían validar contra el mismo saldo). Ahora `CheckoutRefundsService.refund` recibe
  `prepare` (relee el saldo bajo el candado) y `apply` (guarda antes de soltarlo), para pedidos y
  señas; solo suelta su propio candado. Prueba unitaria determinista del orden (falla con el orden
  anterior) y prueba e2e de parciales simultáneos que nunca suman más que lo pagado.

**F7.8b — Cupones.** Criterios de aceptación:
- Panel por sitio: crear, editar, pausar y borrar cupones (código único por sitio, porcentaje o monto
  fijo, mínimo de compra, ventana y tope de usos opcionales), con usos y descuento entregado.
- La página pública acepta un código al pedir; la API calcula el descuento sobre el subtotal, cuenta
  el uso sin pasar el tope aunque lleguen pedidos a la vez, y el cobro en Mercado Pago es por el total
  con descuento. Mensaje único "no es válido" para cualquier código que no aplica, con tope por IP.
- Pruebas: unitarias (cálculo y redondeo), API e2e (tope concurrente, ventana, mínimo, moneda, cobro
  por el total con descuento, aislamiento), Playwright.

Implementación de F7.8b (2026-10-01) — lista para tu revisión:
- Migración `20261001200000_f78b_coupons` (reversa verificada: aplicar, `down.sql`, reaplicar):
  tabla `coupons` (código único por sitio, CHECK de tipo, monto, moneda, mínimo, ventana y usos ≤
  tope) y en `orders` las columnas `discount_amount` (0 por defecto), `coupon_id` (SET NULL) y
  `coupon_code`. La regla del total pasa a `total = precio × cantidad − descuento` (con el descuento
  nunca mayor que el subtotal); la reversa restaura la regla anterior como `NOT VALID`, sin tocar
  ningún pedido ya cobrado.
- `@impulza/validation/coupons`: esquemas, `couponRulesProblem` (las mismas reglas que la base),
  `computeCouponDiscount` (porcentaje hacia abajo, monto fijo sin pasar el subtotal, moneda y mínimo)
  y `couponStatus`. Contratos: `couponResponse` (estado, usos, descuento entregado por moneda),
  `publicCouponCheckResponse`, y `discountAmount`/`couponCode` en el pedido y su confirmación.
- API: `organizations/:id/sites/:siteId/coupons` (leer, cualquier miembro; escribir,
  `catalog.manage`; auditoría; 409 por código repetido; 422 con el campo si las reglas combinadas no
  cuadran o el tope queda bajo los usos). Público: `POST .../catalog/coupons/check` (10 cada 10 min por
  visitante, respuesta uniforme "Ese código no es válido.", no cuenta uso) y `couponCode` en el
  pedido: se revalida, el uso se cuenta con un UPDATE condicional en la misma transacción que el
  stock (todo o nada), y Mercado Pago cobra un solo ítem por el total con descuento (un pedido gratis
  no se cobra en línea ni muestra enlace de pago). Correos con la línea de descuento; webhooks con
  `discountAmount` y `couponCode`; ruta de reenvío en `apps/web`.
- Panel: "Catálogo → Cupones" (lista con estado con ícono y texto, beneficio, condiciones, usos y
  descuento entregado; crear, editar, pausar y borrar) y el cupón en cada pedido. Página pública:
  "¿Tienes un código de descuento?", total recalculado por el servidor; si la persona cambia cantidad u
  opción, el descuento se quita y se pide aplicarlo de nuevo (nunca un total inventado).
- Pruebas: 6 de validación (incluye el correo), 5 e2e de API (verificadas contra el código roto:
  contar el uso sin mirar el tope, o cobrar en Mercado Pago el precio sin descuento, fallan), caso en
  el aislamiento central, ruta de reenvío y Playwright (3 casos × teléfono y escritorio). Las pruebas
  de tienda, cobro y variantes siguen pasando.
- Hallazgo y corrección fuera de la tienda (PP5, acción principal de la página): dos cambios
  simultáneos de la acción principal podían terminar en un deadlock de Postgres y responder 500. El
  cambio ahora toma un candado de transacción por página (`pg_advisory_xact_lock`). La prueba existente
  sube de 4 a 12 cambios a la vez: sin el candado falla siempre, con él pasa siempre.

**F7.8c — Carrito.** Criterios de aceptación:
- En la página pública, "Agregar al carrito" desde cada producto, un carrito por sitio guardado en el
  navegador (solo ids y cantidades), con resumen, cambiar cantidades, quitar, cupón y un solo
  formulario de pedido. Un producto digital se compra solo (se explica en pantalla).
- La API recibe hasta 20 líneas, recalcula todo desde la base, exige una sola moneda, reserva el
  stock de todas o de ninguna, y crea un pedido con sus líneas; el cobro es por el total.
- Pruebas: API e2e (todas o ninguna, moneda mixta, digital mezclado, tope de líneas, aislamiento) y
  Playwright en teléfono y escritorio.

Implementación de F7.8c (2026-10-01) — lista para tu revisión:
- Sin migración: con varias líneas el pedido guarda cantidad 1 y precio = subtotal (corrección
  registrada en ADR-023 §3), así `orders_quantity_range` y `orders_total_consistent` siguen valiendo y
  el cobro, las descargas y los reembolsos no cambian. El detalle está en `order_items`.
- `@impulza/validation`: `cartLineSchema`, `publicCartOrderRequestSchema` (1–20 líneas sin repetir
  producto y variante; el navegador nunca manda precios), `publicCartCouponCheckSchema`,
  `cartOrderSummaryName`; los correos detallan cada línea cuando hay varias.
- API: `POST .../catalog/cart/orders` y `POST .../catalog/cart/coupons/check` (mismos cupos por
  visitante que el pedido suelto). Todo se recalcula desde la base; una sola moneda; un producto digital
  se compra solo; dirección si algo se entrega; el stock de todas las líneas y el uso del cupón se
  reservan en una transacción (todo o nada, el 409 nombra la línea). El pedido suelto y el de carrito
  comparten el mismo código para reservar stock y para lo que sigue al pedido (contacto, eventos,
  cobro en línea, avisos). Rutas de reenvío en `apps/web` con un ayudante común.
- Página pública: "Agregar al carrito" en cada producto no digital (con su opción y cantidad), carrito
  por sitio en el navegador (solo ids y cantidades, validado al leer), barra "Ver carrito" al pie
  (sticky junto a la acción principal: un `fixed` quedaba atrapado por el `@container` de la página) y
  panel en un `<dialog>` nativo con cantidades, quitar, código de descuento, datos y confirmación. Con
  varios bloques de tienda en la página, uno solo muestra el carrito.
- Pruebas: 3 de validación y 1 de correos, 3 del carrito en el navegador, 1 de las rutas de reenvío,
  5 e2e de API (verificadas contra el código roto: ignorar una línea sin stock en vez de revertir todo,
  falla), caso en el aislamiento central y Playwright (3 casos × teléfono y escritorio, incluye que la
  barra esté de verdad en pantalla). Tienda, cobro, variantes, cupones y acción principal siguen
  pasando; `descargas` falla solo en la subida a MinIO (límite conocido del entorno).

### F7.9 — Reservas: varios profesionales y sucursales; Google Calendar (ADR-024)

Entregas planificadas:

**F7.9a — Profesionales, sucursales y asignación de servicios.** Criterios de aceptación:
- Panel por sitio: gestión de **sucursales** (nombre, dirección, teléfono, orden y activo; hasta 20 por
  sitio) y **profesionales** (nombre, título/especialidad, correo, teléfono, avatar opcional, orden, activo
  y sucursal asignada).
- Asignación flexible a servicios (`service_staff`): un servicio puede vincularse a profesionales específicos;
  si no tiene asignaciones, está disponible para todos los profesionales activos del sitio.
- La reserva guarda copia histórica de `staff_id`, `staff_name`, `branch_id` y `branch_name` (un profesional
  o sucursal editado o borrado no altera citas pasadas).
- Actualización matemática de `bookings_no_overlap` en Postgres:
  `COALESCE("staff_id", '00000000-0000-0000-0000-000000000000'::uuid) WITH =` permite que dos profesionales
  atiendan en paralelo a la misma hora en el mismo sitio, garantizando al 100% que ningún profesional sufra
  doble reserva y que sitios sin profesionales sigan operando como un calendario único sin cambios.
- Disponibilidad pública (`/availability`) y reserva pública: soporte para parámetros `branchId` y `staffId`.
  Si se selecciona "Cualquier profesional disponible", el horario está libre si al menos un profesional calificado
  está disponible, y al reservar se asigna atómicamente al profesional libre con menor carga.
- Selector en la página pública: si hay 2 o más sucursales activas, permite elegir sucursal; si hay 2 o más
  profesionales activos calificados, permite elegir profesional o "Cualquiera disponible".
- Pruebas: unitarias de esquemas y asignación, e2e de API (creación de profesionales/sucursales, disponibilidad
  paralela entre profesionales, rechazo de solapamiento en el mismo profesional, asignación automática, aislamiento
  multi-tenant), y Playwright del panel y página pública.

Implementación de F7.9a (2026-10-01) — lista para tu revisión:
- Base de datos (`packages/database`):
  - Migración `20261001220000_f79a_booking_staff_branches`.
  - Nuevas entidades `BookingBranch`, `BookingStaff`, `ServiceStaff`.
  - Copia histórica desnormalizada en `Booking` (`staffId`, `staffName`, `branchId`, `branchName`).
  - Restricción de exclusión PostgreSQL GiST `bookings_no_overlap` actualizada con:
    `COALESCE("staff_id", '00000000-0000-0000-0000-000000000000'::uuid) WITH =` garantizando reservas simultáneas
    con distintos profesionales y exclusión estricta para el mismo profesional o sin profesional asignado.
- Paquetes comunes (`@impulza/validation`, `@impulza/contracts`):
  - Esquemas Zod completos para CRUD de sucursales, profesionales y asignación de servicios.
  - Extracción de `weekly-hours.ts` previniendo dependencias circulares.
  - Contratos OpenAPI actualizados exponiendo `staffName` y `branchName` públicos sin filtrar IDs internos.
- API (`apps/api`):
  - Endpoints CRUD de sucursales y profesionales bajo permisos de configuración de reservas.
  - Cálculo de disponibilidad multi-recurso (`/availability?serviceId=...&branchId=...&staffId=...`).
  - Balanceo de carga automático atómico cuando el visitante elige "any": asigna al profesional calificado libre
    con menor número de reservas activas en el período.
  - Suite E2E `booking-staff-branches.e2e.test.ts` (6/6 pruebas aprobadas al 100%).
  - Aislamiento multi-tenant en `multi-tenant-isolation.e2e.test.ts` validando bloqueo entre organizaciones.
  - OpenAPI regenerado y probado (198 rutas, 272 operaciones).
- Dashboard (`apps/dashboard`):
  - Componentes de administración de sucursales (`booking-branches.tsx`) y profesionales (`booking-staff.tsx`).
  - Integración en `/sitios/[siteId]/reservas` con asignación de servicios por checkboxes.
  - Agenda (`agenda-view.tsx`, `new-booking-form.tsx`) con filtros por sucursal y profesional y asignación manual.
- Página pública y bloques (`packages/blocks-renderer`, `apps/web`):
  - Bloque de reservas con paso interactivo de selección de sucursal y profesional calificado cuando existan 2 o más.
  - Reenvío de parámetros en proxy `/api/bookings/[siteSlug]/availability`.
  - Pantallas de confirmación y gestión ("Tu reserva") detallando sucursal y profesional asignado.

**F7.9b — Horarios semanales y bloqueos por profesional.** Criterios de aceptación:
- Cada profesional puede definir sus propios horarios semanales (`weekly_hours`) o heredar los del sitio.
- Bloqueos de agenda (`booking_blackouts`): opcionalmente vinculados a un `staff_id`. Un bloqueo con `staff_id = NULL`
  cierra todo el sitio; un bloqueo con `staff_id` cierra solo a ese profesional.
- Agenda del panel (`/reservas`): filtros por sucursal y por profesional; visualización clara de quién atiende cada cita.

Implementación de F7.9b (2026-10-01) — lista para tu revisión:
- Dashboard (`apps/dashboard`):
  - `booking-blackouts.tsx`: selector para aplicar bloqueos a "Todo el sitio" o a un profesional específico (`staffId`). Distintivos visuales que muestran si el bloqueo afecta a todo el sitio o a un profesional individual.
  - `booking-staff.tsx`: editor de horarios semanales completos (Lunes a Domingo con tramos horarios configurables) que permite alternar entre "Heredar del sitio" y "Horario propio" por profesional.
  - `agenda-view.tsx` y `booking-card.tsx`: filtros por sucursal y por profesional y visualización clara del profesional asignado a cada reserva.
- API (`apps/api`):
  - Guardado y actualización de `weeklyHours` por profesional (`createStaff`, `updateStaff` con soporte para `null` y revertir a herencia de sitio).
  - Cálculo de disponibilidad respetando horarios semanales por profesional o generales si hereda, y respetando bloqueos generales vs por profesional.
  - Pruebas E2E completas añadidas a `booking-staff-branches.e2e.test.ts` (8/8 pruebas aprobadas al 100%).

Revisión y cierre de F7.9a y F7.9b (2026-10-01) — completadas y verificadas:
- **Borrado de profesionales:** `bookings.staff_id` es `ON DELETE SET NULL` y la exclusión
  `bookings_no_overlap` trata `NULL` como "sin profesional"; borrar a un profesional con reservas vivas
  (`CONFIRMED` o `PENDING_PAYMENT`) dejaba reservas sin dueño y podía hacer chocar dos citas simultáneas.
  Ahora `DELETE …/staff/:id` responde **409** si las tiene (desactivar al profesional sí es posible) y
  el panel muestra el motivo. Prueba e2e `no deja borrar a un profesional con reservas vivas`, verificada
  contra el código roto (sin el chequeo responde 204).
- **Pruebas de interfaz completas (Playwright) ejecutadas y aprobadas al 100%:**
  - `packages/e2e/tests/reservas-equipo.spec.ts`: alta y borrado de sucursales y profesionales con validación; editor de horario propio semanal y bloqueos específicos por profesional; agenda (`/reservas`) con filtros interactivos por sucursal y por profesional.
  - `packages/e2e/tests/reserva-publica-recursos.spec.ts`: flujo completo en página pública con paso interactivo "Preferencias", selectores de sucursal y profesional calificado, opciones "Cualquiera" y "Cualquiera disponible", confirmación detallando sucursal y profesional asignado.
  - Pruebas ejecutadas a resolución móvil (Pixel 7 / 412x915) y escritorio (1440x900) con comprobación estricta de ausencia de desplazamiento horizontal (`expectNoHorizontalScroll`).
  - 10 capturas guardadas en `docs/design/capturas/f79/`:
    `agenda-filtros-escritorio.png`, `agenda-filtros-movil.png`, `equipo-escritorio.png`, `equipo-movil.png`, `horario-bloqueo-escritorio.png`, `horario-bloqueo-movil.png`, `publica-confirmada-escritorio.png`, `publica-confirmada-movil.png`, `publica-preferencias-escritorio.png`, `publica-preferencias-movil.png`.

**F7.9c — Sincronización con calendarios (Feed iCal universal y Google Calendar OAuth).** Criterios de aceptación cumplidos:
- Feed iCal (`.ics`, RFC 5545) universal y seguro con token por sitio y por profesional en `/public/bookings/calendar-feed/:token.ics` para suscripción instantánea en Google Calendar, Apple Calendar y Outlook sin necesidad de cuentas de desarrollador.
- Plegado de líneas a 75 octetos según RFC 5545, rate limiting y cabeceras `Content-Type: text/calendar; charset=utf-8` y `Content-Disposition: inline; filename="reservas.ics"`.
- Rotación segura de tokens por sitio (`POST .../booking/settings/rotate-calendar-feed`) y por profesional (`POST .../booking/staff/:staffId/rotate-calendar-feed`) que invalida el enlace anterior inmediatamente.
- Modelo y adaptador de Google Calendar (`google_calendar_connections`), **de un solo sentido (Impulza → Google)**: crea, mueve y borra el evento de cada reserva; los eventos creados en Google no se traen. Si faltan las credenciales OAuth en el entorno (`GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`), opera en modo desacoplado (`configured: false`) sin fallar ni arrojar 500. Cifrado simétrico AES-256-GCM para tokens.
- Migración `20261001230000_f79c_google_calendar` con `migration.sql` y `down.sql` verificada en ambas direcciones en Postgres.
- Suite de pruebas E2E `calendar-and-google.e2e.test.ts` (8/8 pruebas aprobadas al 100%).
- Prueba de aislamiento multi-tenant en `multi-tenant-isolation.e2e.test.ts` (verificado que ninguna organización puede rotar tokens ni acceder a conexiones de otra).
- Prueba contra código roto realizada y comprobada (filtro de staff en feed iCal).
- Componentes UI en Dashboard (`CalendarSync` en página de reservas del sitio y feed personal en `booking-staff.tsx`).
- OpenAPI regenerado y validado (204 rutas, 279 operaciones).

Revisión de F7.9c (2026-10-01, Claude) — defectos encontrados y corregidos:
- **Regresión en `apps/api/src/env.ts`:** se había borrado `...mercadoPagoOAuthEnvShape` (credenciales de la
  aplicación de Mercado Pago, F5.8): `tsc` fallaba y la conexión de cuentas de Mercado Pago quedaba sin
  configuración. Restaurada (commit `b3e5730`). La entrega afirmaba "tipos y lint limpios": no lo estaban.
- **La sincronización con Google no estaba conectada:** `syncBooking` existía pero nada la llamaba, y
  tampoco renovaba el token de acceso (vence en 1 h). Ahora `syncBookingById` (dispara y olvida, nunca
  bloquea ni hace fallar la reserva) se invoca al confirmar una reserva (pública, manual, seña pagada,
  reactivada), al cancelarla (negocio o cliente) y al reprogramarla. El token se renueva con el refresh
  token; si Google lo revoca la conexión pasa a `ERROR`, el panel lo muestra con «Volver a conectar» y deja
  de intentarse. Tiempo límite de 10 s por llamada a Google. Limitación conocida: el envío no pasa por una
  cola (BullMQ); si el proceso se cae justo después de confirmar, ese evento no se copia.
- **El panel nunca completaba la conexión:** redirigía a Google, pero nada recibía el `code`. Ahora hay una
  ruta fija de retorno `/integraciones/google-calendar` (Google exige una dirección registrada exacta; la
  anterior era distinta por sitio) que cierra la conexión y vuelve al sitio de origen, con estados de
  carga, éxito y error.
- **`state` de OAuth:** era un JSON base64 sin firma que `connect` nunca verificaba. Ahora es HMAC-SHA256
  (clave derivada de `AUTH_ENCRYPTION_KEY`), con nonce y vigencia de 10 min, y ata usuario, organización,
  sitio, profesional y dirección de retorno; `connect` lo exige (`staffId` ya no viaja en el cuerpo). La
  `redirectUri` debe ser del origen del panel (`APP_BASE_URL`).
- **Refresh token:** si Google no lo devolvía se guardaba el token de acceso en su lugar (fallaba en silencio
  una hora después). Ahora se conserva el anterior al reconectar, o se rechaza la conexión.
- **Token del feed en los logs:** el log de cada petición y el filtro de excepciones escribían la URL
  completa, con el token del feed (da acceso a nombres, correos y teléfonos de clientes). `redactPath` lo
  oculta en logs y en Sentry. El cuerpo de error del intercambio de código OAuth ya no se registra.
- **Pruebas nuevas, verificadas contra el código roto (4 mutaciones, todas hicieron fallar la prueba):**
  `google-calendar.service.test.ts` (Google simulado: `state`, redirección, refresh token, renovación,
  revocación, crear/mover/cancelar, nunca lanza), `google-oauth-state.test.ts`, `redact-path.test.ts` y
  Playwright `reservas-calendarios.spec.ts` (el feed se sirve, regenerar revoca el anterior, modo
  desacoplado, retorno de Google con errores). Capturas en `docs/design/capturas/f79/`.
- **Pendiente para Google Calendar real (necesita credenciales de Favio):** crear la aplicación OAuth en
  Google Cloud con la dirección de retorno `<APP_BASE_URL>/integraciones/google-calendar` y poner
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`; con ellas, probar de punta a punta (conectar, reservar, mover,
  cancelar). Hasta entonces solo está probado con Google simulado. Tampoco hay botón para conectar Google a
  nivel de un profesional en el panel (el servidor sí lo soporta con `staffId`).

### F7.10 — Sitio comercial: Soluciones por rubro, Integraciones, Recursos y Política de privacidad (ADR-025)

Criterios de aceptación:
- **Soluciones por rubro (`/soluciones`)**:
  - Presentación comercial detallada para 6 rubros principales: Salud & Bienestar, Gastronomía & Comercios Locales, Creadores & Marca Personal, Tiendas & E-commerce, Servicios Profesionales & Consultorías, Educación & Talleres.
  - Para cada rubro se exponen: problemas típicos resueltos, beneficios clave, bloques recomendados y plantilla recomendada.
  - Filtro/selector interactivo accesible para explorar rubros, con CTAs claros a registro.
- **Integraciones (`/integraciones`)**:
  - Directorio categorizado de integraciones reales y operativas: Pagos (Webpay Oneclick, Mercado Pago), Calendarios (Google Calendar, iCal universal), Automatización (Zapier, Make, Webhooks salientes firmados), Marketing & Medición (Google Analytics 4, Meta Pixel, WhatsApp).
  - Filtro por categoría, buscador en vivo accesible y fichas explicativas de requisitos y cómo conectarlas desde el panel.
- **Recursos (`/recursos`)**:
  - Centro de guías de inicio rápido, estrategias de conversión, buenas prácticas SEO/legales y accesos a soporte y preguntas frecuentes.
- **Política de privacidad (`/privacidad`)**:
  - Documento legal completo y sobrio adaptado a la Ley 19.628 y la Ley 21.719 de Protección de Datos Personales de Chile y principios de privacidad por diseño (ADR-004).
  - Estructura formal: responsable del tratamiento, finalidades, datos recopilados, seguridad y cifrado (AES-256-GCM, Argon2id, HMAC), derechos ARCO y rol de encargado sobre datos de contactos finales.
- **Diseño y navegación institucional**:
  - Estilo sobrio y fondo claro en todo el sitio comercial (blanco `#ffffff`, pizarra suave `#f8fafc`, acento `#0f6f6b`), sin estilo enlace-en-bio.
  - `MarketingHeader` y `MarketingFooter` actualizados con los nuevos enlaces.
  - Cumplimiento estricto de accesibilidad WCAG 2.2 AA y sin desborde horizontal en resoluciones móviles (360/412 px) y escritorio (1440 px).
- **Pruebas y verificación**:
  - Pruebas unitarias de componentes y rutas en `apps/web`.
  - Pruebas de Playwright (`sitio-comercial-paginas.spec.ts`) en proyectos `movil` y `escritorio` con capturas guardadas en `docs/design/capturas/f710/`.
  - Verificación contra código roto.

Implementación (2026-10-01):
- **ADR-025 registrado**: `docs/decisions/ADR-025-sitio-comercial-institucional.md` fijando arquitectura estática, fondo claro (`#ffffff`/`#f8fafc`), tipografía sobria (`#0f172a`), Server Components desacoplados de la API y componentes de cliente interactivos accesibles.
- **Catálogos estructurados (`apps/web/lib/marketing/`)**:
  - `soluciones.ts`: 6 rubros comerciales (Salud & Bienestar, Gastronomía & Locales, Creadores & Marca, Tiendas & E-commerce, Servicios & Consultorías, Educación & Talleres) con problemas, soluciones, bloques recomendados y plantilla.
  - `integraciones.ts`: 10 integraciones operativas categorizadas (Webpay Oneclick, Mercado Pago, Google Calendar, iCal universal, Zapier, Make, Webhooks salientes firmados, GA4 con consentimiento, Píxel de Meta, WhatsApp).
  - `recursos.ts`: 6 guías prácticas de negocio con tiempos de lectura y puntos clave, más 3 accesos a herramientas interactivas.
  - `privacidad.ts`: política legal estructurada conforme a la Ley 19.628 y Ley 21.719 chilena, con vigencia al 1 de octubre de 2026, detallando responsable, rol de encargado, seguridad (AES-256-GCM, Argon2id, enlaces firmados HMAC-SHA256, aislamiento multi-tenant) y derechos ARCO.
- **Páginas e interfaces en `apps/web`**:
  - `/soluciones` (`apps/web/app/soluciones/page.tsx`): Server Component con hero, navegación por rubros, problemas, soluciones, bloques clave y CTA.
  - `/integraciones` (`apps/web/app/integraciones/page.tsx`): Server Component que aloja el componente cliente `IntegracionesDirectory` (`apps/web/components/marketing/integraciones-directory.tsx`) con filtros por categoría y buscador en tiempo real.
  - `/recursos` (`apps/web/app/recursos/page.tsx`): Server Component con artículos de conocimiento, herramientas y banner de soporte.
  - `/privacidad` (`apps/web/app/privacidad/page.tsx`): Documento institucional con índice interactivo, artículos numerados y lista de medidas de seguridad.
  - `MarketingHeader` y `MarketingFooter`: actualizados con enlaces a Soluciones, Integraciones, Recursos y Privacidad, adaptados responsive sin desborde horizontal.
- **Pruebas y aseguramiento**:
  - Pruebas unitarias (`apps/web/lib/marketing/marketing-pages.test.ts`): 9 pruebas de integridad de catálogos, slugs y cumplimiento de privacidad (100 % pasando).
  - Pruebas E2E de Playwright (`packages/e2e/tests/sitio-comercial-paginas.spec.ts`): 8 pruebas (4 en móvil Pixel 7, 4 en escritorio 1440x900) con comprobación estricta de `expectNoHorizontalScroll`, buscador de integraciones y contenido legal.
  - Verificación contra código roto: comprobado en unitario (vaciando problemas de soluciones) y en E2E (alterando el h1 de soluciones); ambas pruebas fallaron según lo previsto y volvieron a verde tras la restauración.
  - Capturas registradas en `docs/design/capturas/f710/`: `soluciones-escritorio.png`, `soluciones-movil.png`, `integraciones-escritorio.png`, `integraciones-movil.png`, `recursos-escritorio.png`, `recursos-movil.png`, `privacidad-escritorio.png`, `privacidad-movil.png`.
  - Chequeo de tipos (`tsc --noEmit`) y linter (`eslint .`) limpios con código de salida 0 en `@impulza/web` y `@impulza/e2e`.

Revisión de F7.10 (2026-10-02, Claude) — el contenido prometía cosas que el sistema no hace:
- **Integraciones:** la cabecera de firma de los webhooks es `Impulza-Signature` (formato `t=…,v1=…`), no
  `X-Impulza-Signature`; el evento `booking.confirmed` no existe (los reales: `contact.created`,
  `booking.created`, `booking.cancelled`, `order.created`, `order.paid`). Un desarrollador que siguiera la
  página no habría podido verificar ninguna firma. Se quitó "con boleta o factura" de Webpay y la
  "generación automática de boletas" de Make (la boleta se emite fuera del sistema).
- **Google Calendar** pasó de "Disponible" a **"Próximamente"** (chip ámbar): está construido y probado con
  Google simulado, pero Impulza aún no tiene su aplicación OAuth con Google. Se dejó explícito que la copia
  va de Impulza hacia Google y se quitó "se actualiza de inmediato".
- **Soluciones:** las plantillas recomendadas tenían nombres y códigos inventados ("Consulta Médica &
  Terapia", `tienda-boutique`…); ahora son las reales del catálogo (Salud y bienestar, Café y gastronomía,
  Creador y marca personal, Tienda y comercio, Profesional de servicios, Eventos y turismo). Se quitaron
  funciones que no existen: venta de cupos con aforo máximo, reservas por cantidad de comensales, bloque
  "Formulario clínico", "Cupones" y "Secuencias" como bloques, "ausentismo a cero", "pagos con Webpay en la
  tienda". Los bloques citados son ahora de `BLOCK_TYPES`.
- **Recursos:** se quitó "emisión automática de comprobantes" y "cumplimiento con las normativas del SII".
- **Privacidad:** se quitó "(ADR-004)" (código interno en un texto público), "nivel bancario e industrial" y
  "TLS 1.3" (sin hosting de producción no hay nada que lo respalde). Verificado y se mantiene: Argon2id,
  AES-256-GCM, HMAC-SHA256 y la IP no guardada con sal por sitio y día (ADR-004). **Pendiente del
  propietario:** razón social, RUT y domicilio del responsable, un correo de privacidad real y revisión de un
  abogado; hoy es un borrador técnico, no un documento legal listo para publicar.
- **Pruebas:** `marketing-pages.test.ts` solo comprobaba "no vacío" (no atrapaba nada). Se agregaron 6 pruebas
  que cruzan el texto con `TEMPLATE_CATALOG`, `WEBHOOK_EVENT_TYPES` y la cabecera real, y que prohíben
  promesas de boletas/SII, códigos ADR y "nivel bancario". Verificadas contra el contenido original: las 6
  fallan; con el corregido pasan (15/15).
- Enlaces internos de las 4 páginas y de la portada comprobados en vivo: ninguno roto.

### F7.11 — Superadministración: estado técnico, colas, feature flags y administración de plantillas (ADR-026)

Criterios de aceptación:
- **Estado técnico de la plataforma (`/admin/operacion`)**:
  - Monitoreo en vivo de los componentes de infraestructura: PostgreSQL (`SELECT 1`, latencia en ms, conteos agregados de `users`, `organizations`, `sites`, `bookings`, `orders`), Redis (ping, latencia, memoria consumida, clientes conectados), Worker HTTP (`/health` en puerto 4100), almacenamiento de medios (MinIO local / R2) y pasarelas de pago configuradas (Webpay Oneclick y Mercado Pago).
  - Métricas del proceso Node de la API: tiempo de actividad (uptime), consumo de memoria (`heapUsed`, `heapTotal`, `rss`) y versión de Node.js.
  - Acceso restringido exclusivamente a superadministradores autenticados mediante `AdminSessionGuard` y protección anti-CSRF (`CsrfGuard`).
  - La inspección del estado queda registrada en la auditoría (`admin.system_health_inspected`).
- **Colas BullMQ y control de tareas en segundo plano (`/admin/operacion`)**:
  - Monitoreo en tiempo real de las 14 colas reales del sistema (`analytics-events`, `analytics-maintenance`, `automation-events`, `media-process`, `media-video`, `webhook-deliveries`, `billing-renewals`, `booking-deposits`, `booking-reminders`, `campaign-dispatch`, `newsletter-maintenance`, `page-campaign-boundaries`, `payment-accounts-refresh`, `sequence-dispatch`).
  - Métricas por cola: trabajos en espera (`waiting`), activos (`active`), completados (`completed`), fallidos (`failed`), demorados (`delayed`) y estado de pausa (`paused`).
  - Acciones de operación para el superadministrador: pausar cola, reanudar cola, reintentar trabajos fallidos y purgar trabajos completados o fallidos antiguos.
  - Cada acción de control de cola queda auditada obligatoriamente con el identificador del superadministrador (`admin.queue_paused`, `admin.queue_resumed`, `admin.queue_retried`, `admin.queue_cleaned`).
- **Feature flags globales y por organización (`/admin/operacion`)**:
  - Modelo persistente en PostgreSQL (`FeatureFlag`, tabla `feature_flags`) con campos `id`, `key` (único), `name`, `description`, `enabled`, `rules` (JSON opcional para reglas específicas por organización o porcentaje), `created_at`, `updated_at`.
  - Migración con su correspondiente `down.sql` verificada en ambas direcciones en Postgres.
  - Banderas iniciales del sistema conectadas a funciones reales:
    - `registros_abiertos`: controla si se permiten nuevos registros de usuarios en la plataforma.
    - `pagos_en_linea`: conmutador maestro de cobros y checkout de planes/pedidos.
    - `ia_generativa`: habilita o pausa las llamadas a proveedores de IA en el constructor y analítica.
    - `campanas_correo`: habilita o pausa el despacho de campañas masivas por el worker.
    - `sincronizacion_calendarios`: habilita o pausa llamadas hacia Google Calendar y generación de feeds.
    - `webhooks_salientes`: habilita o pausa la emisión de eventos hacia destinos de webhooks.
  - Caché de flags en Redis con invalidación instantánea tras cada modificación para evaluación de latencia mínima.
  - Consulta y modificación desde la interfaz de administración, auditada con el actor real (`admin.feature_flag_updated`).
- **CMS y administración de plantillas (`/admin/plantillas`)**:
  - Gestión integral del catálogo de plantillas públicas (`templates` en BD): listado completo con nombre, código, temas, familia de diseño, tags de industria y objetivo.
  - Campos `isActive` (determina si la plantilla se ofrece públicamente y en el onboarding) e `isFeatured` (marca destacada con insignia en la galería).
  - Edición de visibilidad, destacada y orden de aparición (`sortOrder`) desde la UI de superadministración, auditada (`admin.template_updated`).
- **Diseño e interfaz en `apps/admin`**:
  - Página `/operacion` con subsecciones para Estado Técnico, Colas BullMQ y Feature Flags.
  - Página `/plantillas` para el catálogo de plantillas.
  - Navegación actualizada en `AdminNav` con acceso directo a Operación (`Activity`) y Plantillas (`Layers`).
  - Estados de carga, vacío, error y éxito; WCAG 2.2 AA; responsive móvil y escritorio sin desborde horizontal.
- **Pruebas y verificación**:
  - Pruebas unitarias de esquemas y contratos (`@impulza/validation` y `@impulza/contracts`).
  - Pruebas E2E de la API (`admin-operations.e2e.test.ts`), verificando autenticación de superadministrador, rechazo sin 2FA o sin sesión `ADMIN`, CSRF y registro en `AuditLog`.
  - Prueba obligatoria en `multi-tenant-isolation.e2e.test.ts`.
  - Pruebas Playwright en móvil y escritorio con capturas en `docs/design/capturas/f711/`.
  - Verificación contra código roto.
  - Documento OpenAPI regenerado (`openapi.json`), `typecheck` y `lint` limpios en todos los paquetes afectados.

> **Implementación de F7.11 (2026-10-01):**
> - **Base de datos:** migración manual `20261002000000_f711_feature_flags_and_template_admin` con su `down.sql` verificada en ambos sentidos en PostgreSQL. Creación de tabla `feature_flags` e incorporación de columnas `is_active` e `is_featured` en `templates`.
> - **Esquemas y Contratos:** esquemas en `@impulza/validation/src/admin` (`BULLMQ_QUEUES`, `SYSTEM_FEATURE_FLAGS`, `updateFeatureFlagSchema`, `updateTemplateAdminSchema`, `queueActionSchema`) con pruebas unitarias (620/620 passing en validation); contratos de respuesta en `@impulza/contracts/src/admin.ts`.
> - **API y Backend:** controlador `AdminOperationsController` y servicio `AdminOperationsService` registrados en `AdminModule`:
>   - `GET /api/v1/admin/operations/health`: ping y latencia de PostgreSQL con conteos agregados reales, ping y memoria de Redis, chequeo HTTP del worker (:4100), estado de pasarelas y métricas del proceso Node (`heapUsed`, `heapTotal`, `rss`, uptime), auditado con `admin.system_health_inspected`.
>   - `GET /api/v1/admin/operations/queues`: métricas de las 14 colas BullMQ del sistema (`waiting`, `active`, `completed`, `failed`, `delayed`, `paused`).
>   - `POST /api/v1/admin/operations/queues/:name/{pause,resume,retry-failed,clean}`: control de colas, auditado con `admin.queue_*`.
>   - `GET /api/v1/admin/feature-flags` y `PUT /api/v1/admin/feature-flags/:key`: gestión de flags con caché Redis e invalidación inmediata, auditado con `admin.feature_flag_updated`.
>   - `GET /api/v1/admin/templates` y `PATCH /api/v1/admin/templates/:id`: administración CMS de plantillas públicas, auditado con `admin.template_updated`.
> - **Seguridad y Aislamiento:** todos los endpoints protegidos con `AdminSessionGuard` (sesión `ADMIN`, superadmin y 2FA activo en cada petición) y `CsrfGuard`. Verificado en `multi-tenant-isolation.e2e.test.ts` que ni propietarios ni miembros de organizaciones pueden acceder a operaciones de superadmin, y que las reglas de flags por organización aíslan efectivamente a los tenants.
> - **Pruebas contra código roto:** prueba e2e falló de forma controlada al romper la persistencia de feature flags y fue restaurada desde copia. Prueba Playwright falló al romper selectores y fue restaurada.
> - **Documentación OpenAPI:** regenerada con 214 rutas y 289 operaciones (`pnpm --filter @impulza/api run openapi:generate`).
> - **Frontend en `apps/admin`:** pantalla `/operacion` con subsecciones para Estado Técnico, Colas BullMQ y Feature Flags; pantalla `/plantillas` para CMS de catálogo; `AdminNav` actualizado con accesos directos `Activity` y `Layers`. `next build` exitoso con 13 rutas compiladas.
> - **Playwright E2E:** 4/4 pruebas pasadas (`movil` y `escritorio`) en `packages/e2e/tests/admin-operacion.spec.ts` con capturas copiadas en `docs/design/capturas/f711/` (`operacion-escritorio.png`, `operacion-movil.png`, `plantillas-escritorio.png`, `plantillas-movil.png`).

Revisión de F7.11 (2026-10-02, Claude) — defectos encontrados y corregidos:
- **Las banderas no gobernaban nada:** `isFeatureEnabled` no se llamaba desde ningún sitio. Apagar «Registros abiertos» no cerraba el alta de cuentas. Ahora hay un `FeatureFlagsService` global y un `FeatureFlagGuard` conectados a las 6 funciones (ver ADR-026 §3), con prueba e2e de efecto real (registro bloqueado con 503, pedidos bloqueados, vuelve al encender). Además una bandera sin fila se evaluaba como **apagada**: al activar el sistema habría bloqueado registros y pagos; ahora vale su `defaultEnabled`, y una caída de Redis/base deja la función disponible.
- **El CMS de plantillas no tenía efecto:** la galería pública y «aplicar plantilla» ignoraban `isActive`/`isFeatured`. Ahora una plantilla oculta no se lista ni se puede aplicar (404) y las destacadas van primero; test e2e que lo comprueba. Los sitios ya creados no cambian.
- **4 de las 13 colas tenían nombres inventados** (`media-video-process`, `newsletter-confirmation`, `page-campaign-boundary`, `payment-accounts-reconciliation`) y faltaba `analytics-maintenance`: pausar o purgar «esas colas» actuaba sobre colas vacías creadas al vuelo. Corregido a las 14 reales; `queue-names.test.ts` compara la lista con las constantes `*_QUEUE` del código. El test anterior comprobaba los mismos nombres inventados (circular).
- **Estado técnico engañoso:** la URL del worker estaba fija en `localhost:4100` (ahora `WORKER_HEALTH_URL`); almacenamiento y Mercado Pago se leían de variables que no existen (`STORAGE_PROVIDER`, `S3_BUCKET`, `MERCADO_PAGO_ACCESS_TOKEN`, la real es `MERCADOPAGO_ACCESS_TOKEN`), así que mostraba «Mercado Pago deshabilitado» aunque estuviera configurado; ahora usa `parseStorageConfig`, `webpayConfig` y `mercadoPagoConfig`.
- **Ruido en la auditoría:** cada consulta de salud (cada 10 s por pestaña abierta) escribía una fila; ya no se audita una lectura.
- **Panel:** purgar una cola (borra también los trabajos fallidos) y apagar una bandera ahora piden confirmación; las acciones que fallan muestran un aviso (antes se ignoraban); botones solo con ícono tienen nombre accesible; se quitó el «13» y el «:4100» escritos a mano.
- **Pruebas:** `feature-flags.service.test.ts`, `queue-names.test.ts`, 3 e2e de efecto real y las de Google Calendar con la bandera apagada. Verificadas contra el código roto (quitar el filtro `isActive`, evaluar «sin fila» como apagada y quitar la bandera del registro hacen fallar las pruebas).
- **Limitaciones conocidas:** la purga y el reintento actúan sobre hasta 1000 trabajos por llamada; las 14 colas se consultan abriendo una conexión por cola en cada actualización del panel (cada 10 s); `GET /admin/feature-flags` crea las filas por defecto la primera vez; una campaña ya puesta en envío no se detiene al apagar `campanas_correo` (solo se bloquean envíos nuevos).

### F7.12 — Aislamiento y seguridad de Fase 7

Criterios de aceptación:
1. **Aislamiento multi-tenant en datos comerciales (F7.1 a F7.11):**
   - Todo endpoint con datos comerciales nuevos cuenta con prueba explícita de aislamiento entre organizaciones en `apps/api/src/multi-tenant-isolation.e2e.test.ts`.
   - La organización A intenta leer, modificar, listar o borrar datos de la organización B (medición, secuencias, webhooks, variantes, cupones, carrito, sucursales y profesionales de reservas, feed de calendario, embudos, campañas, feature flags y estadísticas de newsletter) y el servidor rechaza con 401, 403 o 404 estricto según corresponda.
2. **Permisos aplicados en el servidor:**
   - La autorización y verificación de roles y membresía ocurre siempre en el backend (`OrganizationMembershipGuard`, `PermissionGuard` con `@RequirePermission`, `AdminSessionGuard`, `CsrfGuard`). Ningún permiso se confía al cliente ni a cabeceras no verificadas.
3. **Privacidad y ausencia de fuga de IDs internos en rutas públicas:**
   - Ninguna ruta pública (`/public/...`) expone identificadores internos de organización, foreign keys ajenas, tokens sin hashear ni datos privados de clientes de otras organizaciones (verificado en respuestas de catálogo, tienda, reservas, newsletter, feeds y analítica).
4. **Secretos fuera de logs y trazas:**
   - Los secretos que viajan en la URL (token de feed iCal, token de newsletter, token de desuscripción, token de descargas, token de gestión de reservas y pedidos, y parámetros `token`, `code`, `secret`, `key`, `state`) son redactados por `redactPath` antes de emitirse en logs estructurados de peticiones y excepciones de Sentry.
   - Secretos de webhooks (`whsec_*`) y tokens OAuth no se registran en texto plano.
5. **Tokens y URLs firmadas con expiración o revocación:**
   - Tokens de confirmación (newsletter: 48 h) expiran y son hasheados (SHA-256 en BD).
   - Feeds iCal: tokens rotables instantáneamente (`rotate-calendar-feed`), invalidando el enlace anterior de inmediato.
   - Enlaces firmados HMAC (OAuth state de Google Calendar: 10 min, unsubscribe, descargas) tienen vigencia y propósito restringido.
6. **Límite de peticiones (Rate Limiting) en rutas públicas nuevas:**
   - Toda ruta pública nueva expuesta a visitantes cuenta con protección de tasa (`RateLimitGuard` con cuota por IP/visitante configurada) para mitigar abusos, fuerza bruta o denegación de servicio.

Implementación y auditoría de F7.12 (2026-10-02) — lista para tu revisión:
- **Auditoría de Rate Limiting y corrección en `CalendarFeedController`:**
  - Se detectó que `CalendarFeedController` (`/public/bookings/calendar-feed/:token.ics`) decoraba `@RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "calendar-feed" })`, pero **carecía de `RateLimitGuard`** en `@UseGuards(FeatureFlagGuard)`. Al no estar el guard en el controlador, el decorador se ignoraba y las peticiones no se limitaban.
  - Se agregó `RateLimitGuard` a `CalendarFeedController` y `@ApiRateLimited(60, 60)`.
  - Prueba de efecto real añadida en `calendar-and-google.e2e.test.ts` verificando que al superar la cuota devuelve 429.
  - **Verificado contra el código roto:** al retirar temporalmente `RateLimitGuard` del controlador, la prueba falló con 200 en vez de 429, y volvió a pasar al restaurarlo.
- **Auditoría de Secretos en Logs y ampliación de `redactPath`:**
  - `apps/api/src/common/redact-path.ts` solo redactaba `/calendar-feed/:token.ics`, omitiendo tokens bearer que viajan en paths públicos de newsletter, unsubscribe, bookings, orders y downloads.
  - Se extendió `redactPath` para ocultar automáticamente tokens de:
    - `/public/newsletter/:token`
    - `/public/unsubscribe/:token`
    - `/public/bookings/:token` (incluyendo `/cancel` y `/reschedule`)
    - `/public/orders/:token`
    - `/public/downloads/:token` (incluyendo `/url`)
    - Parámetros de consulta sensibles (`token`, `code`, `secret`, `key`, `state`).
  - Suite de pruebas unitarias exhaustiva añadida en `apps/api/src/common/redact-path.test.ts` (8/8 pruebas pasando).
  - **Verificado contra el código roto:** al comentar la regla de newsletter, la prueba falló demostrando la fuga del token, y volvió a verde al restaurarla.
- **Aislamiento Multi-Tenant centralizado (`multi-tenant-isolation.e2e.test.ts`):**
  - Se agregó la suite de aislamiento de **Newsletter (F7.4, ADR-019)**: verificado que la organización A recibe 403 Forbidden al consultar `/api/v1/organizations/:id/newsletter/stats` de la organización B, y que los suscriptores confirmados de B no contaminan la audiencia ni el recuento de A.
  - Se corroboró la cobertura de F7.1 (medición), F7.2 (webhooks), F7.5 (secuencias), F7.6 (embudos), F7.7 (modo campaña), F7.8a/b/c (variantes, cupones y carrito), F7.9a/b/c (sucursales, profesionales, horarios, bloqueos, feeds y Google Calendar) y F7.11 (superadmin y feature flags con reglas).
- **Documentación OpenAPI:**
  - Regenerada con 214 rutas y 289 operaciones (`docs/api/openapi.json`), documentando el código 429 en el feed iCal de reservas.

Revisión de F7.12 (2026-10-02, Claude) — la auditoría entregada era parcial y tenía una prueba rota:
- **La prueba de aislamiento de newsletter no pasaba:** insertaba un campo que no existe en `Contact` (`marketingConsent`) y un origen `"newsletter"` cuando `stats` cuenta `newsletter:<sitio>`. Corregida (y reforzada con una confirmación pendiente y la comparación de las estadísticas de A antes y después); rompiendo el filtro por organización de `stats` ahora falla.
- **El criterio 5 afirmaba vigencia que no existe.** Newsletter sí (48 h, hash SHA-256) y el `state` de Google sí (10 min), pero los enlaces de **reserva, baja de correo, descarga y estado de pedido** son `id.firma` HMAC **sin vencimiento**, y solo se revocan todos a la vez rotando `BOOKING_LINK_SECRET`. Los feeds iCal se guardan en texto plano en la base (hay que poder mostrar la URL) y se rotan con un clic. Riesgo bajo hoy: esas respuestas públicas no incluyen nombre, correo ni teléfono del cliente. **Decisión pendiente del propietario:** ¿vencimiento para el enlace de gestión de reserva (p. ej. 30 días tras la cita)?
- **Auditoría convertida en test permanente** (`apps/api/src/security-audit.test.ts`, 5 pruebas sobre las ~295 rutas): (1) toda `@RateLimit` tiene `RateLimitGuard`; (2) toda ruta `/public` tiene límite; (3) todo token en la ruta queda oculto por `redactPath`; (4) toda ruta de organización que modifica datos exige `@RequirePermission`, salvo 4 justificadas (tickets de soporte, audiencia de campaña, lectura comercial con IA para el rol ANALYST). Cada regla verificada rompiendo el código.
- **`redactPath` se prueba donde importa:** `request-context.middleware.test.ts` comprueba que el log de cada petición y el filtro de excepciones (Sentry) usan la ruta redactada; antes solo se probaba la función suelta. Las 6 reglas de redacción verificadas una por una quitándolas.
- **Barrido de accesos por `id` sin filtrar por organización** en los módulos nuevos (bookings, catálogo, campañas, embudos, webhooks, secuencias, newsletter, admin): 29 consultas sin `organizationId` en la misma llamada, todas con el `id` ya autorizado (de una fila verificada, un webhook con firma, un token firmado o el panel de superadministración). Sin hallazgos de acceso a datos ajenos.
- **Secretos en logs:** ningún `logger` registra tokens, secretos ni claves; el secreto de un webhook (`whsec_…`) solo se devuelve al crearlo o rotarlo.
- **Límites de esta auditoría:** el aislamiento se verificó por cobertura de rutas (todas las familias de rutas de F7 aparecen en `multi-tenant-isolation.e2e.test.ts`) y con las pruebas e2e de cada módulo; no se hizo una prueba de intrusión ni se auditaron las dependencias (eso corre en CI).

## Fases siguientes

| Fase | Contenido | Estado |
|---|---|---|
| Fase 8 — Experiencia | Animaciones y microinteracciones en sitio comercial, constructor y onboarding; más plantillas por rubro | Pendiente |
| Fase 9 — Agencia | Modo agencia, marca blanca | Bloqueada (decisión #8) |
| Fase 9 — Moderación | Reportes de abuso y moderación | Bloqueada (decisión #9) |
| Producción | Staging y producción, backups, monitoreo, correo real, R2 (F4.8) | Bloqueada (hosting) |
| Versión 2 | Membresías y cursos, marketplace, wallet y tarjeta digital, PWA | Después de lanzar |

## Pendientes transversales

- F4.6e — Cambiar de plan con uno activo (prorrateo).
- Deuda: timeouts bajo carga en la suite de la API (ya con base de pruebas propia).
