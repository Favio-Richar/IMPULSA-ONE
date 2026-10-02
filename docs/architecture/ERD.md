# ERD — Impulza One (núcleo MVP)

Estado: propuesta inicial a partir de las entidades listadas en `02_STACK_...md` §8. Cubre el
núcleo del MVP (§6.1 del stack doc); las entidades de reservas/tienda/pagos de negocio se agregan
en Fase 5 y no se incluyen aquí para no crear tablas vacías antes de tiempo.

Convenciones: UUID para IDs expuestos, timestamps UTC, dinero en enteros de unidad mínima +
código ISO de moneda, soft delete solo donde el negocio lo requiere.

## 1. Identidad y organizaciones

```text
User (1) ──< Membership >── (1) Organization
User (1) ──< Session
User (1) ──< Account            (proveedores OAuth, ej. Google)
Organization (1) ──< Site
Membership (N) ──1 Role ──< Permission   (RBAC explícito)
```

- **User**: id, email, password_hash, email_verified_at, is_super_admin (ADR-005: solo lo otorga el
  script de operación del servidor, siempre con 2FA), created_at, updated_at.
- **Session**: id, user_id, scope (`USER` panel | `ADMIN` superadministración, ADR-005 — cada guard
  acepta solo la suya), created_at, expires_at, device/user_agent, ip (truncada/hasheada).
- **Account**: id, user_id, provider, provider_account_id (login social).
- **Organization**: id, name, slug, plan_id, status (`ACTIVE` | `BLOCKED`), blocked_at,
  blocked_reason, created_at. Bloqueada (F4.4, ADR-005 §6) = superficies públicas en 404 y panel en
  solo lectura; el motivo lo ve la propia organización.
- **Membership**: id, user_id, organization_id, role_id, status, invited_at, accepted_at.
  - Un `User` puede tener muchas `Membership` (N orgs). Una `Organization` tiene muchas
    `Membership` (N usuarios).
- **Role** / **Permission**: catálogo de roles (OWNER, ADMIN, EDITOR, ANALYST, SUPPORT,
  AGENCY_MANAGER, SUPER_ADMIN) y permisos explícitos asociados. `SUPER_ADMIN` existe en el
  catálogo pero **no** se asigna por membresía: la superadministración es `User.is_super_admin`
  (ADR-005 §1).

## 2. Planes y suscripción del propietario

```text
Plan (1) ──< Subscription >── (1) Organization
Plan (1) ──< UsageCounter >── (1) Organization
```

- **Plan**: id, code, name, price_monthly, price_yearly (unidad mínima de moneda, nunca float),
  currency, limits (JSON validado con `planLimitsSchema` de `@impulza/validation`: sites,
  pagesPerSite, forms, contacts, shortLinks, qrCodes, members, analyticsHistoryDays, storageMb —
  `null` = sin límite), sort_order. Catálogo sembrado desde `PLAN_CATALOG` (valores provisorios
  hasta la decisión #4, F4.1). Desde F4.4 la tabla es la fuente de verdad y se edita desde
  `apps/admin`: el seed solo crea los planes que falten, nunca sobrescribe (ADR-005 §7).
- **Organization.plan_id**: plan asignado a mano por superadministración (F4.4). El plan
  **efectivo** lo resuelve el servidor en un solo lugar (`PlansService`): suscripción vigente →
  plan asignado → Gratis. Por eso una organización sin `plan_id` ni suscripción ya está en Gratis
  sin necesidad de reescribir filas.
- **Subscription**: id, organization_id, plan_id, status, current_period_start/end,
  external_provider_ref (referencia del proveedor de pago, nunca datos de tarjeta). Desde F4.6a
  (ADR-012) también pasarela, ciclo, referencia cifrada del medio de pago, marca y últimos 4
  dígitos, cancelación al fin del período, primer cobro (retracto) y morosidad; detalle en §9i.
- **UsageCounter**: id, organization_id, metric, period, value — para aplicar límites de plan.

## 3. Sitios, páginas y bloques

```text
Organization (1) ──< Site (1) ──< SiteDomain
Site (1) ──< SiteSlugRedirect
Site (1) ──< Page (1) ──< PageVersion
Page (1) ──< Block (1) ──< BlockVersion
Site (N) ──1 Theme
Site/Page (N) ──1 Template (opcional, origen de la página)
```

- **Site**: id, organization_id, name, slug (único global), status (draft/published/archived), theme_id.
  Desde PP3, `background` (JSON opcional, `siteBackgroundSchema`: color, degradado del catálogo, imagen
  de la biblioteca propia o video curado, con capa de legibilidad). Se aplica en vivo, como el tema.
- **SiteDomain**: id, site_id, domain, type (subdominio/propio), verification_status, ssl_status.
- **SiteSlugRedirect**: id, site_id, from_slug (único global), created_at.
  - Agregado en F2.1 (no estaba en la versión original de este ERD): lo exige el criterio de F2.2
    ("cambiar el slug de un sitio publicado deja una redirección registrada") y PM §9.14
    ("Redirecciones"). Sin esto, renombrar un sitio publicado rompe todos sus enlaces vivos.
- **Page**: id, site_id, slug (único por site), order, visibility, seo_meta, status, is_home.
  - `is_home` marca la página de inicio no eliminable del sitio (F2.3).
  - Nota de implementación: `order` es palabra reservada de SQL, así que en Prisma el campo se
    llama `position` (mismo concepto). Aplica igual a **Block**.
- **PageVersion**: id, page_id, version_number, content_snapshot, published_at, created_by.
  - Guarda el historial versionado exigido por el constructor (borrador vs. publicado, restauración).
- **Block**: id, page_id, type, order, config_schema_version, visible, scheduled_start/end.
  - PP5: `is_primary` (acción principal de la página). A lo sumo uno por página: índice único
    parcial `blocks_one_primary_per_page (page_id) WHERE is_primary`. Solo tipos de acción
    (`PRIMARY_ACTION_BLOCK_TYPES`), regla del servicio.
- **BlockVersion**: id, block_id, version_number, config (JSON tipado por `type`), created_at.
- **Theme**: id, organization_id (nullable si es tema global del catálogo), tokens (paleta,
  tipografía, espaciado).
  - PP4: `tokens.fontFamily` admite además las parejas `executive` y `vibrant` (títulos + texto,
    fuentes alojadas en el propio sitio); PL2 suma `editorial` (Fraunces + Inter) y la línea
    `oscuro`, cuyo fondo sugerido (`defaultBackground`, degradado) vive en el catálogo, no en `Site`. La línea del catálogo (`ejecutivo`/`vibrante`/`clasico`)
    no es columna: la API la deriva de `code` con `THEME_CATALOG`.
- **Template**: id, name, industry, objective, style, preview_url, blocks_seed.
  - **Implementado en PL1** (tabla `templates`, catálogo global sin `organization_id`): code (único,
    hace idempotente el seed), name, description, industry_tags[] (`TEMPLATE_INDUSTRIES`),
    objective_tags[] (`TEMPLATE_OBJECTIVES`: captar/vender/reservar/mostrar/compartir), theme_code
    (FK lógica a `THEME_CATALOG`), family (= "style", siempre la línea del tema), background (JSON,
    `siteBackgroundSchema` limitado a color/degradado), preview_image_url, blocks_seed (JSON, formato
    del snapshot de `PageVersion`), sort_order. En F7.11 (ADR-026) se agregan `is_active` (boolean, visibilidad pública) e `is_featured` (boolean, destacada en galería). Validado con `templateSchema` al sembrar y al leer.
  - **Sin FK desde `Site`/`Page`** (la línea "Site/Page (N) ──1 Template" de arriba queda como
    referencia histórica): el criterio de PL1 exige no tocar `Site`/`Page`/`Block`, y aplicar una
    plantilla (PL4) **copia** tema, fondo y bloques al sitio, que nunca queda atado a ella. El origen
    queda en la auditoría de la aplicación, no en una columna.

## 4. Media

> **Implementado en PP1 (ADR-006) como `MediaAsset`:** id, organization_id, uploaded_by_id,
> kind (`IMAGE` | `VIDEO`), status (`PENDING_UPLOAD` → `PROCESSING` → `READY` | `FAILED`), file_name,
> mime_type (verificado por bytes mágicos), size_bytes (declarado), stored_bytes (variantes), width,
> height, variants (`[{width, key, sizeBytes}]`; en un video, PP6, las del póster más el `video.mp4`),
> failure_reason y, desde PP3, tones (`{darkest,
> lightest}`, para verificar el contraste del texto sobre la imagen). El original se borra al procesar. Lo
> que sigue en esta sección es el diseño previo, que se conserva como referencia.

```text
Organization (1) ──< MediaAsset
MediaAsset (N) ──1 uploaded_by User
```

- **MediaAsset**: id, organization_id, url, mime_type, size, alt_text, folder, tags,
  processing_status, created_at.

## 5. Conversión: formularios y contactos

```text
Site (1) ──< Form (1) ──< FormField
Form (1) ──< FormSubmission >── (1) Contact
Organization (1) ──< Contact (1) ──< ContactEvent
```

- **Form**: id, site_id, name, type (contacto/cotización/inscripción/encuesta/pedido), success_action.
- **FormField**: id, form_id, type, label, required, conditional_rule, order.
- **FormSubmission**: id, form_id, contact_id (nullable si no matchea contacto existente), payload,
  source, utm, created_at.
- **Contact**: id, organization_id, name, email, phone, source, tags, consent_status,
  consent_source, consent_text_version, consent_at (ADR-004 p.3), commercial_status, assigned_to,
  retention_review_at (ADR-004 p.4: marcado por el job diario tras 36 meses sin interacción; nulo =
  no requiere revisión — nunca se borra solo), created_at, updated_at.
- **ContactEvent**: id, contact_id, type (form_submission/booking/purchase/note), payload,
  created_at — construye la línea de tiempo del mini-CRM.

## 6. QR y enlaces cortos

```text
Organization (1) ──< ShortLink
Organization (1) ──< QrCode >── (0..1) ShortLink
```

- **ShortLink**: id, organization_id, slug, destination_url, utm, click_count_cached, created_at.
  El slug es único global pero vive en su propio espacio de rutas públicas (`/s/:slug`), separado
  de `Site.slug` en la raíz — así un enlace corto nunca compite por nombre con un sitio (aclarado
  al implementar F3.1, ver `packages/database/prisma/schema.prisma`).
- **QrCode**: id, organization_id, short_link_id (nullable, puede apuntar directo a una URL vía
  `direct_url`), style_config, scan_count_cached, created_at. Se exige en servidor (y con un CHECK
  en la migración) que exista `short_link_id` o `direct_url`.

## 7. Analítica

```text
AnalyticsEvent (N) ──1 Organization
AnalyticsEvent (N) ──1 Site (nullable)
AnalyticsAggregate (N) ──1 Organization
AnalyticsAggregate (N) ──1 Site (nullable, F3.6)
Funnel (N) ──1 Site (F7.6)
PageCampaign (N) ──1 Site, (N) ──1 Page (F7.7)
ProductVariant (N) ──1 Product (F7.8a)
Coupon (N) ──1 Site; Order (N) ──0..1 Coupon (F7.8b)
OrderItem (N) ──1 Order, (N) ──0..1 Product, (N) ──0..1 ProductVariant (F7.8a)
```

- **AnalyticsEvent**: id, organization_id, site_id, type (page_view/block_click/whatsapp_click/
  form_submit/lead_created/qr_visit/...), anonymized_visitor_id, utm, device, geo_country/city,
  created_at. Sin PII innecesaria; idempotency_key para eventos críticos. Sin columna de IP cruda
  (ADR-004): el visitante anonimizado se deriva con sal rotada por sitio/día.
  - **F7.6 (ADR-021):** `subject_id` (texto, nulo): página de un `page_view`, bloque de un clic,
    producto de un pedido, servicio de una reserva. Índice `(site_id, type, created_at)` para los
    embudos. Nulo en los eventos anteriores a la migración.
- **Coupon** (F7.8b, ADR-023): id, organization_id, site_id, code (mayúsculas, único por sitio),
  description, kind (`percent`/`fixed`), percent_off, amount_off, currency, min_subtotal, starts_at,
  ends_at, max_redemptions, redemption_count, active, timestamps. CHECK de coherencia (tipo, monto con
  moneda, mínimo con moneda, ventana, usos ≤ tope). **Order** suma `discount_amount` (0),
  `coupon_id` (SET NULL) y `coupon_code` (copia); `total_amount = unit_price_amount × quantity −
  discount_amount`.
- **ProductVariant** (F7.8a, ADR-023): id, organization_id, site_id, product_id (CASCADE), name
  (único por producto), price_amount (nulo = el del producto), stock (nulo = sin control), sku,
  position, active, timestamps. CHECK de stock y precio ≥ 0. Con alguna activa, el pedido exige
  elegir una y cuenta su stock (el del producto se ignora).
- **OrderItem** (F7.8a, ADR-023): id, organization_id, order_id (CASCADE), product_id y variant_id
  (SET NULL), product_name, variant_name, product_kind, unit_price_amount, quantity,
  line_total_amount (CHECK = precio × cantidad), stock_source (`product`, `variant` o nulo: dónde se
  reservó, para devolverlo exacto), position, created_at. Las columnas del pedido quedan como resumen.
  Con varias líneas (carrito, F7.8c): `product_id` nulo, `product_name` resumen, `quantity` 1 y
  `unit_price_amount` = subtotal, para que las reglas del total y la cantidad sigan valiendo.
- **PageCampaign** (F7.7, ADR-022): id, organization_id, site_id, page_id, name, objective,
  starts_at, ends_at (CHECK `ends_at > starts_at`), replace_home, utm_campaign, cancelled_at,
  start_revalidated_at, end_revalidated_at (marcas del worker para invalidar la caché una sola vez
  por borde), timestamps. Índices `(organization_id, site_id)`, `(site_id, starts_at, ends_at)` y
  `(page_id)`. Sin solapes por página ni de "tomar el inicio" por sitio (comprobado en la API con un
  bloqueo consultivo por sitio). Una página con campañas no canceladas y ninguna vigente no se sirve.
- **Funnel** (F7.6, ADR-021): id, organization_id, site_id, name, steps (JSON, `funnelStepsSchema`:
  2 a 6 pasos con eventos de un catálogo cerrado y página o bloque opcional), created_at, updated_at.
  Solo la definición: el informe se calcula al consultar sobre `analytics_events` (visitas del día en
  orden) y el paso "pago" se cruza con `orders.paid_at` / `bookings.deposit_paid_at` por la clave de
  idempotencia del evento. Hasta 10 por sitio.
- **AnalyticsAggregate**: id, organization_id, site_id, period, metric, value — pre-agregado para
  el dashboard, generado por el worker (`apps/worker`, F3.6). `site_id` es por sitio siempre que el
  evento sea de un sitio; un rollup de organización se suma en la consulta del dashboard, no se
  persiste aparte. **Cambio de F3.6:** `site_id` pasó a admitir nulos solo para métricas que no
  pertenecen a ningún sitio (enlaces cortos y QR, que desde F3.5 viven a nivel de organización) —
  sin eso esos eventos no podían tener agregado. Único `(organization_id, site_id, period, metric)`
  con `NULLS NOT DISTINCT` (Postgres 15+), para que el upsert también sume sobre la fila existente
  cuando `site_id` es nulo. `period` es el día UTC (`YYYY-MM-DD`). `metric` sigue la convención de
  `packages/analytics/src/metrics.ts`: `<tipo>`, `<tipo>:visitors`, `<tipo>:device:<d>`,
  `<tipo>:country:<CC>`, `<tipo>:utm_source|utm_medium|utm_campaign:<valor>`,
  `<tipo>:subject:<uuid>` (página, bloque, formulario, enlace o QR).

## 8. Notificaciones, auditoría y flags

```text
Organization (1) ──< Notification
Organization (1) ──< AuditLog
FeatureFlag independiente (global con reglas JSON opcionales por organización/plan)
```

- **Notification**: id, organization_id, user_id (nullable si es org-wide), type, payload, read_at.
- **AuditLog**: id, organization_id (nullable para acciones de superadmin), actor_id, action,
  target_type, target_id, metadata, created_at.
- **FeatureFlag**: id, key (único), name, description, enabled (boolean), rules (JSONB opcional), created_at, updated_at (F7.11, ADR-026).

### Soporte (F4.5)

```text
Organization (1) ──< SupportTicket (1) ──< SupportMessage
User (1) ──< SupportTicket (quién la abrió, SetNull)
```

- **SupportTicket**: id, organization_id, opened_by_id (nullable), subject, status (`OPEN` espera
  al equipo | `ANSWERED` espera al cliente | `CLOSED`), closed_at, created_at, updated_at (última
  actividad, ordena las bandejas). Sin adjuntos hasta la decisión #7.
- **SupportMessage**: id, ticket_id, author_id (nullable), author_role (`CUSTOMER` | `STAFF`), body
  (texto plano, nunca HTML), created_at.
- Visibilidad: un miembro ve las solicitudes que abrió; con el permiso `support.view_all`
  (propietario y administrador) ve todas las de su organización. El equipo las ve en `apps/admin`.

## 9. Cardinalidades clave (resumen)

| Relación | Cardinalidad | Nota |
|---|---|---|
| User – Organization | N:M vía Membership | un usuario en varias orgs |
| Organization – Site | 1:N | límite real por plan |
| Site – Page | 1:N | |
| Page – PageVersion | 1:N | historial completo |
| Page – Block | 1:N | orden persistente |
| Block – BlockVersion | 1:N | versionado independiente del bloque |
| Organization – Contact | 1:N | scope estricto por organización |
| Contact – ContactEvent | 1:N | timeline del mini-CRM |
| Organization – Subscription | 1:1 activa (histórico 1:N) | |
| Membership – Role | N:1 | rol por membresía, no por usuario global |

## 9b. Reservas (F5.1, F7.9a/b/c, `BACKLOG_FASE_5.md`, `BACKLOG_FASE_7.md`)

- **BookingSettings** (1:1 con Site, PK `site_id`): organization_id, enabled, time_zone (IANA),
  weekly_hours (JSON validado con `weeklyHoursSchema`), min_notice_minutes, max_advance_days,
  buffer_minutes, slot_interval_minutes, **calendar_feed_token** (F7.9c: token seguro para feed iCal .ics público).
- **BookingBranch** (F7.9a, Site 1:N): organization_id, name, address, phone, position, created_at, updated_at.
- **BookingStaff** (F7.9a, Site 1:N, BookingBranch N:1 con `SET NULL`): organization_id, name, title, email, phone,
  avatar_url, active, position, weekly_hours (JSON opcional para horario propio de profesional, F7.9b),
  **calendar_feed_token** (F7.9c: token seguro para feed iCal .ics personal del profesional), created_at, updated_at.
- **ServiceStaff** (F7.9a, N:M entre BookableService y BookingStaff): service_id, staff_id, asignación calificada.
- **BookableService** (Site 1:N): organization_id, name, description, duration_minutes,
  price_amount + price_currency (unidad mínima + ISO), payment_url (enlace externo del negocio:
  Impulza no cobra, decisión #6), active, position.
- **BookingBlackout** (Site 1:N, BookingStaff N:1 con `SET NULL` opcional para bloqueos por profesional, F7.9b):
  organization_id, starts_at, ends_at (fin exclusivo), reason, staff_id.
- **Booking** (F5.2; Site 1:N, BookableService 1:N con `SET NULL`, Contact 1:N con `SET NULL`, BookingBranch N:1 con `SET NULL`, BookingStaff N:1 con `SET NULL`):
  organization_id, copia del servicio al reservar (service_name, duration_minutes, price_amount,
  price_currency, payment_url), starts_at/ends_at, time_zone, branch_id, staff_id, datos del cliente (customer_name,
  customer_email, customer_phone, note), status (`CONFIRMED`/`CANCELLED`/`COMPLETED`/`NO_SHOW`),
  source (`PUBLIC`/`MANUAL`), cancelled_at, **google_event_id** (F7.9c: ID del evento sincronizado en Google Calendar).
  Sin doble reserva: restricción de exclusión
  `bookings_no_overlap` (`btree_gist`) sobre `(site_id =, coalesce(staff_id, '00000000-0000-0000-0000-000000000000'::uuid) =, tstzrange(starts_at, ends_at) &&)` de las
  `CONFIRMED` y `PENDING_PAYMENT`. F5.4: `reminder_sent_at` (lo reclama el worker antes de enviar; reprogramar lo
  vuelve a `null`). El enlace para que el cliente gestione su reserva no se guarda: se firma con
  HMAC (`BOOKING_LINK_SECRET`).
- **GoogleCalendarConnection** (F7.9c; Site 1:N, Organization 1:N, BookingStaff 1:1 con `SET NULL`):
  organization_id, site_id, staff_id (opcional para profesional; null si es del sitio), access_token_encrypted,
  refresh_token_encrypted, token_type, expires_at, email, calendar_id, status (`ACTIVE`/`REVOKED`/`ERROR`),
  last_sync_at, last_error, created_at, updated_at. Cifrado simétrico AES-256-GCM. Desacoplado si faltan credenciales en el entorno.

## 9c. Catálogo y pedidos (F5.5, `BACKLOG_FASE_5.md`)

- **ProductCategory** (Site 1:N): organization_id, name, position.
- **Product** (Site 1:N, ProductCategory 1:N con `SET NULL`): organization_id, name, description,
  kind (`PHYSICAL`/`DIGITAL`/`SERVICE`), price_amount + price_currency (unidad mínima + ISO,
  `CHECK >= 0`), image (JSON `{url, alt, decorative?}`), payment_url (enlace externo del negocio:
  Impulza no cobra, decisión #6), stock (`NULL` = sin control, `CHECK >= 0`), active, position.
- **Order** (Site 1:N, Product 1:N con `SET NULL`, Contact 1:N con `SET NULL`): organization_id,
  copia del producto al pedir (product_name, product_kind, unit_price_amount, price_currency,
  payment_url), quantity (`CHECK 1–99`), total_amount (`CHECK = unit_price_amount * quantity`),
  datos del cliente (customer_name, customer_email, customer_phone, delivery_address solo si es
  físico, note), status (`NEW`/`PAID`/`DELIVERED`/`CANCELLED`), stock_reserved (si descontó stock,
  para devolverlo al cancelar), paid_at, delivered_at, cancelled_at.

## 9d. Campañas de email (F5.6, `BACKLOG_FASE_5.md`)

- **Contact** suma el consentimiento de **marketing**, aparte del de gestión:
  marketing_consent_at, marketing_consent_source, marketing_consent_text_version y
  marketing_unsubscribed_at (la baja se respeta de inmediato; volver a aceptar la limpia).
- **Campaign** (Organization 1:N, User 1:N con `SET NULL`): name, subject, body_html (saneado),
  segment (JSON validado: etiquetas, orígenes, estados comerciales), status
  (`DRAFT`/`SENDING`/`SENT`/`CANCELLED`), recipient_count, emails_per_hour (límite del plan
  congelado al enviar, `CHECK >= 0`), send_started_at, sent_at.
- **CampaignRecipient** (Campaign 1:N con `CASCADE`, Contact 1:N con `SET NULL`, único
  `(campaign_id, contact_id)`): organization_id, email, status (`PENDING`/`SENT`/`FAILED`/`SKIPPED`),
  sent_at, error, unsubscribed_at. El enlace de baja no se guarda: se firma con HMAC.

## 9e. IA (F6.2, `BACKLOG_FASE_6.md`, ADR-010)

- **AiConnection** (de plataforma, sin organización): name (único), kind
  (`OPENAI_COMPATIBLE`/`ANTHROPIC`), base_url (obligatoria para compatible, `CHECK`),
  api_key_encrypted (AES-256-GCM) + api_key_hint, model, json_mode
  (`json_schema`/`json_object`/`prompt`), timeout_ms (`CHECK 1000–300000`), precios de entrada y
  salida en micro-dólares por millón de tokens (enteros, `CHECK >= 0`), enabled.
- **AiRoute** (AiConnection 1:N con `CASCADE`, único `(task, connection_id)`): task, position (orden
  de respaldo, 0 = principal).
- **AiUsage** (Organization 1:N con `CASCADE`, User 1:N y AiConnection 1:N con `SET NULL`): un
  intento contra un proveedor — request_id (agrupa reintentos y respaldo), task, provider_kind,
  model, outcome, tokens de entrada y salida, cost_micro_usd, duration_ms. **Sin prompt ni
  respuesta** (ADR-004). La cuota mensual cuenta solicitudes con al menos un intento `ok`.
- **Plan.limits** suma `aiRequestsPerMonth` (con valor por defecto para planes anteriores).

## 9f. Pruebas A/B (F6.5, `BACKLOG_FASE_6.md`, ADR-011)

- **AbTest** (Organization, Site, Page y Block 1:N con `CASCADE`): name, key (única, pública y
  opaca: decide el reparto), block_type, variant_a (copia de la configuración publicada al empezar),
  variant_b (solo los campos que cambia B), status (`RUNNING`/`ENDED`), applied_variant (`a`/`b`,
  `CHECK`, solo terminada), started_at, ended_at (`CHECK`: presente si y solo si está terminada).
  Índice único parcial: a lo sumo una `RUNNING` por bloque.
- Los conteos no tienen tabla propia: son métricas de **AnalyticsAggregate**
  (`ab:<evento>:<prueba>:<a|b>`), escritas por el mismo worker, sin datos personales.
- **Plan.limits** suma `abTestsRunning` (pruebas en curso por organización; 1 por defecto).

## 9g. Smart CTA (F6.6, `BACKLOG_FASE_6.md`)

- **Page.smart_cta** (JSON nulo, migración aditiva): reglas en orden `{ condition, blockId }`
  (`smartCtaSchema`, catálogo cerrado, máximo 5), validadas al guardar (el bloque es de acción y de
  la misma página) y al leer. En vivo, no va en `PageVersion`. Al sitio público viajan por la
  posición publicada del bloque, nunca por id, junto al horario de `BookingSettings`.

## 9h. Automatizaciones (F6.7, `BACKLOG_FASE_6.md`)

- **Automation** (Organization 1:N con `CASCADE`): name, trigger (`CHECK` en el catálogo:
  `contact_created`/`booking_created`/`order_created`), action (JSON validado con
  `automationActionSchema` al guardar y al ejecutar), enabled.
- **AutomationRun** (Automation y Organization 1:N con `CASCADE`): event_key (`trigger:subjectId`),
  trigger, subject_id, status (`PENDING`/`SUCCEEDED`/`FAILED`/`SKIPPED`), attempts (`CHECK >= 0`),
  detail (motivo técnico, sin datos personales), finished_at (`CHECK`: nulo si y solo si `PENDING`).
  **Único `(automation_id, event_key)`**: la garantía de "una vez por evento".

## 9i. Cobro de suscripciones (F4.6a, `BACKLOG_FASE_4.md`, ADR-012)

- **Subscription** (ampliada): `status` suma `INCOMPLETE` (inscrita, primer cobro sin aprobar; **no**
  da derecho al plan). `gateway` (`WEBPAY_ONECLICK`/`MERCADO_PAGO`), `billing_cycle`
  (`MONTHLY`/`YEARLY`), `payment_method_ref_encrypted` (`tbk_user` cifrado con
  `AUTH_ENCRYPTION_KEY`), `card_brand`, `card_last4` (`CHECK` 4 dígitos), `cancel_at_period_end`,
  `canceled_at`, `first_paid_at` (inicio del retracto), `failed_attempts` (`CHECK >= 0`),
  `next_charge_at` (nulo = cobro en vuelo o no habrá más), `past_due_since` (vencimiento original
  durante la gracia). **Índice único parcial `subscriptions_one_live_per_org`**: a lo más una
  `TRIALING`/`ACTIVE`/`PAST_DUE` por organización.
- **Payment** (Organization y Subscription 1:N con **`RESTRICT`**: registro contable que el SII exige
  conservar): `buy_order` **único** y determinista (suscripción + vencimiento + intento → nunca dos
  cobros), amount/net_amount/vat_amount en pesos (`CHECK` neto + IVA = monto), period_start/end,
  attempt, status (`PENDING`/`APPROVED`/`REJECTED`/`REFUNDED`; `CHECK` paid_at presente si y solo si
  aprobado o reembolsado), response/authorization code, failure_reason, refunded_amount (`CHECK`
  ≤ monto), `tax_document_status` (`PENDING`/`ISSUED`/`NOT_REQUIRED`) y número de documento.
- **BillingCheckout** (Organization, User 1:N con `CASCADE`; Plan): una pasada por la pasarela.
  `token` único (TBK_TOKEN), status (`OPEN`/`PROCESSING`/`COMPLETED`/`FAILED`/`EXPIRED`), vence a
  los 30 minutos. El retorno de la pasarela solo confía en este registro.
- **PaymentWebhookEvent**: único `(gateway, event_id)`; se registra antes de procesar y se marca
  `processed_at` al terminar: uno procesado no se repite, uno fallido se reprocesa (F4.6b).
- **Payment.provider_payment_id** (F4.6b): id del pago en Mercado Pago, para reembolsar; único
  parcial por `(gateway, provider_payment_id)`. En Mercado Pago `buy_order` es `MP{id de la cuota}`.
- **LegalAcceptance** (User `CASCADE`, Organization `SET NULL`): document (`CHECK`: `terms`,
  `withdrawal_notice`, `privacy`), version, context, accepted_at. Prueba de la aceptación de
  Términos y aviso de retracto antes de pagar (Ley 19.496).

## 9j. Cuenta de cobro de los negocios (F5.8, `BACKLOG_FASE_5.md`, ADR-013)

- **PaymentAccount** (Organization 1:N con `CASCADE`, única por `(organization_id, provider)`):
  provider_user_id (id de la cuenta en Mercado Pago, no secreto), access/refresh token **cifrados**
  (AES-256-GCM), expires_at, live_mode, status (`CONNECTED`/`ERROR`; `CHECK`: `ERROR` exige
  `last_error`), connected_by_id, connected_at, last_refreshed_at. Desconectar borra la fila.

## 9k. Cobro de pedidos con Checkout Pro (F5.9, `BACKLOG_FASE_5.md`, ADR-013)

- **Order** (ampliada, migración aditiva `20260930030000_f59_order_checkout`, todo opcional):
  `checkout_preference_id`, `checkout_url` y `checkout_expires_at` (48 h) de la preferencia creada
  con el token del negocio; `provider_payment_id` **único** (un pago de Mercado Pago nunca paga dos
  pedidos; se asigna con una actualización condicional `provider_payment_id IS NULL`, así un aviso
  repetido no tiene efecto); `payment_status` (último estado consultado en Mercado Pago);
  `status_token_hash` **único** (SHA-256 del enlace "Tu pedido"; el enlace no se guarda).

## 9l. Seña de reservas (F5.10, `BACKLOG_FASE_5.md`, ADR-013)

- **BookableService.deposit_amount** (opcional; `CHECK`: > 0, con precio y ≤ precio).
- **BookingStatus** suma `PENDING_PAYMENT` (esperando seña). **`bookings_no_overlap`** ahora excluye
  encimadas entre `CONFIRMED` y `PENDING_PAYMENT`: la hora queda tomada mientras se paga.
- **Booking** (ampliada, todo opcional): `deposit_amount`, `payment_deadline` (`CHECK`: una reserva
  `PENDING_PAYMENT` siempre tiene monto y plazo), `checkout_preference_id`, `checkout_url`,
  `provider_payment_id` **único**, `payment_status`, `deposit_paid_at`, `payment_expired_at` (el
  worker liberó la hora; un pago tardío la reconfirma si sigue libre). Índice parcial por
  `payment_deadline` de las pendientes.

## 9m. Reembolsos y contracargos (F5.11a, `BACKLOG_FASE_5.md`, ADR-013)

- **Order.refunded_amount** y **Booking.deposit_refunded_amount** (enteros, 0 por omisión; `CHECK`:
  nunca más que lo cobrado). Se escriben con lo que informa Mercado Pago (`transaction_amount_refunded`);
  `payment_status` refleja `refunded`, `charged_back` o `in_mediation`. Sin tabla propia de
  reembolsos: la fuente de verdad es Mercado Pago y cada devolución queda en la auditoría.
- Permiso nuevo `payments.refund` (solo OWNER).

## 9n. Descargas pagadas (F5.11b, `BACKLOG_FASE_5.md`, ADR-015)

- **ProductFile** (Organization y Product 1:N con `CASCADE`): file_name (el del usuario, validado;
  nunca forma la clave), content_type, size_bytes (`CHECK` > 0), status
  (`PENDING_UPLOAD`/`READY`/`FAILED`; `CHECK`: `READY` si y solo si tiene `ready_at`), uploaded_by_id.
  **Índice único parcial `product_files_one_ready_per_product`**: a lo más un archivo listo por
  producto. El objeto vive en el bucket **privado** (`org/{org}/products/{producto}/{archivo}`) y
  cuenta para la cuota de almacenamiento del plan.
- **Order.download_count** (`CHECK` ≥ 0; tope por pedido en la API, incremento condicional) y
  **last_downloaded_at**.

## 9o. Medición de terceros (F7.1, `BACKLOG_FASE_7.md`, ADR-016)

- **Site.ga4_measurement_id** y **Site.meta_pixel_id** (opcionales; `CHECK` de formato:
  `^G-[A-Z0-9]{4,15}$` y `^[0-9]{10,20}$`). Solo identificadores: el script lo arma Impulza. La
  elección de consentimiento de cada visitante **no** se guarda en la base (vive en su navegador).

## 9o-bis. Bloques de F7.3 (`BACKLOG_FASE_7.md`, ADR-018) — sin cambios de tablas

- Los tipos `countdown`, `pricing`, `map`, `music` y `events` (y `newsletter` de F7.4) son entradas
  nuevas del catálogo cerrado de `packages/validation/src/blocks/catalog.ts`: se guardan en
  **Block.type** + **Block.config** (JSON validado por el esquema del tipo y su versión), igual que el
  resto. Por eso no hay migración: `Block.type` es texto a propósito (ver el comentario del modelo).
- `video` suma `vertical` (opcional) y el proveedor `tiktok` en su forma guardada; `music` guarda
  `{provider, …ids}` y nunca una URL de iframe. Fechas de cuenta regresiva y eventos: hora de pared
  `AAAA-MM-DDTHH:mm` + zona IANA.

## 9p. Webhooks salientes (F7.2, `BACKLOG_FASE_7.md`, ADR-017)

- **WebhookEndpoint** (`webhook_endpoints`): destino de una organización. `url` (`CHECK` https),
  `description`, `events text[]` (validados con `WEBHOOK_EVENT_TYPES` al escribir),
  `secret_encrypted` (AES-GCM con `AUTH_ENCRYPTION_KEY`, nunca se devuelve), `active`,
  `disabled_reason` (`CHECK` `gone` | `too_many_failures`, nulo si lo pausó una persona),
  `consecutive_failures` (≥ 0), últimas entregas correctas y fallidas, `created_by_id`.
- **WebhookDelivery** (`webhook_deliveries`): una entrega de un evento a un destino (cascada al borrar
  el destino o la organización). `event_id` estable (único por destino), `event_type`, `payload`
  (datos personales de clientes del negocio: se **borra a los 30 días**), `status`
  (`PENDING`/`SUCCEEDED`/`FAILED`/`SKIPPED`), `attempts`, `next_attempt_at`, último código,
  error y duración; `CHECK` `(status = 'SUCCEEDED') = (delivered_at IS NOT NULL)`.
- Migración `20260930080000_f72_webhooks` con `down.sql`; permiso `webhooks.manage` (OWNER, ADMIN).

## 9q. Newsletter con doble confirmación (F7.4, `BACKLOG_FASE_7.md`, ADR-019)

- **NewsletterConfirmation** (`newsletter_confirmations`): solicitud de suscripción, **no** un
  contacto. `organization_id`, `site_id` (cascada), `email` (`CHECK` en minúsculas), `name`,
  `token_hash` (único, `CHECK` SHA-256 hexadecimal; el token solo viaja en el correo),
  `consent_text_version`, `expires_at` (48 h, `CHECK` > `created_at`), `confirmed_at`, `contact_id`
  (`SET NULL`). Al confirmar se crea o actualiza el **Contact** con su consentimiento de marketing
  (`newsletter:<sitio>:double_opt_in`), la etiqueta `newsletter` y un **ContactEvent** `NEWSLETTER`.
  Purga: no confirmadas un día después de vencer; confirmadas a los 30 días.

## 9r. Secuencias de correo (F7.5, `BACKLOG_FASE_7.md`, ADR-020)

- **EmailSequence** (`email_sequences`): `trigger` del catálogo de automatizaciones, `enabled`,
  `emails_per_hour` (límite del plan congelado por la API). **EmailSequenceStep**: `position`
  (0–9, única por secuencia), `delay_hours` (0–8760, desde el paso anterior), `subject`,
  `body_html` saneado.
- **EmailSequenceEnrollment**: única por `sequence_id + contact_id`; `status`
  (`ACTIVE`/`COMPLETED`/`STOPPED`), `stop_reason`, `next_step`, `next_send_at` (`CHECK`: activa ⇒
  con hora; cerrada ⇒ con `finished_at`). **EmailSequenceSend**: única por inscripción y paso;
  `SENT`/`FAILED`/`SKIPPED`; base del cupo por hora junto a `campaign_recipients`.

## 9s. Marca de la plataforma (F9.1, BACKLOG_FASE_9.md, ADR-028 §4)

- **PlatformBranding** (`platform_branding`, singleton): identidad de la plataforma configurable por superadministración.
  Campos: `name`, `logo_light_url`, `logo_dark_url`, `favicon_url`, `primary_color`, `secondary_color`, `sender_name`,
  `sender_email`, `support_url`, `privacy_url`, `terms_url`, `footer_text`, `updated_by_admin_id` (`SET NULL`).
  Valores por defecto reproducen exactamente la identidad "Impulza One".

