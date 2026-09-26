# Requirements Traceability — Impulza One

Fuentes:
- **[PM]** `PLAN_MAESTRO_PLATAFORMA_IDENTIDAD_DIGITAL.md` — qué producto construir.
- **[ST]** `02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` — cómo construirlo.

Este documento agrupa los requisitos detectados, su fuente y su estado. Sirve como referencia
única para no perder alcance al programar por fases.

## 1. Visión y posicionamiento

| Requisito | Fuente | Fase |
|---|---|---|
| SaaS multiusuario/multiempresa, centro digital desde una URL | PM §1 | Fundacional |
| Posicionamiento: "presenta tu marca, capta clientes, agenda, vende y mide resultados" | PM §1 | Fundacional |
| Diferenciación vs. Linktree/HeyLink/Beacons/Stan (mejor diseño, mini-CRM, foco conversión, modo agencia, Chile/LatAm) | PM §2, §14 | Fundacional |

## 2. Roles y multi-tenancy

| Requisito | Fuente | Fase |
|---|---|---|
| Roles: Visitante, Cliente final, Propietario, Colaborador, Agencia, Superadministrador | PM §5 | Fase 1 |
| Roles técnicos: OWNER, ADMIN, EDITOR, ANALYST, SUPPORT, AGENCY_MANAGER, SUPER_ADMIN | ST §7 | Fase 1 |
| Todo dato comercial pertenece a una `organization_id`; nunca confiar en valor enviado por el cliente | ST §3.2 | Fase 1 (no negociable, aplica a todo el proyecto) |
| Un usuario puede pertenecer a varias organizaciones; una organización a varios sitios según plan | ST §3.2 | Fase 1 |
| Pruebas obligatorias de aislamiento entre organizaciones | ST §3.2, §21 | Fase 1 en adelante |

## 3. Acceso y onboarding

| Requisito | Fuente | Fase |
|---|---|---|
| Registro, verificación de email, login, Google opcional, recuperación de contraseña, 2FA, sesiones/dispositivos | PM §8.1, ST §7 | Fase 1 |
| Rate limiting y bloqueo temporal por abuso | ST §7, §15 | Fase 1 |
| Onboarding guiado de 11 pasos (tipo de cuenta → objetivo → industria → nombre → slug → import redes → plantilla → perfil/CTA → preview → publicar → checklist) | PM §8.2 | Fase 2 — construido en PL4 (`/bienvenida`, `BACKLOG_PLANTILLAS.md`, decisión 2 de Favio); en revisión |

## 4. Constructor visual y sitio público

| Requisito | Fuente | Fase |
|---|---|---|
| Constructor: agregar/editar/duplicar/ocultar/eliminar, drag&drop, undo/redo, autosave, borrador vs. publicado, programar vigencia, visibilidad condicional, historial y restauración, validación previa, detección de enlaces rotos, revisión de contraste | PM §9.2, ST §9 | Fase 2 |
| Bloques tipados (no HTML libre); esquema versionado por tipo | ST §9 | Fase 2 |
| Bloques del MVP: perfil, hero, texto, enlace/botón, redes, imagen, galería, video embebido, WhatsApp, email/llamada, formulario contacto, servicio destacado, separador, FAQ, testimonios | ST §9 | Fase 2 |
| Biblioteca completa de bloques (identidad, contenido, conversión, negocio, monetización, integraciones) | PM §9.3 | Fase 2 → versión posterior según prioridad |
| No permitir scripts personalizados en el MVP | ST §9, §22 | Restricción permanente hasta decisión posterior |
| Páginas internas con slug, orden, visibilidad, SEO y estado de publicación | PM §9.5 | Fase 2 |
| Página pública: identidad/verificación/compartir/menú, hero, CTA, enlaces, servicios, media, prueba social, formulario/reserva/compra, redes, footer legal | PM §10.1 | Fase 2 |
| Render público seguro; caché invalidada solo al publicar | ST §9 | Fase 2 |

## 5. Apariencia y plantillas

| Requisito | Fuente | Fase |
|---|---|---|
| Temas, paleta, tipografía, fondos, botones, espaciado, densidad, accesibilidad | PM §9.4 | Fase 2 |
| Buscador/filtros de plantillas por industria, objetivo, estilo, color; preview móvil/escritorio | PM §7.4 | Fase 2 (comercial) — backlog `BACKLOG_PLANTILLAS.md`: modelo y API de lectura en PL1 (`GET /api/v1/templates`, filtros industria/objetivo/estilo), catálogo en PL3, galería en PL4 |
| Dirección visual obligatoria: fondo claro, profesional, iconos lineales, sombras discretas, bordes moderados, sin exceso de tarjetas, WCAG 2.2 AA | PM §15, ST §14 | Transversal, desde design system (Fase 1) |
| No copiar interfaz visual de competidores | ST §14, §22 | Restricción permanente |

## 6. Conversión: formularios, contactos, mini-CRM

| Requisito | Fuente | Fase |
|---|---|---|
| Constructor de formularios, plantillas, campos condicionales, notificaciones, webhooks, antispam, consentimientos | PM §9.8 | Fase 3 |
| Mini-CRM: lista/filtros, ficha de contacto, timeline, fuente/campaña, etiquetas, consentimientos, notas/tareas, estados comerciales, import/export | PM §9.7 | Fase 3 |
| Mini-CRM nativo alimentado por formularios, reservas y compras (diferenciador) | PM §14.4 | Fase 3 |

## 7. QR, enlaces y dominios

| Requisito | Fuente | Fase |
|---|---|---|
| QR estático/dinámico personalizable, enlaces cortos, UTM, VCard, métricas | PM §9.13 | Fase 3 |
| Subdominio gratuito, dominio personalizado, DNS/SSL, SEO técnico (title, canonical, robots, OG, sitemap, redirects) | PM §9.14 | Fase 3 (subdominio) → Fase 4 (dominio propio) |

## 8. Analítica

| Requisito | Fuente | Fase |
|---|---|---|
| Eventos: vistas, clics por bloque, contactos, reservas, ventas, conversión, embudo, UTM, dispositivo, geo aproximada | PM §9.12 | Fase 3 |
| Taxonomía de eventos y pipeline (endpoint → validación/rate limit → cola Redis/BullMQ → worker → agregados Postgres → dashboard) | ST §10 | Fase 3 |
| No guardar datos personales innecesarios; anonimizar/truncar; idempotencia; diferenciar bots | ST §10, §15 | Fase 3, transversal en seguridad |
| ClickHouse solo si Postgres deja de cumplir objetivos medidos | ST §10 | Diferido — decisión futura basada en datos |

## 9. Planes, suscripciones y pagos

| Requisito | Fuente | Fase |
|---|---|---|
| Planes: Gratis, Profesional, Negocio, Agencia; mensual/anual; comparador y límites | PM §7.5 | Fase 4 |
| MVP de pagos: plan gratuito + límites, modelo interno de planes/suscripciones, enlaces externos de pago, sin custodiar dinero de terceros | ST §12 | Fase 4 |
| Post-MVP: cobro recurrente del SaaS con proveedor compatible con Chile, webhooks firmados e idempotentes, solo referencias de proveedor (nunca tarjetas completas), reintentos/morosidad/gracia | ST §12 | Fase 4 |
| Fase avanzada: checkout de clientes/marketplace solo tras resolver KYC, tributación, reembolsos, contracargos | ST §12 | Diferido explícitamente |

## 10. Negocio digital (reservas, tienda)

| Requisito | Fuente | Fase |
|---|---|---|
| Reservas: calendario, servicios/duración/precio, profesionales, sucursales, disponibilidad, seña, cancelación/reprogramación, recordatorios, integración calendario/videollamada | PM §9.9 | Fase 5 — `BACKLOG_FASE_5.md`: servicios, horario, bloqueos y disponibilidad en F5.1, reserva pública en F5.2, agenda en F5.3 y avisos/cancelar/reprogramar/recordatorios en F5.4 (en revisión); avisos F5.4. Seña cobrada bloqueada por decisión #6 (se usa enlace de pago externo) |
| Tienda: productos físicos/digitales, servicios, variantes, stock, cupones, carrito, checkout, pedidos, pagos, reembolsos, descargas, upsell/order bump, afiliados | PM §9.10 | Fase 5 |
| Campañas de email: segmentos, listas, plantillas, secuencias, automatizaciones básicas, métricas, bajas | PM §9.11 | Fase 5 |

## 11. Modo agencia

| Requisito | Fuente | Fase |
|---|---|---|
| Dashboard agencia, gestión de clientes (alta, cambio rápido, pausa/archivo, duplicación, transferencia, facturación) | PM §11.1–11.2 | Fase 6 |
| Equipo con roles personalizados, acceso por cliente/módulo, auditoría, aprobación antes de publicar | PM §11.3 | Fase 6 |
| Marca blanca: logo/colores, dominio de agencia, portal cliente, correos con marca, reportes personalizados | PM §11.4 | Fase 6 |

## 12. IA

| Requisito | Fuente | Fase |
|---|---|---|
| Asistente IA: estructura inicial, bloques, textos/CTA, SEO, traducción, análisis de métricas, propuestas A/B, detección de info faltante | PM §9.16 | Fase 6 |
| Interfaz `AIProvider` con adaptadores; IA propone, usuario confirma antes de publicar; registrar proveedor/modelo/tokens/costo; límites por plan; sin dependencia rígida de un proveedor | ST §13 | Fase 6 |

## 13. Superadministración

| Requisito | Fuente | Fase |
|---|---|---|
| Dashboard global (usuarios, orgs, sitios, conversión, MRR/ARR, bajas, uso, estado técnico) | PM §12.1 | Fase 4 (mínima) → Fase 6 (completa) |
| Gestión de usuarios/organizaciones, planes/facturación, moderación, CMS/plantillas, operación (integraciones, colas, feature flags, incidentes) | PM §12.2–12.6 | Fase 4 en adelante |

**Estado (F4.4, 2026-09-24):** hecha la versión mínima en `apps/admin` (ADR-005): resumen global
(usuarios, organizaciones, sitios publicados, bloqueadas, altas de 30 días y distribución por plan),
buscar organizaciones y usuarios, ver plan y uso, cambiar plan a mano, bloquear y restaurar, editar
el catálogo de planes y ver la auditoría. Soporte mínimo (F4.5): el cliente abre solicitudes desde el panel y el equipo las responde y
cierra desde `apps/admin`, con aviso por correo. Pendiente para Fase 6: MRR/ARR y bajas (dependen del cobro,
F4.6), estado técnico, moderación con reportes de abuso (decisión #9), CMS/plantillas y operación.

## 14. Requisitos técnicos transversales (ST)

| Requisito | Fuente | Aplica desde |
|---|---|---|
| Monolito modular en monorepo (no microservicios en MVP) | ST §3.1, §22 | Fase 0 |
| Stack oficial fijo (ver ARCHITECTURE.md) — no actualizar mayores sin decisión | ST §4 | Fase 0 |
| Contratos/adaptadores para proveedores externos reemplazables (pagos, email, storage, IA, analítica, calendarios, WhatsApp) | ST §3.4 | Fase 1 en adelante, por módulo |
| Seguridad mínima desde el primer commit (env validado, cookies HttpOnly/Secure, CSRF, CORS, CSP, rate limiting, sanitización, anti XSS/SQLi/SSRF/open-redirect, webhooks firmados, auditoría, backups cifrados) | ST §15 | Fase 0/1 |
| Observabilidad (logs JSON, request_id, métricas, health check, tracing, Sentry) | ST §16 | Fase 1 |
| Entornos separados (local/test/staging/production) con datos y claves propios | ST §17 | Fase 0 |
| CI/CD con lint, typecheck, tests, build, auditoría de dependencias, verificación de migraciones; pipeline con staging→smoke→migración→prod→health check→rollback | ST §18 | Fase 0 |

## 15. Decisiones pendientes explícitas (bloquean alcance, no bloquean Fase 0/1)

Del PM §21 — deben resolverse **antes de fases que dependan de ellas** (marcadas):

1. Nombre y dominio definitivos — antes de Fase 4 (dominios) y cualquier publicación comercial.
2. Mercado de lanzamiento — antes de Fase 4 (monedas, pasarela).
3. Segmento principal del MVP — recomendable antes de Fase 2 (afecta plantillas/bloques prioritarios).
4. Límites exactos de cada plan — antes de Fase 4 (planes y límites).
5. Pasarela de suscripción — antes de Fase 4.
6. Responsabilidad de pagos de terceros — antes de Fase 5 (pagos de negocios).
7. Cuotas de almacenamiento/tráfico — antes de Fase 4 (límites de plan) y Fase 2 (media).
8. Alcance inicial de agencia — antes de Fase 6.
9. Política de moderación — antes de Fase 4 (superadministración/moderación).
10. ~~Condiciones de privacidad y retención — antes de Fase 3 (analítica) y Fase 1 (auth/datos).~~
    **Resuelta a nivel de modelo de datos el 2026-09-22**: ver `docs/decisions/ADR-004-privacidad-
    retencion-datos.md` (Ley 21.719, Chile, vigente desde diciembre de 2026) — minimización en
    `AnalyticsEvent` (sin IP cruda, visitante anonimizado con rotación diaria, exclusión de bots),
    consentimiento auditado en `Contact`, retención por defecto configurable (14 meses eventos
    crudos / revisión a los 36 meses de inactividad para contactos) y borrado/exportación por
    API+auditoría para atender derechos ARCO+. Pendiente aún, y explícitamente fuera de esta ADR:
    el texto público de política de privacidad, un DPO si corresponde, y el registro ante la
    Agencia — decisiones de negocio/legales, no de ingeniería, que siguen bloqueando el
    **lanzamiento comercial**, no la construcción del módulo.

**No bloquean Fase 0/1**: se puede avanzar con fundación técnica, auth, organizaciones/roles y
design system sin estas decisiones, siempre que no se publique nada comercialmente ni se fije el
modelo de datos de pagos/planes de forma definitiva.

## 16. Restricciones explícitas (no hacer)

Ver ST §22 — no microservicios/Kubernetes/Kafka en MVP, no MongoDB, no GraphQL sin decisión
posterior, no HTML/JS arbitrario en páginas públicas, no confiar en permisos del frontend, no
mezclar datos entre organizaciones, no custodiar tarjetas/credenciales de terceros, no publicar
cambios de IA sin confirmación, no borrar documentación/trabajo existente, no migraciones
destructivas sin respaldo y aprobación, no dependencias sin justificar, no marcar fase completa sin
pruebas.
