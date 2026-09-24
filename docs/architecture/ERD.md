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

- **User**: id, email, password_hash, email_verified_at, created_at, updated_at.
- **Session**: id, user_id, created_at, expires_at, device/user_agent, ip (truncada/hasheada).
- **Account**: id, user_id, provider, provider_account_id (login social).
- **Organization**: id, name, slug, plan_id, created_at.
- **Membership**: id, user_id, organization_id, role_id, status, invited_at, accepted_at.
  - Un `User` puede tener muchas `Membership` (N orgs). Una `Organization` tiene muchas
    `Membership` (N usuarios).
- **Role** / **Permission**: catálogo de roles (OWNER, ADMIN, EDITOR, ANALYST, SUPPORT,
  AGENCY_MANAGER, SUPER_ADMIN) y permisos explícitos asociados.

## 2. Planes y suscripción del propietario

```text
Plan (1) ──< Subscription >── (1) Organization
Plan (1) ──< UsageCounter >── (1) Organization
```

- **Plan**: id, code, name, price, currency, límites (sitios, páginas, contactos, storage, etc.).
- **Subscription**: id, organization_id, plan_id, status, current_period_start/end,
  external_provider_ref (referencia del proveedor de pago, nunca datos de tarjeta).
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
- **BlockVersion**: id, block_id, version_number, config (JSON tipado por `type`), created_at.
- **Theme**: id, organization_id (nullable si es tema global del catálogo), tokens (paleta,
  tipografía, espaciado).
- **Template**: id, name, industry, objective, style, preview_url, blocks_seed.

## 4. Media

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
```

- **AnalyticsEvent**: id, organization_id, site_id, type (page_view/block_click/whatsapp_click/
  form_submit/lead_created/qr_visit/...), anonymized_visitor_id, utm, device, geo_country/city,
  created_at. Sin PII innecesaria; idempotency_key para eventos críticos. Sin columna de IP cruda
  (ADR-004): el visitante anonimizado se deriva con sal rotada por sitio/día.
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
FeatureFlag independiente (global u organization_id nullable)
```

- **Notification**: id, organization_id, user_id (nullable si es org-wide), type, payload, read_at.
- **AuditLog**: id, organization_id (nullable para acciones de superadmin), actor_id, action,
  target_type, target_id, metadata, created_at.
- **FeatureFlag**: id, key, scope (global/organization), enabled, rules.

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

## 10. Pendiente para Fase 5+ (no modelar aún)

`Booking`, `Service` (agenda), `Catalog`, `Product`, `Order`, `Payment` (comercio de negocios),
`Campaign`/email marketing, `Course`/`Membership` (contenido). Se diseñan cuando se inicie la Fase 5
para evitar tablas vacías o esquemas prematuros (restricción explícita de ST §6.2).
