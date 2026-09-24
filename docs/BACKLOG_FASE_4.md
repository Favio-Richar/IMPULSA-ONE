# Backlog — Fase 4 (SaaS comercial)

Fuente: `02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` §19 (lista de Fase 4: planes, límites,
suscripción, administración global, soporte mínimo, dominios personalizados, producción y
monitoreo) y §12 (pagos: MVP vs. después del MVP), `PLAN_MAESTRO_PLATAFORMA_IDENTIDAD_DIGITAL.md`
§7.5 (precios), §9.14 (dominios) y §12 (superadministración), y `docs/architecture/ERD.md` §2
(`Plan`, `Subscription`, `UsageCounter` — modelados desde F1.2, sin uso hasta ahora). Cada historia
usa la Definición de Terminado general (`CLAUDE.md`) **más** los criterios específicos de abajo.

Precondición cumplida: Fase 3 cerrada (F3.1–F3.8, ver `BACKLOG_FASE_3.md` "Salida de Fase 3").

## Decisiones de negocio que rozan esta fase

De `REQUIREMENTS_TRACEABILITY.md` §15. Son del propietario, no de ingeniería. El backlog está
ordenado para que **nada se construya en la dirección contraria** mientras no estén resueltas: lo
que depende de una decisión se construye configurable (en base de datos, no en código) o queda
bloqueado explícitamente.

| # | Decisión | Qué bloquea en esta fase | Cómo se avanza mientras tanto |
|---|---|---|---|
| 2 | Mercado de lanzamiento | Moneda de los precios | Precios guardados como `(monto en unidad mínima, moneda ISO)` — cambiar de moneda es un dato, no código |
| 4 | Límites exactos de cada plan | Los números de F4.1 | Catálogo editable desde superadministración (F4.4); valores iniciales **provisorios** y rotulados así |
| 5 | Pasarela de suscripción | F4.6 completa | F4.1–F4.5 no cobran: el MVP de pagos (ST §12) es plan gratuito + límites + asignación manual / enlace externo |
| 1 | Nombre y dominio definitivos | F4.7 (dominio de la plataforma para CNAME) | El dominio base es configuración de entorno |
| 7 | Cuotas de almacenamiento/tráfico | Límite de storage en F4.1 | No hay subida de archivos todavía: el límite existe en el catálogo pero no se aplica hasta que exista media |
| 9 | Política de moderación | Moderación en F4.4 | F4.4 solo incluye bloqueo/restauración manual auditado; reportes de abuso quedan para cuando exista la política |
| — | Hosting de producción | F4.8 | No se elige proveedor sin decisión explícita; F4.8 queda bloqueada |

## Fase 4 — SaaS comercial

**Estado de la fase** (se actualiza al cerrar cada historia contra la Definición de Terminado):

| Historia | Estado |
|---|---|
| F4.1 — Catálogo de planes y plan por organización | Terminada |
| F4.2 — Aplicación de límites en servidor | Terminada |
| F4.3 — Plan y uso en el panel | Terminada |
| F4.4 — Superadministración mínima (`apps/admin`) | Terminada (local; ver deudas) |
| F4.5 — Soporte mínimo | Pendiente |
| F4.6 — Cobro recurrente con pasarela | Bloqueada (decisión #5) |
| F4.7 — Dominios personalizados | Pendiente (parcialmente bloqueada por decisión #1) |
| F4.8 — Producción y monitoreo | Bloqueada (decisión de hosting) |
| F4.9 — Aislamiento y seguridad de Fase 4 | Pendiente |

### F4.1 — Catálogo de planes y plan por organización
**Criterios de aceptación:**
- Catálogo `Plan` sembrado con Gratis, Profesional, Negocio y Agencia (PM §7.5), precio mensual y
  anual en unidad mínima de moneda + código ISO (nunca float), y límites tipados (Zod en
  `packages/validation`, no JSON libre): sitios, páginas por sitio, formularios, contactos, enlaces
  cortos, QR, miembros, meses de historial de analítica visibles. Valores iniciales **provisorios**
  hasta la decisión #4, marcados como tales en el seed y en la documentación.
- Toda organización tiene un plan efectivo: las nuevas nacen en Gratis; las existentes se asignan a
  Gratis con una migración de datos no destructiva.
- El plan efectivo se resuelve en un solo lugar del servidor (suscripción activa → su plan; si no,
  Gratis) — nunca se confía en un plan enviado por el cliente.
- Endpoint de lectura del plan y el catálogo; OpenAPI actualizado; migración si cambia el modelo.

> **Estado (2026-09-23): terminada.**
>
> - Catálogo tipado en `packages/validation/src/plans` (`PLAN_CATALOG`, `planLimitsSchema`), mismo
>   patrón que los temas: el seed lo aplica de forma idempotente por `code`. 4 planes con precio
>   mensual/anual en CLP (enteros, la unidad mínima es el peso) y límites **provisorios** — rotulados
>   así en el código, se corrigen en un solo lugar cuando se decida #4.
> - `Plan` ganó `price_monthly` (renombrado desde `price`, sin perder datos), `price_yearly`,
>   `sort_order` y `updated_at` (migración `20260924020000_fase4_plan_catalog`, no destructiva).
> - **Plan efectivo en un solo lugar** (`apps/api/src/modules/plans/plans.service.ts`): suscripción
>   vigente con derecho (activa, en prueba o morosa dentro de su período) → plan asignado por
>   superadministración (`Organization.plan_id`) → Gratis. Ajuste respecto del criterio original
>   ("las nuevas nacen en Gratis; las existentes con migración de datos"): con el Gratis por defecto
>   en el resolvedor, ninguna organización necesita que se le escriba el plan — ni las nuevas ni las
>   existentes —, y `plan_id` queda reservado para una asignación manual explícita, que es un dato con
>   significado y auditable. El resultado para el usuario es el mismo; la base queda más honesta.
> - Límites leídos siempre a través de `planLimitsSchema`: una fila con límites inválidos es un error
>   de configuración (se registra y responde 500), nunca se "adivina".
> - `GET /plans` (público, para la página de precios y el comparador) y
>   `GET /organizations/:id/plan` (plan efectivo, de dónde sale y uso real: sitios no archivados,
>   formularios, contactos, enlaces, QR, miembros activos + invitaciones pendientes).
>
> **Verificación:** 4 pruebas del catálogo (esquema, precios enteros, un único Gratis, subir de plan
> nunca reduce un límite) + 5 e2e contra Postgres real (catálogo público contra el contrato, Gratis
> por defecto con uso real, asignación manual, suscripción vigente vs. vencida, aislamiento y 401).
> OpenAPI regenerado; sin diferencias entre schema y migraciones.

### F4.2 — Aplicación de límites en servidor
**Criterios de aceptación:**
- Cada creación sujeta a límite (sitio, página, formulario, contacto manual, enlace corto, QR,
  invitación de miembro) verifica el límite del plan efectivo **en el servidor**, dentro de la misma
  transacción o con un conteo consistente — dos peticiones simultáneas no pueden pasar el límite.
- Al superar el límite: error propio y documentado (código estable, mensaje en español, límite y uso
  actual en el cuerpo) — no un 500 ni un 400 genérico.
- Los contactos que llegan por formulario público **no** se pierden por límite: se guardan igual
  (el visitante no tiene la culpa) y la organización ve el exceso — decisión de producto, documentada.
- Bajar de plan nunca borra datos: lo que excede queda en solo lectura para crear más, no se elimina.
- Pruebas por cada límite, incluida la carrera de dos creaciones simultáneas.

> **Estado (2026-09-24): terminada.**
>
> - `PlansService.assertWithinLimit` (`apps/api/src/modules/plans/plans.service.ts`) se llama **dentro
>   de la transacción que crea** en los 8 puntos de alta: sitio, página, restaurar página (vuelve a
>   ocupar lugar), formulario, contacto manual, enlace corto, QR e invitación de miembro. Toma un lock
>   consultivo por organización y tipo de límite, resuelve el plan efectivo y cuenta — así las altas
>   simultáneas se serializan. Aceptar una invitación no se verifica: la invitación pendiente ya
>   ocupaba su lugar.
> - Error propio **402 Payment Required** (`PlanLimitExceededException`): `code: "PLAN_LIMIT_REACHED"`
>   estable, mensaje en español, `limit: { key, max, used }` y `plan: { code, name }`. 402 y no 403:
>   el usuario sí tiene permiso, le falta cupo — el panel ofrece subir de plan en vez de "no tienes
>   permiso". Documentado en OpenAPI en cada alta (`@ApiPlanLimited`).
> - Decisiones de producto: archivar un sitio libera su cupo; los miembros cuentan activos +
>   invitaciones pendientes; los contactos que llegan por formulario público **nunca** se rechazan
>   (se guardan y el exceso se ve en el uso); bajar de plan no borra nada — lo existente queda y solo
>   se bloquea crear más.
> - Pruebas de otras áreas que invitan miembros o crean varios recursos para verificar **otra** cosa
>   (roles, aislamiento, auditoría) usan un helper explícito (`test-support/plans.ts`) que pone su
>   organización en un plan con cupo — nunca un interruptor global que apague los límites.
> - Defecto encontrado al correr la suite completa y corregido: un evento de analítica de una
>   organización borrada mientras esperaba en la cola chocaba contra la clave foránea y BullMQ lo
>   reintentaba 5 veces (terminando en la dead-letter). Ahora el procesador lo descarta como
>   `orphaned`, sin reintentos (probado). Las suites que envían formularios públicos levantan su
>   propio worker de prueba para no dejar eventos en la cola de otro archivo.
>
> **Verificación:** `plan-limits.e2e.test.ts` (8 pruebas contra Postgres real: 402 con su cuerpo,
> archivar libera, páginas crear/restaurar, enlaces/QR/contactos/miembros, "sin límite" nunca bloquea,
> contacto por formulario nunca se pierde, **carrera de 5 altas simultáneas → exactamente 1**, bajar
> de plan no borra). La prueba de la carrera falla contra el código sin el lock (4 y 5 sitios creados
> con límite 1) y pasa con él. 268/269 en `@impulza/api` en dos corridas completas: el único fallo de
> cada una fue una prueba distinta por `ENOBUFS` (Windows sin puertos efímeros, ~2.400 sockets en
> `TIME_WAIT`) y ambas pasan aisladas 31/31 — ver deuda. OpenAPI regenerado.
>
> **Deuda declarada:** las pruebas e2e de `apps/api` abren una conexión nueva por petición
> (supertest sobre el `httpServer`); con más de 260 pruebas, Windows agota los puertos efímeros en la
> corrida completa. Mitigación: levantar el servidor una vez (`app.listen(0)`) y reusar conexiones
> keep-alive. No afecta a CI en Linux de la misma forma, pero conviene hacerlo antes de que la suite
> siga creciendo.

### F4.3 — Plan y uso en el panel
**Criterios de aceptación:**
- Página de plan en el panel: plan actual, medidores de uso por límite, comparador de planes.
- Cada pantalla de creación muestra el estado "límite alcanzado" con el motivo y el camino para
  subir de plan (sin cobro todavía: solicitud o enlace externo según ST §12 MVP), nunca un error
  genérico.
- Estados de carga/vacío/error/éxito, responsive (Playwright), accesible.

> **Estado (2026-09-24): terminada.**
>
> - **`/plan` ("Plan y uso", en la navegación):** plan efectivo y de dónde sale, medidores de uso
>   por límite (el estado — cerca del límite, alcanzado, por encima — va con ícono y texto además
>   del color; `role="meter"` con valor legible), y comparador de los 4 planes con precios en CLP
>   mensual/anual, el plan actual resaltado y la primera columna fija para que en un teléfono no se
>   pierda qué fila es cuál al desplazar la tabla.
> - **Cambio de plan sin cobro todavía (ST §12 MVP):** `NEXT_PUBLIC_PLAN_UPGRADE_URL` opcional
>   (`https://` o `mailto:`, validado al iniciar) — el botón "Solicitar" lleva ahí con el plan
>   elegido; sin la variable, la pantalla lo explica en vez de mostrar un botón que no lleva a nada.
> - **Aviso de límite en cada alta:** `PlanLimitNotice` reconoce el 402 por su `code` (nunca por el
>   mensaje) y reemplaza al error genérico en crear sitio, página, contacto, enlace, QR, formulario
>   rápido del constructor e invitación de miembro: qué límite, cuánto se usa y enlace a Planes.
> - **Historial de analítica por plan (hueco cerrado):** el catálogo declaraba
>   `analyticsHistoryDays` pero el dashboard de F3.7 no lo aplicaba — mostrarlo en el comparador
>   sin aplicarlo habría sido engañoso. Ahora `GET .../analytics/overview` responde 402 si el rango
>   empieza antes de lo que permite el plan (Gratis: 30 días), y `/analitica` muestra el aviso en vez
>   de un error. Los datos más viejos no se borran (eso es la retención, ADR-004): solo no se muestran.
>
> **Verificación:** prueba e2e de API del límite de historial (30 días OK, 90 días → 402 con su
> cuerpo, con plan mayor → 200). Playwright `plan.spec.ts` (móvil y escritorio: plan y uso reales,
> cambio mensual/anual, sin desplazamiento horizontal, aviso de límite con enlace a Planes) — la del
> aviso falla contra el panel sin el reconocimiento del 402 y pasa con él; 35/35 de la suite e2e.
> 270/270 en `@impulza/api`. Revisión visual con capturas reales (escritorio y móvil). OpenAPI
> regenerado; `lint`/`typecheck` 24/24; build del panel.

### F4.4 — Superadministración mínima (`apps/admin`)
**Criterios de aceptación:**
- ADR nuevo: modelo de superadministrador (quién lo es, cómo se otorga, cómo se separa de los roles
  de organización — ADR-002 §4 ya prevé acciones sin organización en `AuditLog`).
- `apps/admin` con autenticación propia de superadministrador y 2FA obligatorio.
- Dashboard global mínimo (PM §12.1): usuarios, organizaciones, sitios publicados, altas recientes,
  distribución por plan.
- Buscar organización/usuario; ver plan y uso; cambiar plan manualmente; bloquear y restaurar una
  organización (bloqueada = su sitio público no se sirve y su panel queda en solo lectura).
- Toda acción de superadministración auditada con actor real; nunca acceso silencioso a datos
  comerciales de una organización.
- Editar el catálogo de planes (resuelve la decisión #4 sin deploy).

> **Estado (2026-09-24): terminada en local.** ADR-005 aprobado por Favio el mismo día.
>
> - **Quién es superadministrador:** `User.isSuperAdmin`, nunca una membresía. Solo se otorga o quita
>   con el script de operación `pnpm --filter @impulza/api run superadmin -- grant|revoke <correo>`.
>   No hay endpoint para eso. `grant` enrola el 2FA en el mismo paso e imprime la clave una sola vez,
>   así que nunca existe un superadministrador sin 2FA. `revoke` cierra sus sesiones de administración
>   en el acto. Ambos quedan auditados (`via: "cli"`).
> - **Puerta propia:** `POST /api/v1/admin/auth/login` pide correo, contraseña y código TOTP en la
>   misma petición y da el mismo error para cualquier fallo. Un código incorrecto cuenta para el
>   bloqueo de 5 intentos de F1.4, un código ya usado no vale dos veces (Redis) y hay rate limit
>   5/5 min. La sesión es `Session.scope = ADMIN`, con cookie `impulza_admin_session` (`HttpOnly`,
>   `SameSite=Strict`, `path=/api/v1/admin`) y 8 h sin renovación. `AdminSessionGuard` revisa marca y
>   2FA en cada petición, `SessionAuthGuard` rechaza sesiones `ADMIN` y viceversa.
> - **Solo metadatos (ADR-005 §5):** el resumen muestra totales, altas por día de 30 días, distribución
>   por plan efectivo y organizaciones recientes. Se puede buscar organizaciones (por nombre, slug o
>   correo de un miembro) y usuarios. El detalle trae plan, uso, miembros (correo y rol) y sitios
>   (en línea o no), sin contactos, envíos, contenido ni analítica. **Abrir el detalle queda auditado**
>   (`admin.organization_viewed`).
> - **Cambiar plan / bloquear / restaurar:** siempre con un motivo escrito y auditado con el actor
>   real (`admin.organization_plan_changed`, `_blocked`, `_unblocked`). Bloquear hace que sitio,
>   páginas, formularios, enlaces cortos, QR y eventos respondan 404 (una sola constante,
>   `ACTIVE_ORGANIZATION`), sin decir por qué, e invalida la caché de `apps/web`. El panel queda en
>   solo lectura (`OrganizationMembershipGuard`: `403 ORGANIZATION_BLOCKED` en toda escritura) con un
>   aviso permanente que muestra el motivo.
> - **Catálogo de planes editable:** `PATCH /admin/plans/:id` cambia nombre, precios, moneda y
>   límites, valida con `planLimitsSchema` y audita el antes y el después. El seed ya no sobrescribe
>   planes existentes.
> - **`apps/admin`** (Next.js, puerto 3200): ingreso, Resumen, Organizaciones y su detalle, Usuarios,
>   Planes y Auditoría. Todas las pantallas tienen estados de carga, vacío, error y éxito y son
>   responsive. Migración `20260924225627_fase4_superadmin`, no destructiva.
>
> **Verificación:** 26 pruebas e2e nuevas en `admin.e2e.test.ts`. Se confirmó que fallan al quitar
> cada protección: el scope de sesión, el solo lectura, el filtro público y el anti-repetición.
> `@impulza/api` pasa 296/296. Playwright `admin.spec.ts` corre en móvil y escritorio y cubre: sin
> sesión redirige a ingresar, la sesión del panel no abre la administración, resumen con vista de
> tabla, buscar y abrir detalle, bloquear con motivo y ver el aviso en el panel del cliente,
> restaurar, validación del editor de planes, y ninguna pantalla con desplazamiento horizontal. La
> suite completa pasa 49/49 (1 omitida, ya existente). `lint`/`typecheck`/`test`/`build` pasan 58/58.
> OpenAPI regenerado. Revisión visual con capturas reales de escritorio y móvil.
>
> **Deudas declaradas (no bloquean el cierre local):**
> - **CI y staging:** el repositorio no tiene remoto, así que el CI nunca corrió. Tampoco hay staging
>   (depende de la decisión de hosting, F4.8). Aplica a todas las fases, no solo a esta.
> - **2FA en el login del panel:** una cuenta con 2FA activo todavía entra al panel solo con
>   contraseña. Es deuda de F1.4, anterior a ADR-005, y queda propuesta para F4.9.
> - **Bloqueo y derechos ARCO:** una organización bloqueada no puede borrar contactos desde su panel
>   (es una escritura). Mientras dure el bloqueo, esas solicitudes pasan por soporte (F4.5).
> - **Distribución por plan:** se calcula cargando los id de todas las organizaciones. Sirve hasta
>   miles; a más escala conviene un agregado en SQL.

### F4.5 — Soporte mínimo
**Criterios de aceptación:**
- Desde el panel, un usuario abre una solicitud de soporte (asunto, detalle, organización) y ve su
  estado; en `apps/admin` se listan, responden y cierran.
- Sin adjuntos hasta que exista almacenamiento de media (decisión #7).
- Notificación por email al abrir y al responder, por el adaptador de email existente.

### F4.6 — Cobro recurrente con pasarela *(bloqueada por la decisión #5)*
**Criterios de aceptación:**
- Contrato `PaymentProvider` con adaptador del proveedor elegido (ARCHITECTURE.md §5).
- Webhooks firmados e idempotentes; solo referencias del proveedor, nunca datos de tarjeta.
- Estados de suscripción (prueba, activa, morosa, cancelada), período de gracia y reintentos.

### F4.7 — Dominios personalizados
**Criterios de aceptación:**
- `SiteDomain` (ERD §4): alta de dominio propio para un sitio, verificación de propiedad por registro
  DNS TXT, instrucciones de CNAME, estado de verificación y de SSL.
- `apps/web` resuelve el sitio por dominio verificado además de por slug.
- Prevención de toma de dominio ajeno (un dominio verificado por otra organización no se puede
  reclamar) y de SSRF en la verificación.
- La emisión de SSL depende del hosting (F4.8): hasta entonces, la verificación y el ruteo quedan
  listos y la emisión, documentada como paso de despliegue.

### F4.8 — Producción y monitoreo *(bloqueada por decisión de hosting)*
**Criterios de aceptación:**
- Entornos staging y producción con datos y claves propios (ST §17), despliegue con migración,
  smoke test, health check y rollback (ST §18).
- Backups cifrados con prueba de restauración documentada (no negociable de `CLAUDE.md`).
- Alertas sobre errores (Sentry) y sobre la dead-letter de las colas (F3.6).

### F4.9 — Aislamiento y seguridad de Fase 4
**Criterios de aceptación:**
- Suite central de aislamiento extendida: el plan, el uso, las solicitudes de soporte y los dominios
  de otra organización no son legibles ni modificables por id cruzado.
- Un usuario de organización nunca alcanza `apps/admin` ni sus endpoints.
- Un límite no se puede evadir cambiando el plan desde el cliente ni creando en paralelo.

## Salida de Fase 4

Fase 4 se considera terminada cuando: cada organización tiene un plan con límites aplicados en el
servidor y visibles en el panel; la superadministración puede ver la plataforma, asignar planes y
bloquear con auditoría; existe un canal de soporte; un sitio puede servirse en un dominio propio
verificado; y la plataforma corre en producción con monitoreo y backups probados. F4.6 y F4.8
requieren antes las decisiones del propietario indicadas arriba.
