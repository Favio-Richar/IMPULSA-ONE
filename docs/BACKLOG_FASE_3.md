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
| F3.3 — Contactos (mini-CRM) | Pendiente |
| F3.4 — WhatsApp (clic a conversación + analítica) | Pendiente |
| F3.5 — QR y enlaces cortos | Pendiente |
| F3.6 — Eventos analíticos (pipeline + retención) | Pendiente |
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

### F3.4 — WhatsApp (clic a conversación + analítica)
**Criterios de aceptación:**
- El bloque WhatsApp (F2.4) genera un enlace `wa.me` con número validado (formato E.164) y mensaje
  prellenado configurable por el usuario.
- Cada clic público registra un `AnalyticsEvent` tipo `whatsapp_click` (sin PII, según ADR-004) —
  no crea un `Contact` automáticamente (WhatsApp no es un origen de `ContactEvent` en el ERD; solo
  formularios/reservas/compras lo son).
- El conteo de clics es visible en el dashboard de conversión (F3.7), no solo en tablas crudas.

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
