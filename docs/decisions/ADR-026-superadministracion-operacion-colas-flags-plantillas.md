# ADR-026: Operación, colas BullMQ, feature flags y CMS de plantillas en la superadministración

- **Estado:** Aceptado (2026-10-01)
- **Fecha:** 2026-10-01
- **Fuente:** `PLAN_MAESTRO_PLATAFORMA_IDENTIDAD_DIGITAL.md` §12.1, §12.5, §12.6; `02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` §7, §15; ADR-005 (Modelo de superadministrador); `docs/architecture/ERD.md` §8 (FeatureFlag).

## Contexto

La plataforma cuenta con una aplicación de superadministración (`apps/admin`, puerto 3200) que implementa las funciones de F4.4 (resumen global, usuarios, organizaciones, bloqueo), F4.5 (soporte), F4.6d (facturación SaaS) y F6.2b (conexiones de IA).

Para completar la operación técnica de la Fase 7 (F7.11) se requiere resolver cuatro capacidades de control global:
1. **Estado técnico (`/admin/operacion`)**: diagnóstico en tiempo real de los servicios del monolito (Postgres, Redis, Worker, MinIO/R2, pasarelas de pago y recursos del proceso Node).
2. **Colas BullMQ (`/admin/operacion`)**: visibilidad y control sobre las 13 colas de procesamiento asíncrono existentes en el sistema (pausa, reanudación, reintento de fallidos y purga).
3. **Feature flags (`/admin/operacion`)**: conmutación inmediata de características críticas a nivel global o con reglas por organización, sin necesidad de re-desplegar contenedores.
4. **CMS de plantillas (`/admin/plantillas`)**: administración del catálogo de plantillas públicas (`templates`), permitiendo activar/desactivar su visibilidad en el constructor y onboarding, marcarlas como destacadas y ordenar su presentación.

Todo esto bajo las restricciones no negociables de seguridad:
- Acceso exclusivo con `AdminSessionGuard` (sesión `ADMIN`, cookie `impulza_admin_session`, 2FA verificado en cada petición).
- Protección anti-CSRF (`CsrfGuard`).
- Registro auditable con actor real en `AuditLog`.
- Pruebas de aislamiento entre organizaciones.

## Decisión

1. **Estado técnico de infraestructura (`GET /api/v1/admin/operations/health`)**:
   - Monitorea directamente los servicios clave:
     - PostgreSQL: ping (`SELECT 1`), tiempo de respuesta en milisegundos y agregados estadísticos globales (`users`, `organizations`, `sites`, `bookings`, `orders`).
     - Redis: ping `PING/PONG`, latencia, memoria consumida (`used_memory_human`) y clientes conectados.
     - Worker HTTP: health check hacia `http://localhost:4100/health` (con timeout estricto de 2 s).
     - Storage (MinIO / R2): disponibilidad del cliente S3 y conectividad de bucket de medios.
     - Pasarelas y servicios: estado de configuración de Webpay Oneclick, Mercado Pago, Google Calendar OAuth e IA.
     - Proceso Node: tiempo de actividad (`uptime`), memoria (`heapUsed`, `heapTotal`, `rss`) y versión de Node.
   - Auditoría: cada inspección deja registro en `AuditLog` (`action: "admin.system_health_inspected"`).

2. **Control de colas BullMQ (`/api/v1/admin/operations/queues`)**:
   - Mapea las 13 colas reales del monorepo:
     - `analytics-events`
     - `automation-events`
     - `media-process`
     - `media-video-process`
     - `webhook-deliveries`
     - `billing-renewals`
     - `booking-deposits`
     - `booking-reminders`
     - `campaign-dispatch`
     - `newsletter-confirmation`
     - `page-campaign-boundary`
     - `payment-accounts-reconciliation`
     - `sequence-dispatch`
   - Lectura de métricas nativas vía cliente BullMQ: `waiting`, `active`, `completed`, `failed`, `delayed`, `paused`.
   - Endpoints de control:
     - `POST /admin/operations/queues/:queueName/pause` (`admin.queue_paused`)
     - `POST /admin/operations/queues/:queueName/resume` (`admin.queue_resumed`)
     - `POST /admin/operations/queues/:queueName/retry-failed` (`admin.queue_retried`)
     - `POST /admin/operations/queues/:queueName/clean` (`admin.queue_cleaned`)
   - Toda acción exige `AdminSessionGuard` y audita el ID del superadministrador.

3. **Feature flags en base de datos y caché Redis**:
   - Tabla `feature_flags` en PostgreSQL (prevista en `ERD.md` §8) con esquema:
     `id` (UUID), `key` (String unique), `name` (String), `description` (String), `enabled` (Boolean), `rules` (JSONB opcional para reglas de organización: `{ allowedOrganizationIds?: string[] }`), `created_at`, `updated_at`.
   - Banderas iniciales de plataforma:
     - `registros_abiertos`: apertura o pausa de nuevos registros en la plataforma.
     - `pagos_en_linea`: conmutador maestro de cobros (Webpay / Mercado Pago).
     - `ia_generativa`: control de llamadas a proveedores de IA.
     - `campanas_correo`: despacho de campañas masivas por el worker.
     - `sincronizacion_calendarios`: integración Google Calendar y feed iCal.
     - `webhooks_salientes`: emisión de eventos hacia webhooks externos.
   - Evaluación de alto rendimiento: la API lee el estado de la bandera desde caché Redis (`feature_flag:<key>`) con TTL de 5 minutos, e invalida la clave de inmediato en cada actualización.
   - Modificación mediante `PUT /api/v1/admin/feature-flags/:key` con auditoría `admin.feature_flag_updated`.

4. **CMS de plantillas (`/admin/plantillas`)**:
   - Se añaden dos columnas a la tabla `templates` existente:
     - `is_active`: booleano (`true` por defecto) para habilitar u ocultar una plantilla en la galería pública y onboarding.
     - `is_featured`: booleano (`false` por defecto) para destacar con insignia.
   - Endpoints:
     - `GET /api/v1/admin/templates`: listado con metadatos completos y filtros.
     - `PATCH /api/v1/admin/templates/:id`: actualización de `isActive`, `isFeatured`, `sortOrder`, `name`, `description`.
   - Acción auditada: `admin.template_updated`.

5. **Interfaz de usuario en `apps/admin`**:
   - Pantalla `/operacion`: tarjetas de métricas de infraestructura, tabla de estado y acciones de colas BullMQ, y conmutadores de Feature Flags con modal para reglas de organización.
   - Pantalla `/plantillas`: grilla y tabla de plantillas con switches de activación y destacados, y editor de orden.
   - Menú lateral (`AdminNav`): nuevas secciones "Operación" (`Activity`) y "Plantillas" (`Layers`).

## Alternativas consideradas

- **Integrar un dashboard externo de colas (ej. Bull-Board):** descartado porque requiere exponer una ruta web con autenticación ajena o rutas sin la protección uniforme de `AdminSessionGuard`, y no permite auditar cada acción de pausa/reintento en `AuditLog`. La interfaz nativa construida en Next.js con los componentes de diseño de Impulza mantiene coherencia visual y seguridad centralizada.
- **Feature flags solo en variables de entorno (`.env`):** descartado porque cambiar una variable exige reiniciar contenedores en producción, interrumpiendo el servicio y sin trazabilidad de quién hizo el cambio ni cuándo. La persistencia en PostgreSQL con caché en Redis permite cambios en milisegundos y con auditoría total.
- **Mantener las plantillas solo en código estático sin columnas en BD:** descartado porque impide que el equipo comercial o de soporte pause una plantilla defectuosa o destaque una nueva sin realizar un despliegue de código.

## Consecuencias

- **Positivas:**
  - El superadministrador obtiene observabilidad completa de la infraestructura y del procesamiento asíncrono desde su panel.
  - Capacidad de actuar ante incidentes (pausar colas saturadas, reintentar fallos tras caída de un proveedor externo, deshabilitar funciones mediante feature flags).
  - Control editorial directo sobre la oferta de plantillas públicas.
  - Trazabilidad y auditoría rigurosa para todas las operaciones críticas.
- **Negativas:**
  - Añade la tabla `feature_flags` y dos campos a `templates`, requiriendo migración con su `down.sql`.
- **Seguimiento:**
  - Si el volumen de banderas o reglas por usuario/porcentaje crece sustancialmente, se evaluará migrar a un motor de evaluación probabilística más complejo, manteniendo la misma interfaz de servicio.
