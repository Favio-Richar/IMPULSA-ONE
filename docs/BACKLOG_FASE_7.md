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
| F7.8 — Tienda: variantes, cupones y carrito | Pendiente |
| F7.9 — Reservas: varios profesionales y sucursales; Google Calendar | Pendiente |
| F7.10 — Sitio comercial: Soluciones por rubro, Integraciones, Recursos, Política de privacidad | Pendiente |
| F7.11 — Superadministración: estado técnico, colas, feature flags, CMS de plantillas | Pendiente |
| F7.12 — Aislamiento y seguridad de Fase 7 | Pendiente |

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
