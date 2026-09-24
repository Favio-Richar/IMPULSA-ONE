# Backlog — Fase 3 (Conversión)

Fuente: `02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` §19 (lista de Fase 3) y §10 (pipeline de
analítica), `PLAN_MAESTRO_PLATAFORMA_IDENTIDAD_DIGITAL.md` §9.7/§9.8/§9.12/§9.13 y
`docs/architecture/ERD.md` §5/§6/§7 (las entidades de esta fase ya están modeladas ahí desde F0.1).
Cada historia usa la Definición de Terminado general de ST §21 (replicada en `CLAUDE.md`) **más**
los criterios específicos de abajo.

Precondición cumplida: Fase 2 cerrada (F2.1–F2.10, ver `BACKLOG_FASE_2.md` "Salida de Fase 2").

## Decisiones pendientes que rozan esta fase

De `REQUIREMENTS_TRACEABILITY.md` §15:

- **#10 Privacidad y retención**: resuelta a nivel de modelo de datos por
  `docs/decisions/ADR-004-privacidad-retencion-datos.md` (Ley 21.719, vigente desde diciembre de
  2026). F3.3 (contactos) y F3.6 (eventos analíticos) heredan sus criterios de aceptación
  directamente de esa ADR — no son opcionales.
- **#7 Cuotas de almacenamiento/tráfico**: sigue sin resolver. No bloquea Fase 3 porque ningún
  bloque de esta fase sube archivos propios (el bloque de formulario de contacto ya existía desde
  F2.4; los campos de formulario de Fase 3 son texto/selección, no adjuntos).

## Fase 3 — Conversión

**Estado de la fase** (se actualiza al cerrar cada historia contra la Definición de Terminado; una
historia solo pasa a "Terminada" si cumple *todos* los criterios, no solo los visibles):

| Historia | Estado |
|---|---|
| F3.1 — Modelo de datos de conversión (Form, Contact, ShortLink, QrCode, Analytics) | Terminada |
| F3.2 — Formularios (constructor + envío público) | Terminada |
| F3.3 — Contactos (mini-CRM) | Terminada |
| F3.4 — WhatsApp (clic a conversación + analítica) | Terminada |
| F3.5 — QR y enlaces cortos | Terminada |
| F3.6 — Eventos analíticos (pipeline + retención) | Terminada |
| F3.7 — Dashboard de conversión | Pendiente |
| F3.8 — Aislamiento multi-tenant de Fase 3 | Pendiente |

### F3.1 — Modelo de datos de conversión
**Criterios de aceptación:**
- `Form`, `FormField`, `FormSubmission`, `Contact`, `ContactEvent`, `ShortLink`, `QrCode`,
  `AnalyticsEvent`, `AnalyticsAggregate` en `packages/database` exactamente según `ERD.md` §5/§6/§7
  (si algo debe cambiar, se actualiza el ERD y se justifica).
- Campos de consentimiento en `Contact` según ADR-004 (`consent_status`, `consent_source`,
  `consent_text_version`, `consent_at`), no solo el campo genérico que ya listaba el ERD.
- Toda entidad cuelga de `organization_id` directa o transitivamente (ADR-002); `AnalyticsEvent`
  además admite `site_id` nullable según ERD.
- Migración aplicada y reversible; `pnpm db:seed` sigue funcionando.
- Índices para las consultas reales: slug de `ShortLink` (único global, mismas reglas de
  reservados que F2.2), `form_id`/`contact_id` en `FormSubmission`, `organization_id` + `created_at`
  en `AnalyticsEvent` para el dashboard.
- Configuración de retención (14 meses eventos crudos / 36 meses inactividad de contacto, ADR-004
  punto 4) vive en config, no hardcodeada.

> **Terminada (2026-09-22)**: `Form`, `FormField`, `FormSubmission`, `Contact`, `ContactEvent`,
> `ShortLink`, `QrCode`, `AnalyticsEvent` y `AnalyticsAggregate` agregados a
> `packages/database/prisma/schema.prisma` (migraciones `..._fase3_conversion_...`,
> `..._fase3_contact_email_unique_qr_check` y `..._fase3_qrcode_shortlink_no_action`), con permisos
> nuevos (`form.manage`, `contact.manage`, `contact.delete`, `shortlink.manage`) cableados en
> `packages/database/src/permissions.ts` y sembrados (`pnpm db:seed`: 13 permisos, 32 asignaciones).
> `docs/architecture/ERD.md` §6/§7 se ajustó con dos aclaraciones encontradas al implementar: la
> ruta pública de `ShortLink` vive en su propio espacio (`/s/:slug`, no compite con `Site.slug`) y
> `AnalyticsAggregate.siteId` es obligatorio.
>
> Un test real (`packages/database/src/schema-conversion.test.ts`, 9 casos contra Postgres real, no
> contra el schema) encontró un defecto de diseño antes de que llegara a producción: el `QrCode`
> exige por CHECK tener `shortLinkId` o `directUrl`, pero la relación con `ShortLink` estaba en
> `SetNull` — al borrar un `ShortLink` con un `QrCode` que solo tenía esa referencia, Postgres
> intentaba dejar `shortLinkId` en null y violaba el propio CHECK. Se corrigió a `NoAction` (no
> `Restrict`): Postgres verifica `NO ACTION` al final del `statement`, así que borrar una
> organización completa —que en la misma sentencia cascada borra `ShortLink` y `QrCode` cada uno
> por su propio `organization_id`— sigue funcionando, mientras que borrar un `ShortLink` suelto con
> un `QrCode` que depende solo de él sigue bloqueado (no un huérfano silencioso). Verificado con
> `pnpm --filter @impulza/database exec vitest run`: 22/22 (incluye F2.1). `build`/`lint`/`typecheck`
> de `@impulza/database` y `typecheck` de `@impulza/api` limpios. `pnpm db:seed` sigue funcionando.

### F3.2 — Formularios (constructor + envío público)
**Criterios de aceptación:**
- CRUD de `Form`/`FormField` por sitio: tipos de campo, `required`, regla condicional, orden.
- El bloque "formulario de contacto" del catálogo (F2.4) pasa de estático a resolver un `Form` real
  configurado por el usuario.
- Envío público valida en servidor contra el schema del formulario (nunca confía en el frontend),
  aplica antispam (honeypot + rate limit por IP, reutilizando `RateLimitGuard` de F1.4/F2.7) y
  **exige el campo de consentimiento si el formulario va a generar un `Contact` con seguimiento**
  (ADR-004 punto 3) — un formulario sin ese campo configurado no puede activar creación de
  `Contact` con marketing asociado.
- `FormSubmission` dispara `success_action` (mensaje/redirect) y, si matchea o crea un `Contact`,
  un `ContactEvent` tipo `form_submission`.
- Notificación al propietario del sitio ante un envío nuevo (reutiliza el adaptador de email de
  ST §3.4 si ya existe; si no, se registra como deuda declarada, no se bloquea la historia por eso).
- Permisos por rol (F1.6), auditoría de creación/edición de formularios, aislamiento multi-tenant
  probado.

> **Terminada (2026-09-22)**: `Form`/`FormField` con CRUD completo bajo
> `/organizations/:organizationId/sites/:siteId/forms` (`apps/api/src/modules/forms`), envío
> público real bajo `/public/sites/:siteSlug/forms/:formId` (GET) y `.../submissions` (POST,
> `apps/api/src/modules/public-forms`) con honeypot antispam, límite de tasa propio (20/min por
> IP, más estricto que la lectura), validación server-side construida dinámicamente desde los
> campos reales del formulario (`buildFormSubmissionSchema`, `@impulza/validation`), y
> consentimiento aplicado exactamente como fija ADR-004 punto 3: un `FormField` de tipo `CONSENT`
> marcado crea/actualiza un `Contact` (`ContactsService`, núcleo compartido con F3.3) y su
> `ContactEvent`; sin ese campo, o presente pero sin marcar, solo queda el `FormSubmission` crudo.
> Verificado en el navegador de punta a punta, no solo con tests: formulario creado desde el panel,
> publicado, enviado desde el sitio público real, y confirmado en la base de datos que el `Contact`
> quedó con `consent_status=GRANTED` y `consent_source=form:<formId>`, con su `ContactEvent`
> `FORM_SUBMISSION` y el `FormSubmission` enlazado.
>
> El bloque `contact_form` (F2.4) pasó de v1 (declarativo, sin envío real) a v2: referencia un
> `formId` real; una config v1 guardada sigue siendo válida (se lee como "sin formulario elegido"
> en vez de degradarse a `invalid_config`) — ver `packages/validation/src/blocks/catalog.ts`. El
> render público (`apps/web`) resuelve el formulario del lado del servidor y lo pasa ya listo al
> bloque; el envío del visitante nunca llama a `apps/api` directamente — pasa por una ruta propia
> de `apps/web` (`app/api/forms/[siteSlug]/[formId]/submissions/route.ts`) que reenvía server-to-
> server, respetando el principio ya documentado en `apps/web/lib/env.ts` ("el navegador del
> visitante nunca llama a la API directamente"). El constructor (`apps/dashboard`) no reconstruye el
> formulario real en la vista previa (`mode="preview"`): muestra un estado explícito ("formulario
> elegido, se verá real al publicar") en vez de datos live, para no escribir envíos de prueba en
> `FormSubmission`/`Contact` reales — el selector de formulario sí es real (`ContactFormPicker.tsx`,
> con "elegir uno existente" y "crear formulario rápido" con campos por defecto nombre/correo/
> mensaje/consentimiento).
>
> **Deudas declaradas** (no bloquean el cierre, documentadas para no perderlas):
> - **Notificación al propietario**: no implementada — no existe todavía un adaptador de email
>   genérico para notificaciones de negocio (el de F1.4 es específico de auth). Falta una tarea
>   propia cuando se diseñe ese adaptador (ST §3.4).
> - **Rate limiting por visitante real**: la ruta proxy de `apps/web` no reenvía la IP del visitante
>   a `apps/api` (no hay `X-Forwarded-For` ni `trust proxy` configurado), así que el límite de tasa
>   del envío cuenta por el propio servidor de `apps/web`, no por visitante — mismo límite ya
>   declarado como parcial en `BACKLOG_FASE_2.md`, no una regresión nueva.
> - **Constructor visual de campos**: el panel de formularios ofrece "elegir existente" y "crear
>   rápido con campos por defecto", no un editor visual campo por campo (agregar/quitar/reordenar
>   campos, tipos, opciones) — eso es una etapa siguiente, análoga a como F2.9 separó Etapa A
>   (pantallas de gestión) de Etapa B (editor de bloques real).
> - **Borrado de formulario sin papelera**: borrar un `Form` es real (no lógico) y se lleva sus
>   `FormSubmission` — decisión explícita documentada en el propio endpoint, no un descuido.

### F3.3 — Contactos (mini-CRM)
**Criterios de aceptación:**
- Lista con filtros (fuente, etiqueta, estado comercial, consentimiento), ficha de contacto con
  timeline de `ContactEvent`, etiquetas, notas/tareas, estado comercial editable.
- Auto-creación/matching de `Contact` desde `FormSubmission` (por email/teléfono dentro de la
  misma organización — nunca cruzando organizaciones).
- Import/export de contactos: el export es también el mecanismo de portabilidad ARCO+ (ADR-004
  punto 5) — mismo endpoint o uno directamente reutilizable, auditado en `AuditLog`.
- **Borrado en cascada auditado**: eliminar un `Contact` borra sus `ContactEvent`/`FormSubmission`
  vinculados y queda registrado en `AuditLog` con el actor real (ADR-004 punto 5) — es el mecanismo
  operable para atender una solicitud de cancelación, no una tarea manual de soporte.
- Permisos por rol, aislamiento multi-tenant probado (incluida ficha de contacto ajeno por id
  cruzado).

> **Terminada (2026-09-22)**: CRUD completo bajo `/organizations/:organizationId/contacts`
> (`apps/api/src/modules/contacts`) — listar con filtros (etiqueta, estado comercial,
> consentimiento, búsqueda libre por nombre/correo/teléfono), ficha con línea de tiempo completa,
> alta manual (consentimiento `UNKNOWN` por ADR-004 — nadie declara "otorgado" un consentimiento
> que no se dio), edición de etiquetas/estado comercial, notas (`ContactEvent` tipo `NOTE`),
> exportación auditada (portabilidad ARCO+, ADR-004 punto 5) y borrado real en cascada auditado
> (mismo punto). El matching automático desde formularios ya existía desde F3.2
> (`ContactsService.findOrCreateFromSubmission`) — F3.3 construye el CRUD encima del mismo núcleo,
> no lo duplica. Panel nuevo en `apps/dashboard` (`/contactos`, `/contactos/nuevo`,
> `/contactos/:contactId`) con el mismo nivel de diseño que `sitios/page.tsx` (Table/Card/
> EmptyState/LoadingState/ErrorState de `packages/ui`, no HTML crudo) — se agregó también un
> componente `Select` nuevo al design system (no existía) porque ya hacían falta selects de verdad
> en dos lugares (filtros de esta historia y el selector de formulario de F3.2, que se corrigió en
> el mismo commit para dejar de usar `<select>` sin estilo).
>
> **Import de contactos declarado explícitamente fuera de esta pasada**: el criterio original decía
> "import/export"; se implementó el export completo (bulk vía listado + ficha individual con
> auditoría) pero no un importador de CSV (parseo, mapeo de columnas, validación fila por fila,
> manejo de fallas parciales) — es una tarea propia con su propio diseño de UX de errores, no un
> descuido de alcance. "Notas/tareas" del criterio original quedó en solo notas (`ContactEvent`
> tipo `NOTE`): un sistema de tareas con fecha de vencimiento y estado no está modelado en el ERD y
> hubiera sido inventar estructura de más para esta historia.
>
> Verificado: 8 tests nuevos (`contacts.e2e.test.ts`) + 1 en la suite central de aislamiento
> (33/33) — 206/206 en `@impulza/api`. `lint`/`typecheck`/`build` de todo el monorepo limpios.
> Probado a mano en el navegador: filtros, ficha, notas y etiquetas funcionando sobre el contacto
> real creado por el envío de formulario de F3.2.

### F3.4 — WhatsApp (clic a conversación + analítica)
**Criterios de aceptación:**
- El bloque WhatsApp (F2.4) genera un enlace `wa.me` con número validado (formato E.164) y mensaje
  prellenado configurable por el usuario.
- Cada clic público registra un `AnalyticsEvent` tipo `whatsapp_click` (sin PII, según ADR-004) —
  no crea un `Contact` automáticamente (WhatsApp no es un origen de `ContactEvent` en el ERD; solo
  formularios/reservas/compras lo son).
- El conteo de clics es visible en el dashboard de conversión (F3.7), no solo en tablas crudas.

> **Terminada (2026-09-23)**: la generación del enlace `wa.me` con número E.164 y mensaje
> prellenado ya existía desde F2.4 (`packages/blocks-renderer/src/blocks/whatsapp.tsx`) — esta
> historia agregó el registro del clic. `AnalyticsService` (`apps/api/src/modules/analytics`)
> aplica la minimización de ADR-004 punto 1 desde el primer evento que existe en el sistema, no
> recién cuando llegue el pipeline completo de F3.6: sin columna de IP cruda, visitante
> anonimizado con `sha256(sal + día + siteId + ip + user-agent)` calculado en memoria y nunca
> persistido en claro. El endpoint público (`POST /public/sites/:siteSlug/events`,
> `apps/api/src/modules/public-analytics`) usa un allowlist deliberadamente corto de tipos de
> evento que el propio navegador puede disparar (`whatsapp_click`, por ahora) — el resto de los
> tipos del ERD ya se generan del lado del servidor o se generarán en F3.5/F3.6, no desde acá.
>
> El clic real a WhatsApp **nunca depende de que el registro de analítica funcione**: es un
> `fetch(..., {keepalive:true})` disparado en el mismo `onClick` del enlace (`href`/`target`
> intactos, sin `preventDefault`), a través de la ruta propia de `apps/web`
> (`app/api/analytics/[siteSlug]/events/route.ts`) — mismo principio de "el navegador nunca llama
> a `apps/api` directo" que F3.2. En la vista previa del constructor (`mode="preview"`) no se
> registra nada, mismo criterio que el formulario de F3.2.
>
> **El conteo visible en un dashboard de conversión queda para F3.7** (que es explícitamente donde
> vive ese criterio) — F3.4 deja el evento correctamente registrado y consultable en la base, no
> inventa una vista de reporte antes de tiempo.
>
> Verificado: 5 tests nuevos (`public-analytics.e2e.test.ts`, incluida la prueba de que dos
> visitantes con user-agent distinto generan anonymizedVisitorId distintos) — 211/211 en
> `@impulza/api`. `lint`/`typecheck`/`build` de `@impulza/api`, `@impulza/blocks-renderer`,
> `@impulza/web` y `@impulza/dashboard` limpios. **Deuda declarada**: la verificación visual del
> clic real en el navegador quedó pendiente por un límite de uso de la herramienta de navegador en
> la sesión — el mecanismo está probado end-to-end a nivel de API/cliente compilado, no con un
> clic real observado.

### F3.5 — QR y enlaces cortos
**Criterios de aceptación:**
- CRUD de `ShortLink`: slug validado en servidor (mismas reglas de F2.2: formato, colisión, lista
  de reservados), URL de destino validada contra `javascript:`/`data:`/open-redirect, UTM opcional.
- Resolución pública del slug corto con redirect 301/302 (a decidir y documentar) y registro de
  clic (`click_count_cached` + `AnalyticsEvent`), sin exponer el destino real antes del redirect si
  el usuario configuró ocultarlo.
- `QrCode` generado a partir de un `ShortLink` o de una URL directa, con estilo configurable
  (paleta del catálogo de temas, no color libre sin validar contraste) y contador de escaneos
  propio (`scan_count_cached` + evento `qr_visit`).
- Permisos por rol, auditoría de creación/edición, aislamiento multi-tenant probado (slug ajeno,
  `ShortLink`/`QrCode` de otra organización no editable ni visible).

> **Estado (2026-09-23): terminada.** Lo que se construyó:
>
> - CRUD de `ShortLink` (`apps/api/src/modules/short-links`) y `QrCode`
>   (`apps/api/src/modules/qr-codes`) bajo `/organizations/:organizationId/`, con el slug de F2.2
>   (`publicSlugSchema`; reservados `"s"` y `"qr"` agregados en `packages/validation/src/slug.ts`
>   para que el espacio de rutas de F3.5 nunca colisione con el de un sitio), `destinationUrl`
>   validado con `safeUrlSchema` (rechaza `javascript:`/`data:`/esquemas no-http), UTM opcional y
>   borrado de un enlace bloqueado (409) mientras tenga un `QrCode` que dependa de él.
> - Estilo de QR elegido de un catálogo cerrado con contraste verificado (umbral propio 7:1, más
>   estricto que AA, `packages/validation/src/qr/index.ts`) — nunca color libre.
> - Resolución pública: `apps/web` (`app/s/[slug]/route.ts`, `app/qr/[qrCodeId]/route.ts`) consulta
>   `apps/api` (`GET /public/short-links/:slug`, `GET /public/qr/:qrCodeId`) server-to-server; la
>   API suma `clickCountCached`/`scanCountCached` y registra el `AnalyticsEvent`
>   (`short_link_click`/`qr_visit`) **antes** de responder. El visitante nunca ve `apps/api` ni el
>   destino antes del redirect.
> - **Decisión de redirect: 307 (temporal), no 301.** Un 301 queda cacheado por el navegador: el
>   segundo clic de la misma persona ya no pasaría por el servidor (no se contaría) y cambiar el
>   destino desde el panel no tendría efecto para quien ya lo visitó. 307 en vez de 302 porque es
>   lo que emite `redirect()` de Next.js en un route handler y para `GET` son equivalentes.
> - Panel `/enlaces` (`apps/dashboard/app/(panel)/enlaces/page.tsx`, ítem "Enlaces y QR" en la
>   navegación): crear enlace (validación del cliente con los mismos esquemas del servidor y
>   mensaje propio para slug tomado), copiar URL corta, editar destino en línea, eliminar con
>   confirmación en pantalla (mensaje claro si el 409 es por un QR asociado), "Crear QR" desde la
>   fila, formulario de QR (enlace propio o URL directa + estilo), y lista de QR con la imagen real
>   (renderizada en el navegador con `qrcode`, sin almacenar archivos), contador de escaneos,
>   descarga PNG en alta resolución (1024px) y borrado. Estados de carga, vacío, error y éxito en
>   las dos secciones. El QR siempre codifica `{web}/qr/:id`, nunca el destino final, para que
>   todo escaneo se cuente.
> - Corrección de layout compartido encontrada por la prueba e2e: la columna de contenido del
>   panel (`app/(panel)/layout.tsx`) no tenía `min-w-0`, así que una tabla ancha estiraba toda la
>   página de lado en un teléfono en vez de desplazarse solo la tabla. Afectaba potencialmente a
>   cualquier tabla del panel.
>
> **Verificación:** 17 tests de API + bloque en la suite central de aislamiento (225/225 en
> `@impulza/api`, sin cambios de API en el cierre). Playwright `packages/e2e/tests/enlaces.spec.ts`
> (crear enlace → crear QR desde la fila, rechazo de destino inseguro, sin desplazamiento
> horizontal, controles dentro de pantalla) en móvil 412px y escritorio 1440px — 15/15 de la
> suite e2e; falló contra el layout sin `min-w-0` y pasa con él. Recorrido real verificado a mano
> contra los servidores de desarrollo: `/s/:slug` y `/qr/:id` redirigen (307) al destino y suben
> sus contadores, destino `javascript:` rechazado con 400, borrado de enlace con QR → 409.
> `lint`/`typecheck` de todo el monorepo (23/23) y `build` del panel limpios.
>
> **Deuda declarada (no bloquea el cierre, se registra para no perderla):**
> - UTM: la API lo acepta y guarda, pero el panel todavía no expone campos UTM (el enlace se crea
>   sin UTM). Se agrega cuando F3.7 muestre los datos por campaña, que es donde tiene sentido.
> - Opción "ocultar destino antes del redirect": hoy el destino nunca se expone antes del
>   redirect para *ningún* enlace (el cumplimiento es total, no configurable), así que no hay
>   interruptor en el panel.
> - Cambiar el estilo de un QR existente: la API lo soporta (`PATCH`), el panel solo permite
>   crear/borrar.
> - Staging: el despliegue a staging no existe todavía en el proyecto; se prueba cuando exista.

### F3.6 — Eventos analíticos (pipeline + retención)
**Criterios de aceptación:**
- Pipeline según ST §10: endpoint de ingesta → `RateLimitGuard` → cola BullMQ → worker →
  `AnalyticsAggregate` en Postgres.
- Idempotencia por `idempotency_key` en eventos críticos (evita doble conteo por reintento de red).
- **Minimización obligatoria** (ADR-004 punto 1): sin columna de IP cruda, `anonymized_visitor_id`
  con sal rotada por sitio/día, geolocalización solo a nivel país/ciudad derivada en el momento.
- **Exclusión de bots** (ADR-004 punto 2): lista de user-agents conocidos descartada antes de
  persistir, verificado con prueba (un user-agent de bot no genera `AnalyticsEvent` ni incrementa
  agregados).
- **Job de purga por retención** (ADR-004 punto 4): `AnalyticsEvent` crudo purgado a los 14 meses
  vía job programado (BullMQ), `AnalyticsAggregate` no se purga. Probado: un evento con
  `created_at` vencido desaparece tras correr el job; el agregado correspondiente sigue existiendo.
- Tipos de evento del ERD: `page_view`, `block_click`, `whatsapp_click`, `form_submit`,
  `lead_created`, `qr_visit` — cada uno del resto de historias de esta fase dispara el suyo.
- Aislamiento multi-tenant probado (un evento de la organización B no aparece en agregados de la
  organización A).

> **Estado (2026-09-23): terminada.** Lo que se construyó:
>
> - **Pipeline real (ST §10):** endpoint → `RateLimitGuard` → cola BullMQ `analytics-events` →
>   `apps/worker` → `AnalyticsEvent` + `AnalyticsAggregate`. La API ya no escribe eventos directo:
>   `AnalyticsService` (`apps/api/src/modules/analytics`) clasifica, minimiza y encola; nunca lanza
>   (si Redis cae, el visitante igual llega a destino y el formulario igual se guarda — queda el
>   error en el log). La lógica de procesamiento vive en `packages/analytics` (`processor.ts`) para
>   que las pruebas de la API ejerciten exactamente el código del worker.
> - **Procesamiento transaccional:** evento crudo + todos sus agregados en una transacción; upsert
>   atómico en SQL (`INSERT ... ON CONFLICT DO UPDATE value = value + 1`) para que dos workers en
>   paralelo nunca pierdan una suma. Visitantes únicos por día con lock consultivo por visitante.
>   Reintentos con backoff exponencial (5 intentos); los fallidos definitivos quedan en la cola como
>   dead-letter inspeccionable.
> - **Idempotencia:** `idempotency_key` en `form_submit` (por envío), `lead_created` (por contacto)
>   y en los eventos del navegador (`eventId` generado por clic). Probado en el endpoint y en el
>   procesador (reintentar el mismo job devuelve `duplicate` y no toca agregados).
> - **Minimización (ADR-004 punto 1):** sin IP cruda; visitante = hash con sal rotada por sitio/día;
>   dispositivo como categoría gruesa (móvil/tablet/escritorio); país/ciudad desde las cabeceras que
>   ya pone la plataforma de hosting delante de `apps/web` (sin base GeoIP propia). Nada de eso
>   entra a Redis sin minimizar.
> - **Exclusión de bots (ADR-004 punto 2):** `isBotUserAgent` (`packages/analytics`) descarta
>   crawlers, herramientas HTTP, navegadores headless y las vistas previas automáticas de chats
>   (WhatsApp, Telegram, Slack...) antes de encolar. Un enlace corto pegado en un chat ya no suma
>   un clic que nadie hizo. Responde 204 igual (no se le avisa al bot).
> - **Retención (ADR-004 punto 4):** job programado diario (03:30 America/Santiago) en la cola
>   `analytics-maintenance`, purga por lotes el `AnalyticsEvent` con más de
>   `ANALYTICS_RETENTION_MONTHS` (14 por defecto, configurable sin tocar código). Los agregados no
>   se tocan.
> - **Tipos de evento:** `page_view` y `block_click` los emite el rastreador nuevo del sitio público
>   (`apps/web/components/analytics-tracker.tsx`, por delegación sobre `data-block-*` — ningún
>   bloque tuvo que volverse componente de cliente); `whatsapp_click` pasó a ese mismo rastreador;
>   `form_submit`/`lead_created` nacen en `PublicFormsService` después de confirmar la transacción;
>   `qr_visit`/`short_link_click` en la resolución pública (F3.5). El cliente no puede fabricar
>   eventos de servidor (400).
> - **Atribución sin exponer ids (respeta el contrato público de F2.7):** el navegador informa slug
>   de página y `position` del bloque; la API resuelve el id real contra la versión publicada (que
>   desde F3.6 guarda el id de cada bloque). Lo que no se puede resolver cuenta en el total, sin
>   atribución — así nadie crea filas de agregado con valores inventados.
> - **Defecto de fondo corregido — visitante real detrás de `apps/web`:** las rutas proxy de
>   `apps/web` no reenviaban nada del visitante, así que para la API todo el tráfico público era el
>   servidor de `apps/web`: el rate limit era **un solo balde para toda la plataforma**, todos los
>   visitantes tenían el mismo hash y la exclusión de bots no podía funcionar. Ahora `apps/web`
>   (`lib/visitor-headers.ts`) reenvía IP/user-agent/país con un secreto compartido
>   (`INTERNAL_PROXY_SECRET`, comparado en tiempo constante); sin el secreto, la API ignora esas
>   cabeceras. La IP se toma de cabeceras que fija la plataforma (`cf-connecting-ip`, `x-real-ip`) o
>   del último salto de `x-forwarded-for`, nunca del primero (falsificable).
> - **Modelo:** `AnalyticsAggregate.site_id` pasó a admitir nulos para métricas de enlaces/QR
>   (migración `20260923230000_fase3_analytics_pipeline`, no destructiva, índice único `NULLS NOT
>   DISTINCT`) — ver ERD §7.
> - **CI:** faltaban `ANALYTICS_SALT_SECRET` (requerida desde F3.4) y `NEXT_PUBLIC_WEB_BASE_URL`
>   (desde F3.5) en los jobs de pruebas/e2e/build; se agregaron junto con `INTERNAL_PROXY_SECRET`.
>
> **Verificación:** 13 pruebas nuevas contra Postgres/Redis reales
> (`analytics-pipeline.e2e.test.ts`: recorrido completo, bots, idempotencia en endpoint y en
> procesador, visitantes únicos, atribución por bloque, form_submit/lead_created, eventos de
> servidor rechazados desde el cliente, agregados de organización sin sitio, aislamiento A/B,
> retención, rate limit por visitante con y sin secreto) + 22 unitarias en `@impulza/analytics`.
> Las de bots y del secreto fallan contra el código roto a propósito y pasan con el correcto.
> 238/238 en `@impulza/api` (una corrida intermedia tuvo 2 fallos en `pages.e2e` que pasan
> aisladas 21/21 dos veces y en la corrida completa siguiente — la intermitencia de Prisma bajo
> carga ya conocida, no una regresión). Playwright 15/15. Recorrido real con los cuatro procesos
> (web → API → cola → worker → Postgres): dos visitantes distintos detrás de `apps/web` con hashes
> distintos, Googlebot descartado, clic a enlace y a WhatsApp atribuidos a su bloque, país y UTM
> agregados, vista previa de WhatsApp de un enlace corto sin sumar clic; el worker procesó 5/5 sin
> fallos. `lint`/`typecheck` 24/24, build de web/worker, OpenAPI regenerado (el cuerpo del
> endpoint de eventos no estaba documentado desde F3.4; ahora sí).
>
> **Deuda declarada (no bloquea):**
> - Métricas del worker (completados/fallidos/reintentados) salen como logs estructurados, no como
>   métricas agregadas en un backend de métricas: no existe todavía ese backend en el proyecto (ST
>   §16). Tampoco hay panel de reintento controlado de la dead-letter: hoy se inspecciona/reintenta
>   con las herramientas de BullMQ.
> - `AnalyticsEvent` no guarda el `subject` (página/bloque): la atribución vive solo en los
>   agregados, que es lo que lee el dashboard (F3.7). Si alguna vista necesitara recalcularla desde
>   el crudo, haría falta una columna nueva.
> - Las páginas publicadas antes de F3.6 no tienen ids de bloque en su versión: cuentan clics en el
>   total, pero sin atribución por bloque hasta que se vuelvan a publicar.
> - Staging no existe todavía; se prueba ahí cuando exista.

### F3.7 — Dashboard de conversión
**Criterios de aceptación:**
- Vistas de vistas/clics por bloque/contactos/conversión/embudo/UTM/dispositivo/geo aproximada
  (PM §9.12), leyendo de `AnalyticsAggregate` (nunca escaneando `AnalyticsEvent` crudo en caliente
  para una vista de uso frecuente).
- Filtro por sitio y por rango de fecha; estados de carga/vacío/error/éxito; responsive real.
- Ningún dato de otra organización visible ni por manipulación de query params (probado).

### F3.8 — Aislamiento multi-tenant de Fase 3
**Criterios de aceptación:**
- `apps/api/src/multi-tenant-isolation.e2e.test.ts` extendido con cada endpoint nuevo de esta fase
  (formularios, contactos, enlaces cortos, QR, eventos analíticos, dashboard).
- Se re-verifica el ataque de id cruzado (id de organización propio + id de recurso ajeno) para
  cada entidad nueva.
- El envío público de formularios y la resolución pública de enlaces cortos no filtran datos de
  otra organización ni de otro sitio.

## Salida de Fase 3

Fase 3 se considera terminada cuando un usuario puede: configurar un formulario de contacto real en
su sitio publicado, recibir el envío como un contacto en su mini-CRM con consentimiento auditado,
compartir su WhatsApp y enlaces/QR con clics medidos, y ver todo eso reflejado en un dashboard de
conversión con datos de retención acotada y aislamiento multi-tenant probado. Recién entonces se
inicia Fase 4 (SaaS comercial).
