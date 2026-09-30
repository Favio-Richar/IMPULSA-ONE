# Impulza One

Plataforma SaaS multiusuario y multiempresa para construir un centro digital de negocio (marca,
captación, reservas, ventas y analítica) desde una sola URL.

**Estado actual (2026-09-30): Fase 7 en curso — F7.1 (GA4 y píxel de Meta con consentimiento, y CSP
en la página pública, ADR-016) y F7.2 (webhooks salientes firmados hacia Zapier, Make u otros
sistemas, ADR-017) listas para revisión; sigue F7.3. Los cobros de
los negocios (F5.8–F5.11, ADR-013 y ADR-015) quedaron completos y en revisión. Lo pendiente de todo
el plan está en `docs/BACKLOG_FASE_7.md`.** Fase 4 — cobro de suscripciones (F4.6, ADR-012) en curso: F4.6a (motor de
facturación y Webpay Oneclick), F4.6c (Plan y pagos en el panel) y F4.6d (Facturación en la
superadministración) listas para revisión, igual que F4.6b (Mercado Pago, pendiente de probar con credenciales reales). Fase 6 — Diferenciación — en curso (backlog en `docs/BACKLOG_FASE_6.md`). F6.1
(salud de página), F6.2 (motor de IA con modelos locales primero, ADR-010), F6.2b (conexiones de IA
en la administración), F6.3 (asistente de textos en el constructor), F6.4 (lectura comercial con IA
en Analítica), F6.5 (pruebas A/B, ADR-011), F6.6 (Smart CTA) y F6.7 (automatizaciones) listas para
revisión; F6.10 (aislamiento de la fase) se cierra con ellas. Modo
agencia y marca blanca
esperan la decisión #8. Fase 5 — Negocio digital — F5.1–F5.7 listas para revisión del propietario
(backlog en `docs/BACKLOG_FASE_5.md`): reservas con disponibilidad y sin doble reserva, agenda,
correos con enlace firmado para cancelar o reprogramar, catálogo y pedidos con pago externo,
campañas de email con consentimiento y baja, y la revisión de aislamiento y seguridad de la fase.
La portada comercial suma una escena 3D con three.js (ADR-009).
Lo que falta depende de decisiones del propietario (#6 cobros, #4 límites por plan, hosting de F4.8,
proveedor de correo). Fase 4: F4.1–F4.5, F4.7 y F4.9 hechas; F4.6 y F4.8 bloqueadas. Página pública
premium (`docs/BACKLOG_PAGINA_PREMIUM.md`) terminada en local salvo el contenido de la biblioteca de
videos de PP3.** Fase 2
(sitio público y constructor) y Fase 1 y 0 están cerradas. El modelo de datos de conversión
(formularios, contactos/mini-CRM, QR/enlaces cortos y analítica) existe en `packages/database`, con
consentimiento auditado y minimización pensados desde el diseño (`docs/decisions/ADR-004-privacidad-
retencion-datos.md`, Ley 21.719). Un sitio puede publicar un formulario de contacto real: se crea
desde el panel, el visitante lo llena en el sitio público, y el envío queda en el mini-CRM de
contactos (`/contactos`) con consentimiento auditado, línea de tiempo, etiquetas y estado
comercial editables. Desde `/enlaces` se crean enlaces cortos (`/s/:slug`) y códigos QR
descargables que cuentan cada clic y escaneo. Ver `docs/BACKLOG_FASE_5.md` para el backlog de la fase activa,
`docs/BACKLOG_FASE_4.md`…`docs/BACKLOG_FASE_0_1.md` para las anteriores y `CLAUDE.md` para las
reglas de trabajo del repositorio.

| Fase | Historias | Estado |
|---|---|---|
| 0 — Preparación | F0.1–F0.5 | Terminada |
| 1 — Cimientos y cuenta | F1.1–F1.10 | Terminada |
| 2 — Sitio público y constructor | F2.1–F2.10 | Terminada |
| 3 — Conversión | F3.1–F3.8 | Terminada |
| 4 — SaaS comercial | F4.1–F4.9 | En progreso |
| 5 — Negocio digital | F5.1–F5.7 | Lista para revisión (cobros bloqueados por decisión #6) |
| 6 — Diferenciación | F6.1–F6.10 | En progreso (F6.1–F6.7 listas para revisión; F6.8–F6.9 bloqueadas por decisión #8) |

## Requisitos

- Node.js `24.x` (LTS) — ver `.nvmrc`.
- [Corepack](https://nodejs.org/api/corepack.html) habilitado (viene con Node 24):
  `corepack enable`.
- pnpm se activa vía Corepack a partir del campo `packageManager` de `package.json`; no hace falta
  instalarlo aparte.
- Docker (para Postgres/Redis locales — se configura en F0.4, todavía no incluido).

> **Windows sin permisos de administrador**: `corepack enable` necesita escribir shims en
> `C:\Program Files\nodejs\` y falla con `EPERM` si la terminal no es de administrador. Alternativa
> sin instalar nada globalmente: anteponer `npx pnpm@12.4.1` a cada comando (p. ej.
> `npx pnpm@12.4.1 install`), o abrir una terminal como administrador una sola vez para correr
> `corepack enable`.

## Arranque local

```bash
corepack enable
cp .env.example .env                      # raíz — lo lee apps/api, packages/database
cp .env.example apps/dashboard/.env.local  # Next.js no lee el .env de la raíz (solo NEXT_PUBLIC_API_URL importa aquí)
echo "NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1" > apps/admin/.env.local  # superadministración (F4.4)
pnpm install
pnpm docker:up           # Postgres + Redis locales (ver "Entorno local" abajo)
pnpm --filter @impulza/database run db:migrate:dev   # crea las tablas
pnpm --filter @impulza/database run db:seed           # roles + plan gratuito
pnpm build                # turbo run build en todas las apps/paquetes
pnpm dev                  # turbo run dev (apps Next.js + API en watch mode)
```

Scripts disponibles en la raíz (delegan en Turborepo salvo los de Docker):

| Script | Qué hace |
|---|---|
| `pnpm build` | Compila todas las apps y paquetes. |
| `pnpm dev` | Levanta las apps en modo desarrollo. |
| `pnpm lint` | Lint en todo el monorepo. |
| `pnpm typecheck` | Chequeo de tipos en todo el monorepo. |
| `pnpm test` | Pruebas en todo el monorepo (Vitest; hoy `--passWithNoTests`, se llenan desde Fase 1). |
| `pnpm openapi:generate` | Regenera `docs/api/openapi.json` desde la API real (necesita Postgres + Redis). |
| `pnpm docker:up` | Levanta Postgres + Redis (`docker compose up -d`). |
| `pnpm docker:down` | Detiene y elimina los contenedores. |
| `pnpm docker:logs` | Sigue los logs de los contenedores. |

## Entorno local

`packages/config` valida las variables de entorno con Zod al arrancar cada app — si falta una
requerida o tiene un formato inválido, el proceso no arranca y explica exactamente cuál falla (ver
`packages/config/src/index.ts`). Copiar `.env.example` a `.env` (nunca commitear el real) y ajustar
si es necesario.

`docker-compose.yml` levanta Postgres 18 y Redis 8 para desarrollo local (`pnpm docker:up`).
**Puertos no estándar a propósito**: esta máquina de desarrollo ya corre otros proyectos con
Postgres en `5432`/`55432` y Redis en `6379`/`56379`, así que Impulza One usa:

| Servicio | Puerto host | Motivo |
|---|---|---|
| Postgres | `55433` | evita choque con otros proyectos locales |
| Redis | `56380` | evita choque con otros proyectos locales |
| MinIO (opcional, perfil `storage`) | `9010`/`9011` | evita choque con otros proyectos locales |

Ajustable vía `POSTGRES_PORT`/`REDIS_PORT`/`MINIO_PORT`/`MINIO_CONSOLE_PORT` en `.env` si estos
también chocan en otra máquina. MinIO no se levanta por defecto — solo con
`docker compose --profile storage up -d`.

> **Nota Postgres 18**: la imagen oficial cambió la convención de volumen — monta en
> `/var/lib/postgresql` (no `.../data`), porque ahora organiza los datos por versión mayor
> (estilo `pg_ctlcluster`). Si vienes de Postgres ≤17, no reutilices ese volumen tal cual.

## Base de datos (`packages/database`)

Prisma sobre PostgreSQL. La migración inicial cubre las entidades de identidad/organización del
ERD: `User`, `Session`, `Account`, `Organization`, `Membership`, `Role`, `Permission`,
`RolePermission`, `Plan`, `Subscription`, `UsageCounter`, `AuditLog`. Reservas/catálogo/pagos de
negocio se agregan recién en Fase 5 (`docs/architecture/ERD.md` §10) — no antes.

```bash
pnpm docker:up                                          # Postgres + Redis arriba
cp .env.example packages/database/.env                  # Prisma CLI lee .env desde su propio cwd
pnpm --filter @impulza/database run db:migrate:dev       # crea/aplica migraciones
pnpm --filter @impulza/database run db:seed              # 7 roles + plan Gratis
pnpm --filter @impulza/database run db:studio            # explorar datos (opcional)
```

> **Por qué Prisma `6.19.3` y no `7.x`**: se probó primero con `7.10.0` (la versión estable más
> reciente en ese momento — `prisma@latest` en npm apunta hoy a `8.0.0-rc.15`, un release
> candidate, así que `7.10.0` era la elección correcta según esa misma lógica). Prisma 7 cambió
> el datasource a `prisma.config.ts` + driver adapters (`@prisma/adapter-pg`), y se implementó
> así — pero el cliente generado (`prisma generate`) producía archivos `.d.ts` vacíos en esta
> máquina (bug verificado empíricamente, no una suposición: `default.d.ts`/`client.d.ts` con 0
> líneas pese a que el `schema.prisma` embebido sí tenía los modelos). Se bajó a `6.19.3` —última
> de la serie 6.x, arquitectura clásica madura sin este problema— y todo funcionó de inmediato.
> Revisar si se retoma mucho después: Prisma 7/8 puede haber madurado para entonces.

Todo lo anterior fue verificado migrando y sembrando de verdad contra el Postgres de
`docker-compose.yml`, no solo compilado.

## Autenticación (F1.4)

`apps/api/src/modules/auth` — sesión por cookie `HttpOnly`/`SameSite=Lax` (respaldada por la
tabla `Session`, no JWT: permite revocación real), no `packages/auth` puro:

- Registro, verificación de correo, login, logout, recuperar/restablecer contraseña.
- Hash de contraseñas con Argon2id (`packages/auth`); nunca texto plano ni siquiera en tránsito
  interno.
- Bloqueo de cuenta tras 5 intentos fallidos (15 min) + rate limiting por IP respaldado en Redis
  en cada endpoint sensible (`RateLimitGuard`, no `@nestjs/throttler` — ver más abajo).
- CSRF: cabecera `X-Requested-With: impulza-one` obligatoria en toda solicitud mutante
  (`CsrfGuard`), combinada con `SameSite=Lax` y CORS restrictivo. Todo cliente propio (dashboard,
  admin) debe enviar esa cabecera.
- Sesiones/dispositivos activos listables y revocables (`GET/DELETE /auth/sessions`) — revocar
  siempre verifica que la sesión pertenezca al usuario autenticado, nunca confía en el `id` de la
  URL a solas (mismo principio que `organization_id` en ADR-002, aplicado a nivel de usuario).
- 2FA: diseño de datos completo (`User.twoFactorEnabled`/`twoFactorSecretEncrypted`, cifrado
  AES-256-GCM en reposo) + endpoints `setup`/`enable`/`disable` funcionales con TOTP real
  (`otplib`). **No se exige todavía en el login** — permitido explícitamente hasta antes de
  producción comercial (backlog F1.4).
- Login con Google: sin implementar a propósito — no hay credenciales reales de OAuth todavía;
  el modelo `Account` (provider/providerAccountId) ya está listo para cuando corresponda.
- Email: `ConsoleEmailAdapter` (loguea en vez de enviar) hasta que exista un proveedor real
  (Resend/SES) — implementa el mismo contrato `EmailAdapter`, cambiarlo no toca lógica de negocio.

Verificado con 11 pruebas de integración reales (`apps/api/src/modules/auth/auth.e2e.test.ts`) —
NestJS completo + Postgres/Redis reales de `docker-compose.yml`, sin mocks de base de datos.
Corren en CI contra servicios Postgres/Redis dedicados (ver `.github/workflows/ci.yml`).

## Organizaciones y membresías (F1.5)

`apps/api/src/modules/organizations` — implementa directamente el principio central de ADR-002:
**ningún endpoint confía en el `organizationId` de la URL**. `OrganizationMembershipGuard`
resuelve la membresía real del usuario autenticado (`Membership` en la base, no el parámetro de
la request) y exige que esté `ACTIVE`; si no, `403` sin distinguir "no existe" de "no tienes
acceso" (no revela qué organizaciones existen a quien no pertenece a ellas).

- Crear organización (el creador queda `OWNER` con membresía `ACTIVE` en la misma transacción).
- Invitar por correo — requiere que la persona ya tenga cuenta registrada (si no, `404` explícito;
  invitar a alguien sin cuenta queda fuera de alcance de F1.5 a propósito, no es un olvido).
- Aceptar invitación — endpoint aparte (`POST /memberships/:id/accept`, no bajo
  `/organizations/:id/...`) porque quien acepta todavía no tiene membresía `ACTIVE` y no pasaría
  el guard de organización; solo verifica que la invitación sea la suya.
- Cambiar rol / remover miembro — solo `OWNER`/`ADMIN` (chequeo en el servicio; el guard
  declarativo por rol reutilizable llega en F1.6). El rol `OWNER` no se cambia ni se remueve por
  esta vía.
- Un usuario puede pertenecer a varias organizaciones (`GET /organizations` lista las propias);
  el cambio de organización activa en el frontend es responsabilidad de `apps/dashboard` (F1.8+).

Verificado con 11 pruebas de integración reales
(`apps/api/src/modules/organizations/organizations.e2e.test.ts`), incluyendo un caso explícito de
aislamiento multi-tenant con dos organizaciones reales — la misma base que exige F1.9 de forma
transversal para toda Fase 1.

## Roles y permisos — RBAC (F1.6)

Catálogo de permisos explícito en `packages/database/src/permissions.ts` — única fuente de verdad
compartida entre `apps/api` (guard) y `packages/database/prisma/seed.ts` (datos). Reemplaza el
chequeo `OWNER/ADMIN` hardcodeado que F1.5 tenía en el servicio de organizaciones por un mecanismo
declarativo y reutilizable:

```ts
@UseGuards(OrganizationMembershipGuard, PermissionGuard)
@RequirePermission(PERMISSIONS.ORGANIZATION_MEMBERS_INVITE)
```

`PermissionGuard` consulta `RolePermission` en la base (rol de la membresía activa, resuelta por
`OrganizationMembershipGuard` — nunca un rol declarado por el cliente) y siempre corre después del
guard de membresía. Hoy los permisos se evalúan solo por rol global; el modelo
(`Role` → `RolePermission` → `Permission`) ya soporta restricciones más finas por recurso cuando
haga falta, sin cambio de esquema — cumple el criterio de F1.6 de estar "preparado" sin
implementar el detalle fino todavía.

Solo existen los 3 permisos que ya tienen un endpoint real detrás (invitar/cambiar rol/remover
miembro) — no se inventan permisos para funciones de fases futuras. `SUPER_ADMIN` no recibe
permisos de organización por este mecanismo (ADR-002 §4: ruta de superadministración aparte).

CI ahora corre el seed (`db:seed`) además de las migraciones antes de testear — los tests de
organizaciones dependían de los roles sembrados desde F1.5, solo que no estaba explícito en el
pipeline hasta ahora.

## Auditoría (F1.7)

`AuditService` (`apps/api/src/modules/audit`) es global — cualquier servicio la inyecta sin
importar el módulo. Registra `actor`, `acción`, `objetivo` y `timestamp` para:

| Acción | Actor | Cuándo |
|---|---|---|
| `organization.created` | quien crea | al crear una organización |
| `membership.invited` | quien invita | al invitar a un miembro |
| `membership.role_changed` | quien cambia | al cambiar el rol de un miembro |
| `membership.removed` | quien remueve | al remover a un miembro |
| `auth.account_locked` | `null` | tras 5 intentos de login fallidos (nadie demostró identidad) |
| `auth.password_reset` | el propio usuario | al completar recuperación de contraseña |
| `auth.two_factor_enabled`/`_disabled` | el propio usuario | al activar/desactivar 2FA |

`metadata` solo lleva datos que ya serían visibles para quien tiene acceso legítimo al recurso
(correo, nombre de rol) — nunca contraseñas, hashes ni tokens (ST §16, no negociable); verificado
con una aserción explícita en los tests, no solo por convención. Sin endpoint de lectura todavía
— no hay consumidor real (panel de superadmin es Fase 6); se agrega cuando exista.

Verificado con 3 pruebas de integración reales adicionales
(`apps/api/src/modules/audit/audit.e2e.test.ts`) que consultan `audit_logs` directamente después
de cada acción, no solo el código de estado HTTP.

## Panel — apps/dashboard (F1.8)

Primera app frontend real del monorepo, consumiendo `apps/api` de verdad (TanStack Query +
`fetch` con `credentials: "include"` y la cabecera CSRF en mutaciones — ver
`lib/api-client.ts`). Login/registro/verificación de correo + layout protegido con los 5 estados
obligatorios:

| Estado | Dónde |
|---|---|
| Carga | mientras se resuelve `GET /auth/me` |
| Desconectado | sesión inválida/expirada → redirige a `/login`, no muestra un panel roto |
| Error recuperable | falla de red/servidor → `ErrorState` con reintento |
| Vacío | usuario sin organizaciones → CTA para crear la primera |
| Sin permisos | la membresía activa deja de ser válida (403) mientras se navega |

Sidebar con navegación honesta: solo "Inicio" y "Configuración" — el resto de PM §13 (Mi sitio,
Negocio, Analítica...) no existe todavía, así que no aparece ("el menú muestra solo módulos
habilitados"). Selector de organización activa en Zustand (persistido), separado del estado del
servidor (TanStack Query) — un usuario puede pertenecer a varias organizaciones (F1.5).

Verificado interactuando de verdad en un navegador (Claude in Chrome), no solo con
build/typecheck: registro → verificación de correo → login → panel vacío → crear organización →
tabla de miembros con datos reales → invitar → logout → redirección al intentar entrar sin
sesión. Encontró y permitió corregir dos bugs reales en el camino (ver más abajo).

> **`pnpm dev` de `apps/api` cambió de `tsx` a `vite-node`**: al probar el flujo en el navegador,
> `tsx` (esbuild) resultó no resolver correctamente `emitDecoratorMetadata` para parámetros de
> constructor inyectados implícitamente (`Reflector`, y hasta el propio `AuthService` en
> `AuthController`) — el build con `tsc` y los tests con Vitest nunca mostraron el problema porque
> usan un transform distinto. Se cambió el runner de desarrollo a `vite-node` (mismo transform que
> ya probó funcionar en los tests) y se hicieron explícitas las inyecciones de `Reflector` con
> `@Inject()` en los guards — más robusto en cualquier transform, no solo un parche puntual.
>
> **Bug real de ruteo**: `app/(panel)/page.tsx` y un `app/page.tsx` con redirect competían por la
> misma ruta `/` porque los grupos de rutas `(panel)`/`(auth)` de Next.js no agregan segmento a la
> URL — se eliminó el redirect redundante; el panel vive directamente en `/`.

## Aislamiento multi-tenant — prueba transversal (F1.9)

`apps/api/src/multi-tenant-isolation.e2e.test.ts` — exactamente lo que pide el backlog: dos
organizaciones reales (`Org A` con OWNER+ADMIN, `Org B` con OWNER+EDITOR), 12 pruebas de
integración que intentan cruzar datos entre ambas por cada endpoint de organización que existe
hasta Fase 1:

- Leer, listar miembros, invitar, cambiar rol y remover en la organización ajena — con el OWNER
  de A y también con el ADMIN de A (tener permisos reales en A no da ningún permiso en B).
- **Ataque de `membershipId` cruzado**: `organizationId` de la URL correcto (A, donde sí hay
  permiso) pero `membershipId` de un miembro de B — prueba que `getOrgMembershipOrThrow` rechaza
  por dueño real del recurso, no solo el guard de nivel superior.
- Aceptar una invitación ajena.
- Ningún listado (`GET /organizations`, lista de miembros) filtra a medias — nunca aparece ni un
  id ni un correo de la organización/usuario ajeno.
- Simétrico: se repite con B atacando a A.

Este archivo es la base a extender en cada fase posterior que agregue endpoints con datos de
organización — el criterio de F1.9 se re-exige, no se da por cumplido una sola vez.

## Observabilidad mínima (F1.10)

`packages/observability` — nuevo paquete compartido (ya estaba reservado en ARCHITECTURE.md §3
desde F0.2), consumido por `apps/api` y `apps/worker`:

- **Logs JSON estructurados**: `createLogger(service)` emite una línea JSON por evento
  (`timestamp`, `level`, `service`, `message`, `request_id`, `trace_id`, ...campos) por
  `stdout` — listo para un colector tipo Loki/CloudWatch (ARCHITECTURE.md §2). Redacta
  recursivamente cualquier clave que matchee `password|secret|token|authorization|cookie|api[-_
  ]?key|encryptionKey|dsn` en cualquier profundidad del objeto, y serializa instancias de `Error`
  como `{name, message, stack}` — defensa en profundidad además del cuidado de cada caller.
- **Correlación por request**: `runWithRequestContext`/`getRequestId`/`getTraceId` usan
  `AsyncLocalStorage` para que todo log emitido durante el ciclo de vida de una request (incluidos
  callbacks async y el evento `finish` de la respuesta) lleve el mismo `request_id`. `trace_id` se
  toma del header `traceparent` (W3C Trace Context) o `x-trace-id` si vienen, o se genera si es la
  raíz del trace — pensado para cuando `apps/api` encole un job y `apps/worker` continúe el mismo
  trace.
  - `apps/api`: `common/request-context.middleware.ts`, primer middleware de la cadena; agrega el
    header de respuesta `X-Request-Id` y loguea un evento `"request"` por cada request con
    método/ruta/status/duración. Los logs internos de Nest (bootstrap, rutas mapeadas) se puentean
    al mismo formato JSON vía `NestJsonLogger` (`observability/nest-logger.ts`), pasado como
    `logger` a `NestFactory.create`.
  - `apps/worker`: mismo patrón sobre el servidor HTTP mínimo de `/health` (`health-server.ts`) —
    el worker placeholder de F0.2 todavía no tiene BullMQ real, así que hoy es lo único que
    escucha.
- **`/health`**: `runHealthChecks(service, checks[])` corre cada dependencia con timeout individual
  (por defecto 2s) sin lanzar nunca — una caída degrada el reporte (`status: "degraded"`, HTTP 503)
  en vez de tumbar el endpoint.
  - `apps/api` — `GET /health` (fuera del prefijo `/api/v1` a propósito, es un endpoint de
    infraestructura): comprueba `SELECT 1` en Postgres y `PING` en Redis de verdad, sin guards
    (un probe de LB no manda cookie de sesión ni cabecera CSRF).
  - `apps/worker` — `GET /health` en `WORKER_PORT` (`4100` en desarrollo, variable propia porque
    ambos procesos leen el mismo `.env` de raíz y no pueden compartir `PORT`): liveness pura hoy
    (sin checks — el worker no abre ninguna conexión real todavía, ver `apps/worker/src/env.ts`);
    sumará un check `redis`/`queue` cuando llegue la primera cola BullMQ real.
- **Sentry**: `initSentry({dsn, environment, service, release})` es un no-op explícito sin
  `SENTRY_DSN` (no es requisito para arrancar en desarrollo). Con DSN, `sendDefaultPii: false` y un
  `beforeSend` que elimina cookies/headers/body/query string del evento antes de enviarlo — nunca
  viaja una cookie de sesión, cabecera `Authorization` ni el cuerpo de un request a un tercero. El
  filtro catch-all de Nest (`common/all-exceptions.filter.ts`, patrón oficial de Nest para
  reporters externos) solo envía a Sentry y loguea como `error` las excepciones ≥500 — un 400/403
  es un flujo esperado de la app, no un incidente, y no debe llenar Sentry de ruido.

Verificado en vivo (no solo con tests): arrancados `apps/api` y `apps/worker` con `pnpm dev`, se
confirmó por `curl` que `/health` responde 200 con `checks` reales, que cada request deja una línea
JSON con `request_id`/`trace_id` correlacionados con el header `X-Request-Id` de la respuesta, y que
un 400 de validación (`POST /auth/register` con email inválido) **no** genera un log `error` ni
tocaría Sentry — solo los `status >= 500` lo hacen.

## Modelo de datos de sitios, páginas y bloques (F2.1)

Primera historia de Fase 2 (ver `docs/BACKLOG_FASE_2.md`). Agrega al esquema las entidades de
`ERD.md` §3: `Site`, `SiteDomain`, `SiteSlugRedirect`, `Page`, `PageVersion`, `Block`,
`BlockVersion` y `Theme`. Decisiones que no se leen solas en el esquema:

- **`order` → `position`**: el ERD llama `order` al campo de orden de `Page`/`Block`; en Prisma se
  llama `position` porque `order` es palabra reservada de SQL. Mismo concepto, anotado en el ERD.
- **`SiteSlugRedirect` no estaba en el ERD**: lo exige el criterio de F2.2 ("cambiar el slug de un
  sitio publicado deja una redirección registrada") y PM §9.14. Se agregó al modelo **y al ERD** en
  vez de inventarlo solo en el código.
- **`position` sin restricción de unicidad** en `Page`/`Block`: reordenar intercambia posiciones y
  un `UNIQUE` no diferido fallaría a mitad de la transacción. El orden lo garantiza la aplicación.
- **`Block.type` es `String`, no un enum de Postgres**: la biblioteca de bloques crece (PM §9.3) y
  no queremos una migración por cada tipo nuevo. El catálogo cerrado con su esquema Zod versionado
  llega en F2.4, en `packages/database/src/blocks.ts` — mismo patrón que `permissions.ts`, que ya
  es fuente de verdad única compartida entre la validación de la API y el seed.
- **`Theme.code` único y anulable**: los temas del catálogo global llevan código (para que el seed
  sea idempotente) y los temas propios de una organización lo dejan en `null`; Postgres permite
  múltiples `NULL` en un índice único, así que ambas cosas conviven sin una tabla aparte.

`packages/database/src/schema-sites.test.ts` prueba contra el Postgres real lo que garantiza la
**base de datos** aunque la aplicación tenga un bug: unicidad global del slug de sitio (incluso
entre organizaciones distintas), unicidad del slug de página por sitio (y que sí se repita entre
sitios), unicidad del número de versión, que dos páginas puedan compartir posición, el borrado en
cascada completo sin huérfanos, y que borrar un tema deje el sitio sin tema en vez de borrarlo.

**Migración verificada de ida y vuelta**, no por confianza: se creó una base desechable
(`impulza_migcheck`), se aplicó toda la cadena desde cero, se ejecutó el `down.sql` que acompaña a
la migración, se comprobó que solo quedaran las tablas de Fase 0/1, y se volvió a aplicar la
migración. La base de desarrollo nunca recibió nada más que DDL aditivo (`CREATE TABLE`/`CREATE
INDEX` y claves foráneas sobre tablas nuevas; ningún `DROP`/`DELETE`/`TRUNCATE`).

## Sitios: CRUD y reglas de slug (F2.2)

`apps/api/src/modules/sites/` — endpoints bajo `/organizations/:organizationId/sites`. La ruta
cuelga de la organización a propósito: así `OrganizationMembershipGuard` resuelve el tenant desde
la membresía real (ADR-002) antes de que el servicio vea nada.

**El slug es un espacio de nombres único y compartido.** Tres reglas, todas en servidor:

1. Formato (`packages/validation`): minúsculas, dígitos y guiones, 3–63 caracteres, sin guiones al
   borde. Vive en el paquete compartido porque el constructor (F2.9) necesita la misma regla para
   dar feedback inmediato — pero el servidor siempre revalida, nunca confía en el cliente.
2. Lista de reservados (`www`, `api`, `admin`, `panel`, `checkout`, `sitemap`, `health`, …): un
   usuario no puede tomar un nombre que colisiona con infraestructura o con rutas de la plataforma.
3. Disponibilidad **cruzada entre dos tablas**: un slug está libre solo si no lo usa otro sitio
   *y* no lo ocupa una redirección viva. Ambas resuelven la misma URL pública, así que compiten por
   el mismo nombre; la base de datos garantiza unicidad dentro de cada tabla, pero esta regla
   cruzada solo puede vivir en la aplicación.

**Redirecciones al renombrar**: cambiar el slug de un sitio *publicado* deja un `SiteSlugRedirect`
desde el slug viejo, porque tiene enlaces vivos afuera. Un borrador no la genera: nunca fue
alcanzable públicamente y sería basura. Un sitio sí puede recuperar un slug propio que dejó atrás
(esa redirección se libera, apuntaría a sí misma), pero otro sitio no puede quedárselo.

**Carrera de slug cubierta**: entre la comprobación de disponibilidad y el `INSERT` hay una
ventana en la que dos peticiones simultáneas pueden pasar ambas. La restricción única de Postgres
es la que decide de verdad, y el `P2002` se traduce a 409 — hay una prueba que lanza las dos
creaciones en paralelo y exige `[201, 409]`, nunca un 500.

**Archivar, no borrar** (`POST /sites/:id/archive`, no `DELETE`): el contenido del usuario no se
destruye desde un CRUD. Es idempotente — archivar dos veces no falla ni duplica la auditoría.

**Permisos** (`site.create` / `site.update` / `site.archive`, añadidos al catálogo compartido de
F1.6): EDITOR **sí** edita sitios, que es su trabajo, pero no los crea ni los archiva — crear
consume cupo del plan y archivar saca un sitio de producción, ambas decisiones de OWNER/ADMIN.
Leer no exige permiso: basta con ser miembro activo (ANALYST y SUPPORT necesitan ver para trabajar).

**Aislamiento verificado por mutación, no solo por prueba verde**: además de extender la suite
transversal con el ataque de `siteId` cruzado (organizationId propio + siteId ajeno → 404), se
quitó a propósito el filtro por organización de `getSiteOrThrow` y se comprobó que la prueba
falla (devolvía 200 en vez de 404). Una prueba de aislamiento que pasa aunque la protección no
exista no prueba nada.

## Páginas: CRUD, orden, visibilidad y borrado lógico (F2.3)

`apps/api/src/modules/pages/` — endpoints bajo
`/organizations/:organizationId/sites/:siteId/pages`.

**La home se crea sola, con el sitio, en la misma transacción.** No hay endpoint para crear *la*
home precisamente porque siempre debe existir: un sitio sin página de inicio no es un estado del
que el usuario pueda salir por su cuenta. No se puede eliminar ni renombrar (su slug no aparece en
la URL pública: la home se sirve en la raíz del sitio), pero sí cambiarle la visibilidad.

**Borrado lógico, no físico.** Borrar una página conserva la fila y todo su historial de versiones
— destruir trabajo del usuario desde un CRUD va contra CLAUDE.md; la purga definitiva es una
operación aparte y explícita. Esto obligó a una decisión de esquema: el índice único de
`(site_id, slug)` pasó a ser **parcial** (`WHERE deleted_at IS NULL`), creado con SQL a mano en la
migración porque Prisma no sabe expresarlo. Sin el `WHERE`, una página borrada seguiría reservando
su nombre para siempre y el usuario nunca podría reutilizarlo. Restaurar existe, y devuelve 409
con un mensaje útil si otra página ocupó el slug mientras tanto.

**Reordenar recibe el orden completo**, no "movete a la posición 3": así el resultado no depende
del orden de llegada de varias peticiones, no quedan huecos, y se puede exigir de una sola vez que
la lista sea exactamente el conjunto de páginas vivas del sitio — se rechaza si viene incompleta,
con repetidos o con una página de otro sitio.

**Visibilidad y publicación son ejes independientes**: una página puede estar publicada pero oculta
del menú (alcanzable por enlace directo) o visible pero aún en borrador.

**El slug de página NO usa la lista de reservados del slug de sitio.** Las pruebas encontraron este
error: `contacto` estaba reservado, así que la página más común que va a crear cualquier usuario
era imposible. La lista protege el espacio de nombres de *la plataforma*, que está un nivel más
arriba; dentro de su propio sitio el usuario debe poder llamar a sus páginas `contacto`, `blog` o
`soporte`. Quedaron `publicSlugSchema` (sitios: formato + reservados) y `pageSlugSchema` (páginas:
solo formato), con una prueba de regresión que fija la diferencia.

**Sobre las pruebas de aislamiento por mutación**: la primera versión del ataque de `pageId`
cruzado *pasaba igual* con la verificación de organización quitada — usaba el `siteId` propio, así
que el filtro por sitio ya lo bloqueaba y la comprobación real nunca se ejercía. Se agregó el caso
combinado (organizationId propio + sitio **y** página ajenos, coherentes entre sí), que es el único
que obliga a validar la cadena completa organización → sitio → página; verificado que pasa con el
código correcto y falla con 200 al quitar la protección.

## Bloques tipados (F2.4)

Los 15 bloques del MVP (ST §9) viven en `packages/validation/src/blocks/`. **Un bloque no es
HTML**: es un `type` del catálogo con una configuración validada por su propio esquema Zod. No
existe ninguna vía por la que el usuario meta marcado o scripts propios (ST §22) — el único camino
para persistir una configuración pasa por validarla contra el esquema del tipo y sanitizarla.

El catálogo quedó en `packages/validation` y **no** en `packages/database` como decía la nota
original de F2.1 (ya corregida en el esquema): el constructor de F2.9 necesita los mismos esquemas
en el cliente, y `validation` es isomorfo mientras que `database` no.

**Defensas concretas:**

- **URLs**: solo `http`/`https`. Se rechazan `javascript:`, `data:`, `vbscript:`, `file:` y las
  rutas relativas — un `href` es un enlace, no una vía de ejecución.
- **Video**: no se guarda una URL de iframe. Se guarda `{provider, videoId}` con proveedor de una
  lista blanca (YouTube, Vimeo) y el render arma el `src` desde una plantilla fija. Aunque alguien
  escribiera directo en la base, no puede apuntar un iframe a un dominio arbitrario.
- **Texto enriquecido**: se sanitiza **en el servidor, antes de persistir** (no al renderizar), con
  una lista blanca corta de etiquetas y atributos. Se fuerza `rel="noopener noreferrer nofollow"`
  en todos los enlaces, sin confiar en lo que mande el editor.
- **Degradación controlada**: `parseStoredBlock` distingue `unknown_type`, `future_version` e
  `invalid_config`. Un bloque escrito por una versión futura, o con configuración corrupta, se
  marca como degradado y se omite — nunca rompe la página entera.

**Dos guardias que hacen imposible un olvido peligroso:**

1. *Campo de HTML sin sanitizar*: el sanitizador está dirigido por datos — cada entrada del
   catálogo declara sus `richTextPaths` y no hay código por tipo que alguien pueda olvidar
   escribir. Y la declaración no se cree por su palabra: una prueba **recorre el esquema Zod real**
   (los campos de texto enriquecido van marcados con `.describe()`) y compara lo encontrado con lo
   declarado, en ambos sentidos. Agregar un campo de HTML sin declararlo rompe el build; verificado
   introduciendo uno a propósito.
2. *Esquema que no acepta su propia salida*: el mismo esquema valida la entrada del usuario y
   relee lo guardado, así que un tipo que transforme la forma del dato y no acepte el resultado
   dejaría **todos** sus bloques marcados como inválidos al renderizar. Hay una prueba de ida y
   vuelta para los 15 tipos. Encontró exactamente ese bug en el bloque de video (entraba una URL,
   se guardaba un objeto, y al releerlo fallaba); el esquema pasó a ser una unión idempotente.

**Versionado**: la configuración vive en `BlockVersion` (ERD §3), no en una columna del bloque.
Cada guardado crea una versión nueva en vez de pisar la anterior; cambiar solo la visibilidad no
genera versión. Duplicar copia la configuración vigente y se inserta justo debajo del original.

**Por qué eliminar un bloque sí borra de verdad** (a diferencia de una página, F2.3): un bloque
suelto no es trabajo que el usuario espere rescatar de una papelera, y el historial de la página
(F2.6) conserva igual el estado anterior completo — la vía de recuperación existe y es restaurar
una versión de la página.

## Temas y apariencia (F2.5)

Un tema es un conjunto **cerrado** de tokens —paleta de 7 colores, familia tipográfica, radio,
densidad, sombra y estilo de botón— en `packages/validation/src/themes/`. El usuario elige valores
de un conjunto validado en el servidor: los colores son hexadecimales de 6 dígitos y todo lo demás
son enumeraciones. **Nunca CSS libre.** Un hex es un dato, no una regla de estilo: no puede cerrar
una declaración e inyectar otra, que es justo el riesgo de aceptar CSS.

Las escalas están recortadas por la dirección visual obligatoria de `CLAUDE.md`, no por gusto: no
existe un radio "pill" ni una sombra pesada, porque "bordes moderados, sombras discretas, nada
excesivamente redondo" no es una sugerencia que el usuario pueda desactivar.

**El contraste se verifica en el servidor, al guardar.** `themeTokensSchema` comprueba cada par
texto/fondo contra WCAG 2.2 AA (4.5:1) y el color primario contra 3:1 como componente de interfaz.
El objetivo de accesibilidad del proyecto no puede depender de que el cliente haya corrido la misma
comprobación: un tema ilegible guardado es una página pública rota. `border` queda fuera a
propósito — WCAG 1.4.11 exige 3:1 a los límites *esenciales* de un componente, no a un separador
decorativo, y exigírselo obligaría a bordes pesados que contradicen la dirección visual.

La calculadora de contraste se movió de `packages/ui` a `packages/validation`: estaba duplicada, y
ahora el mismo verificador audita los tokens del design system, los cinco temas del catálogo y los
temas propios que crea un usuario — un solo lugar donde puede estar mal.

**Catálogo base** (`claro-profesional`, `editorial`, `natural`, `oceano`, `carbon`): temas globales
(`organization_id` null) sembrados de forma idempotente por `code` desde `prisma/seed.ts`. Cada
paleta se eligió calculando el contraste, no a ojo, y una prueba vuelve a exigir AA sobre el
catálogo completo — aflojar un color rompe el build. Son de solo lectura: para personalizar uno se
duplica, que es el único camino y por eso existe el endpoint.

**Permisos, deliberadamente separados** (RBAC de F1.6): crear y editar temas necesita
`theme.manage` (OWNER/ADMIN); *aplicar* un tema a un sitio es configuración del sitio y usa
`site.update`, así que un EDITOR puede cambiar de apariencia sin poder inventar paletas nuevas.

**Un tema aplicado no se borra.** `Site.theme_id` tiene `onDelete: SetNull`, así que borrarlo
dejaría los sitios afectados cambiando de apariencia en silencio; el servicio responde 409 hasta
que esos sitios cambien de tema. Y un sitio sin tema elegido no queda "sin apariencia": el tema
efectivo cae al del catálogo por defecto, resuelto en el servidor para que el render público (F2.7)
y el constructor den la misma respuesta.

Aislamiento: solo son visibles el catálogo global y los temas de la propia organización. El tema de
otra organización devuelve 404 —no 403— por id cruzado, y no se puede aplicar a un sitio propio;
cubierto tanto en `themes.e2e.test.ts` como en la suite transversal de F1.9.

## Borrador, publicación e historial (F2.6)

**Editar nunca es publicar.** Una página y sus bloques viven siempre como borrador en las tablas de
siempre (`Page`, `Block`, `BlockVersion`); lo que ve el público es un objeto completamente aparte —
un snapshot inmutable en `PageVersion.content_snapshot` — que solo cambia al llamar a
`POST .../pages/:pageId/publish`. El render público (F2.7) leerá ese snapshot, no el estado vivo:
así un borrador a medio editar, o un bloque a medio configurar, nunca es alcanzable públicamente,
ni por casualidad ni por una carrera entre guardar y renderizar.

**Publicar arma el snapshot con el contenido vivo actual** — los campos de la página que afectan al
render (`slug`, `visibility`, `seoMeta`) más la lista ordenada de bloques con la configuración de su
versión vigente — y marca la página `PUBLISHED`. La forma exacta del snapshot
(`apps/api/src/modules/pages/page-content-snapshot.ts`) es un detalle de almacenamiento interno, no
un contrato de `@impulza/contracts`: el cliente nunca construye ni envía uno, solo edita por los
endpoints normales.

**Publicar es idempotente.** Si el contenido no cambió desde la última versión, no se crea una fila
nueva ni una entrada de auditoría — se devuelve la última versión tal cual. La comparación es por
contenido, no por identidad de objeto ni por orden de claves (JSONB de Postgres no preserva el
orden en el que se insertaron): ambos lados se canonicalizan (claves ordenadas recursivamente) antes
de comparar. Sin esto, dejar la pestaña de publicar abierta y hacer clic varias veces llenaría el
historial de versiones idénticas entre sí — justo lo que el criterio de aceptación prohíbe.

**El historial es navegable y nunca se reescribe.** `GET .../versions` lista de la más reciente a
la más antigua, con autor y fecha, deliberadamente sin el snapshot completo (una página puede
acumular decenas de versiones y cada una incluye la configuración de todos sus bloques — cargarlo
en la lista haría pesado justo el endpoint que un panel de historial pide primero).
`GET .../versions/:versionId` sí trae el snapshot completo, para previsualizar antes de restaurar.

**Restaurar reemplaza el contenido vivo por el de una versión anterior y agrega una versión
nueva** — nunca reescribe ni borra una fila existente. A diferencia de publicar, restaurar **no**
es idempotente: la propia decisión de "volver a esta versión" es un evento que vale la pena dejar
registrado, incluso en el caso raro en que el contenido resultante coincida con el actual. Los
bloques vivos se reemplazan por completo (se borran y se recrean desde el snapshot, todo en una
transacción): mismo criterio que ya documentaba `BlocksService.deleteBlock` desde F2.4 — un bloque
individual no tiene papelera propia, la vía de recuperación es restaurar la versión de la página.
Si el slug de la versión restaurada choca con el de otra página del sitio (alguien lo tomó
mientras tanto), la restauración completa se revierte y responde 409, no un 500 a mitad de camino.

**Publicar y restaurar usan el mismo permiso que editar** (`page.manage`): en esta fase no hay un
flujo de aprobación separado (eso es Fase 6, PM §11.3); publicar es, todavía, parte del trabajo
editorial normal de quien ya puede crear y modificar páginas.

**Auditoría con actor real** en ambas acciones (`page.published`, `page.version_restored`,
distinto de `page.restored` que es el undelete de la papelera de F2.3 — son dos "restaurar"
completamente distintos y conviene no confundirlos). Cubierto en `pages.e2e.test.ts` y en la suite
transversal de aislamiento multi-tenant (F1.9): ninguna combinación de ids permite publicar, leer
el historial o restaurar una página de otra organización.

## Render público (F2.7)

**`apps/web` es el único proceso que sirve tráfico anónimo.** Resuelve `/[siteSlug]` y
`/[siteSlug]/[pageSlug]` contra `GET /public/sites/*` (`PublicSitesController`,
`apps/api/src/modules/public-sites/`) — la única familia de endpoints de la API sin sesión, sin
`organizationId` en la ruta y con su propio `RateLimitGuard` (120 peticiones/minuto por IP): es la
superficie alcanzable sin autenticarse, así que es la que primero necesita su propio límite. Un
sitio archivado, una página en la papelera o sin publicar, o un tipo de sitio/página inexistente
responden todos con el 404 propio de `apps/web` (`not-found.tsx`) — nunca una página en blanco ni
un error genérico; `error.tsx` cubre además la falla del propio proceso de render.

**Solo se sirve lo publicado.** `PublicSitesService` lee `PageVersion.content_snapshot` (F2.6), no
el estado vivo de la página, y dentro de ese snapshot filtra en servidor los bloques ocultos
(`visible: false`), los fuera de su ventana programada (`scheduledStart`/`scheduledEnd`) y los
degradados (tipo desconocido o versión de esquema futura) — lo que llega a `apps/web` ya es
exactamente lo que hay que pintar, en orden, sin que el renderer tenga que repetir esa lógica.

**La caché se invalida solo al publicar, nunca por tiempo.** Cada página se pide con
`cache: "force-cache"` bajo una etiqueta por sitio (`lib/api.ts`, `siteCacheTag`); al publicar o
restaurar una versión, `RevalidateWebService` (apps/api) llama a `POST /api/revalidate` en
`apps/web` con un secreto compartido comparado con `timingSafeEqual` (no `===`, para no filtrar por
tiempo cuánto del secreto coincide), y ese webhook invalida la etiqueta con `revalidateTag(...,
{ expire: 0 })`. El aviso es *best-effort*: si `apps/web` no responde, publicar igual sucede en
`apps/api` (queda un log de error, no una petición fallida) — el próximo `revalidate` manual o
redeploy la pone al día igual.

**Bloques tipados con degradación real, no solo en teoría** (`apps/web/components/blocks/`): cada
tipo del catálogo de F2.4 tiene su propio componente, el texto enriquecido se sanea otra vez en el
cliente (`lib/sanitize.ts`, defensa en profundidad — ya se saneó al guardar en F2.4) y las imágenes
pasan por `SiteImage`, que exige `alt` salvo que el bloque la marque `decorative` (WCAG 1.1.1).

Cubierto por `public-sites.e2e.test.ts` (14 casos: sitio archivado, tema propio vs. catálogo,
navegación solo con páginas `PUBLIC` publicadas, página oculta alcanzable por enlace directo, home
por el slug fijo `inicio`, papelera, borrador no visible hasta el siguiente publish, y los tres
casos de filtrado de bloques) y por la extensión de `multi-tenant-isolation.e2e.test.ts`.

**Deuda declarada** (ver `docs/BACKLOG_FASE_2.md`): el resto de la API autenticada (sitios,
páginas, bloques, temas, organizaciones) todavía no tiene límite de peticiones propio, solo exigir
sesión; y el `RedisModule` no cierra su socket en `onApplicationShutdown`, así que `app.close()` no
termina por sí solo. Ninguna de las dos bloquea F2.7: son tareas propias, ya con su alcance escrito.

## SEO base (F2.8)

**Título, descripción, canonical, robots y Open Graph, por página** (`Page.seoMeta`, esquema
cerrado en `@impulza/validation` — `seoMetaSchema`, nunca meta libre ni HTML: mismo criterio de
"conjunto validado en servidor" que temas y bloques). Todo opcional: sin nada propio, el render
público deriva valores por defecto reales del contenido de la página en vez de dejar un `<title>`
vacío (`resolveSeo`, `apps/api/src/modules/public-sites/seo-resolver.ts`) — el nombre de un bloque
de perfil o el título de un hero para el título, y el primer campo con contenido entre el subtítulo
del hero, la bajada o la bio del perfil, la descripción de un servicio o el primer bloque de texto
para la descripción (desnudando su HTML antes de truncar, nunca metiendo etiquetas en un `<meta>`).

**Canonical apunta a otra página del mismo sitio, nunca a una URL libre.** `seoMeta.canonicalPageSlug`
es un slug, no un link: `resolveSeo` lo resuelve a la ruta pública real de esa página, y si quedó
huérfano (la página destino se borró o se despublicó desde que se guardó) cae de vuelta al
canonical propio en silencio — un canonical roto sería peor que no tener override.

**`GET /public/sites/*` expone el SEO ya resuelto** (`seo`, `publicSeoResponse` en
`@impulza/contracts`), no el `seoMeta` crudo que escribió el usuario: cualquier cliente que consuma
la API pública recibe el mismo título/descripción/canonical/robots/Open Graph sin reimplementar la
derivación. `apps/web` lo traduce a `Metadata` de Next (`lib/seo-metadata.ts`) — `<title>`,
`<meta description>`, `<link rel="canonical">`, `<meta name="robots">` y `og:*`, todos escapados
por el propio motor de metadata de Next, nunca interpolados a mano en el HTML.

**`sitemap.xml` y `robots.txt`, por sitio** (`/:siteSlug/sitemap.xml`, `/:siteSlug/robots.txt`),
con solo páginas `PUBLIC` y publicadas — mismo filtro que ya usa la navegación del sitio (F2.7),
reutilizado en vez de duplicado — y `lastmod` real (cuándo se publicó la versión vigente de cada
página, no cuándo se editó el borrador). **Limitación real, documentada en el propio código**
(`app/[siteSlug]/robots.txt/route.ts`): el estándar (RFC 9309) solo hace que un crawler busque
`robots.txt` en la raíz del host, nunca en un subpath — mientras el hosting sea por path
(`impulza.one/mi-sitio`, sin dominio propio hasta que `SiteDomain`, modelada desde F2.1, tenga su
propio ruteo) esta ruta no es la que Google ni Bing descubren solos. Sirve igual para envío manual
a Search Console (que sí admite verificar un prefijo de URL) y queda lista para el día en que un
sitio tenga dominio propio. El control real de indexado por página, mientras tanto, es
`<meta name="robots">`, que un crawler sí respeta sin importar el path.

Cubierto por la suite `SEO (F2.8)` de `public-sites.e2e.test.ts` (derivación por defecto, override
explícito, canonical resuelto y huérfano, rechazo de un `robots` fuera del enum cerrado),
`seo-resolver.test.ts`, `seo.test.ts` (`@impulza/validation`) y las pruebas de
`apps/web/app/[siteSlug]/{sitemap.xml,robots.txt}/route.test.ts`.

## Gestión de sitios y páginas (F2.9, Etapa A)

**`apps/dashboard` no tenía ninguna UI de sitios/páginas/temas.** F2.2–F2.8 fueron enteramente API
— sin una pantalla para crear un sitio o abrir una página, el editor de bloques de F2.9 (el
"constructor visual" en sí) sería inalcanzable. Esta etapa agrega esa gestión, reusando 100% la API
ya existente y probada: nada de lógica de negocio nueva, solo pantallas.

**`/sitios`**: listar/crear/archivar sitios de la organización activa. **`/sitios/:siteId`**:
renombrar/cambiar slug, elegir tema (grid de tarjetas con los colores reales de cada tema del
catálogo — `themeTokensToCssVariables`, la misma función que ya usa el render público, F2.7), y la
lista de páginas del sitio (crear, reordenar con subir/bajar, ocultar/mostrar, enviar a la
papelera). **`/sitios/:siteId/paginas/:pageId`**: renombrar (bloqueado en la home), visibilidad,
formulario de SEO completo (título, descripción, canonical como selector de páginas del sitio —
nunca texto libre, robots, Open Graph — F2.8), publicar, e historial de versiones con restaurar.

**Sin diálogos nativos.** Las acciones destructivas (archivar, enviar a la papelera, restaurar una
versión) usan una confirmación en la propia pantalla (`components/confirm-button.tsx`) en vez de
`window.confirm()`: un diálogo nativo bloquea todo el hilo de render del navegador hasta que
alguien lo cierra a mano — se detectó probando esta misma etapa, cuando bloqueó la pestaña de
pruebas entera. Borrar una página deja un aviso con **Deshacer** inmediato (F2.3 no tiene un
endpoint para *listar* la papelera — solo para restaurar por id — así que "deshacer" es la única
vía real hasta que exista esa pantalla).

**Bug real encontrado y corregido en el camino, no solo en esta etapa:** `Button asChild` de
`packages/ui` rompía (`Slot failed to slot onto its children`) porque el spinner de carga del botón
le agrega un segundo hijo incluso sin estar cargando — el primer uso real de `asChild` en el repo
fue el que lo destapó. Corregido con `Slottable` de Radix (ver el comentario en
`packages/ui/src/components/Button.tsx`); cualquier otro consumidor futuro de `asChild` ya queda
cubierto.

**Pruebas**: se verificó a mano en el navegador el flujo completo (crear sitio → tema → crear
página → reordenar → ocultar/mostrar → SEO → publicar → historial → restaurar → ver el resultado en
`apps/web`) contra la API real, siguiendo el mismo criterio de testing que ya usa el resto del
frontend (lógica pura con Vitest, UI verificada en el navegador — no hay React Testing Library en
el repo).

## Editor de bloques (F2.9, Etapa B1 y B2 parcial)

`/sitios/:siteId/paginas/:pageId/editor` — el lienzo del constructor: biblioteca de bloques,
lienzo con arrastrar/soltar (`dnd-kit`) para reordenar, duplicar, ocultar y eliminar, panel de
configuración del bloque seleccionado con guardado automático, y vista previa protagonista
(móvil/tablet/escritorio) con el mismo componente que usa el render público.

**Motor de campos, no un formulario por tipo (`apps/dashboard/lib/block-fields`):** un
`BlockFieldSet` declarativo por tipo (`catalog.ts`) describe qué control pintar por campo — texto,
enriquecido, número, booleano, selector, selección múltiple fija (`contact_form.fields`), video
(YouTube/Vimeo), imagen, grupo anidado (`cta`) o arreglo repetible (`social.links`, `faq.items`,
`testimonials.items`) — y `field-renderer.tsx` lo interpreta de forma recursiva con
`react-hook-form`. Los 15 tipos del catálogo tienen panel de edición.

La validación real sigue siendo el mismo schema Zod del catálogo (`@impulza/validation`,
`BLOCK_CATALOG[type].schema`) — el motor de campos nunca decide qué es válido, solo qué input
mostrar —, pero conectada con un resolver a medida (`resolver.ts`) en vez de `zodResolver` directo:
el schema valida la forma **normalizada** (`undefined` en lo opcional vacío, no `""` ni un objeto
de imagen sin URL, que es lo que el formulario tiene siempre), así que normaliza primero
(`normalize.ts`, recursivo — también dentro de cada `group` y de cada ítem de un `array`, no solo
al nivel del bloque) y solo entonces valida. Cuando algo no pasa, el motivo real aparece junto al
campo (`formState.errors`) en vez de quedarse sin guardar en silencio. `toFormConfig`
(`to-form-value.ts`) hace el camino inverso al cargar un bloque guardado — necesario en particular
para `video`, que el servidor guarda como `{provider, videoId}` pero se edita como una URL de
texto de ida y vuelta.

**Bloques compartidos entre el editor y el render público (`packages/blocks-renderer`, nuevo):**
los 15 componentes de bloque que antes vivían en `apps/web/components/blocks` se movieron a este
paquete junto con el saneo de texto enriquecido (F2.4) y `PageBlocks` — tanto la vista previa del
constructor como `apps/web` (F2.7) importan el mismo `PageBlocks`, así que lo que se ve al editar
es exactamente lo que vería un visitante si se publicara en ese momento, nunca una aproximación
aparte que se pueda desalinear.

**Guardado automático con estado visible, no un botón "guardar":** cada campo dispara un
autoguardado con debounce (800 ms) contra `PATCH .../blocks/:blockId`, con un indicador de estado
("Guardando…", "Guardado", o un error explícito con botón "Reintentar" — nunca se pierde trabajo en
silencio). **Publicar** vive directamente en el encabezado del constructor (junto a
deshacer/rehacer), con el estado actual de la página ("Publicada" / "Borrador — nunca publicada")
siempre visible — la distinción "guardado" (por bloque, automático) vs. "publicado" (de toda la
página, un clic explícito) que pide el criterio de aceptación de F2.9 se ve en la misma pantalla,
sin tener que volver a la pantalla de la página (F2.6) para publicar; esa pantalla sigue siendo el
lugar para el historial de versiones y el SEO, que el constructor no duplica.

**Bugs reales encontrados y corregidos en el camino, no solo en el incremento donde se escribieron
originalmente:**
- `BLOCK_FIELD_SETS.link`/`.image` sembraban `url: "https://"` como configuración inicial —
  `new URL("https://")` lanza (sin *host*), así que `safeUrlSchema` la rechaza y agregar cualquiera
  de esos dos bloques desde la biblioteca fallaba silenciosamente (la mutación de creación no tenía
  manejo de error en la UI). Corregido el placeholder a `https://ejemplo.com` y agregado el
  indicador de error que faltaba en el panel.
- Los sub-campos opcionales dentro de un `group` o de cada ítem de un `array` (p. ej. `role` en
  `testimonials.items`) nunca se omitían al normalizar aunque estuvieran vacíos — `normalize.ts` no
  aplicaba la regla de "opcional vacío → omitir" más que al nivel superior del bloque. Corregido
  compartiendo la misma función de normalización en los tres niveles.
- Un `<select>` requerido sin opción en blanco muestra visualmente su primera opción aunque el
  formulario todavía no la haya elegido — agregar un ítem nuevo a un `array` (p. ej. "Agregar red"
  en `social.links`) dejaba el campo en `""` por dentro, lo que disparaba un error de validación
  confuso apenas se agregaba el ítem, antes de que el usuario tocara nada. Corregido: el valor
  inicial de un `select` requerido es su primera opción, no una cadena vacía.
- Un import de valor (no de tipo) con extensión `.js` explícita (`from "./normalize.js"`) pasa
  `tsc --noEmit` sin problema (NodeNext lo resuelve) pero rompe `next build`/`next dev` con
  Turbopack ("Module not found") — un import de tipo con la misma extensión sí resuelve porque se
  borra antes de que el bundler lo vea. Descubierto porque el `build` real falló después de que el
  `typecheck` había pasado limpio; confirma por qué `next build` es obligatorio y no alcanza con
  `tsc`.

**Verificado a mano en el navegador** (no hay React Testing Library en el repo — mismo criterio de
testing que el resto del frontend), incluyendo los 15 tipos del catálogo: agregar cada bloque desde
la biblioteca, seleccionarlo, editar sus campos (incluidos los menos comunes — arreglo con select
como `social`, grupo opcional como `hero.cta` en sus tres estados vacío/parcial/completo, arreglo de
imágenes planas en `gallery`, texto enriquecido dentro de un arreglo en `faq`, selección múltiple en
`contact_form`, número en `service`, y el video con su ida y vuelta URL↔`{provider,videoId}`), ver
el autoguardado + la vista previa actualizarse en vivo, ocultar/mostrar, duplicar, eliminar con
confirmación en pantalla, reordenar arrastrando y confirmar que el nuevo orden persiste tras
recargar, y cambiar el dispositivo de la vista previa — todo contra la API real
(`docker compose up -d` + Postgres/Redis locales).

**Deshacer/rehacer (`use-block-history.ts`), acotado a propósito a bloques que ya existen** —
editar un campo, ocultar/mostrar, reordenar. **Agregar/eliminar/duplicar un bloque limpia el
historial en vez de entrar en él**: el id de un bloque lo asigna el servidor al crearlo, así que
"rehacer un agregado" no puede recrear el mismo id, y cualquier cambio posterior del historial que
siguiera apuntando a ese id quedaría roto (ej.: agregar un bloque, editarlo, deshacer dos veces,
rehacer dos veces — el segundo rehacer intentaría reconstruir el mismo id que el primero acaba de
inventar de nuevo, distinto del original). No es un recorte de pereza: es la frontera real hasta
donde un historial de comandos con ids del servidor puede ser correcto sin una capa aparte de
identidad estable del lado del cliente — construir esa capa es trabajo aparte, no de esta pasada.
Los autoguardados sucesivos de una misma sesión de edición (tipear en el mismo campo) se
**fusionan en una sola entrada** del historial en vez de apilar un paso por tecleo, y deshacer
sincroniza el formulario en vivo aunque el bloque siga seleccionado. Botones visibles junto al
título (no solo atajo de teclado) — `Ctrl/Cmd+Z` y `Ctrl/Cmd+Shift+Z`, que se desactivan solos con
el foco en un campo de texto o el editor de texto enriquecido para no pisar su propio deshacer
nativo. Verificado a mano en el navegador: editar y deshacer con el bloque todavía abierto (el
caso que de verdad importa), ocultar/mostrar, reordenar, atajo de teclado, y que agregar un bloque
limpia el historial — contra la API real, revisando el log del servidor para confirmar que cada
paso dispara exactamente una petición, ninguna de más.

**Otro bug real encontrado y corregido en el camino:** llamar `reset()` de `react-hook-form` para
sincronizar el formulario con un cambio externo (deshacer/rehacer) también dispara su propio
`watch()` — el mismo que maneja el autoguardado —, así que deshacer terminaba reenviando al
servidor el valor que acababa de llegar de él. Sin guardarlo, era una vuelta redundante; en el peor
caso, una carrera con el propio `reset()`. Corregido filtrando el `watch()` para que solo autoguarde
en un evento `"change"` real (una tecla, no un `reset()` programático) — la forma en que
`react-hook-form` distingue una interacción real del usuario de una sincronización que vino de
otro lado.

Con esto, los criterios de aceptación escritos de F2.9 están cubiertos: biblioteca + configuración
+ vista previa protagonista, arrastrar/soltar y agregar/editar/duplicar/ocultar/eliminar, deshacer
y rehacer, guardado automático con estado y manejo explícito del fallo, publicar con la distinción
clara "guardado" vs. "publicado", estados de carga/vacío/error/éxito, y ninguna validación de
negocio confiada al frontend (todo pasa igual por el mismo schema del catálogo en el servidor).

**Mensajes de validación en español (resuelto):** los errores que Zod genera por defecto (largo
mínimo, opción inválida, tipo equivocado — no los que `@impulza/validation` escribe a mano con
`.superRefine`) salían en inglés y se mezclaban con una interfaz que es español de punta a punta.
Resuelto con `z.config(es())` como efecto de módulo en `packages/validation/src/index.ts`: alcanza
con importar el paquete, así que cubre de una sola vez la API, el dashboard y `apps/web` sin
repetir configuración por app. Como es un efecto global que nada exporta, `src/locale.test.ts` lo
fija: nada más que una prueba puede detectar que alguien lo borre o que un consumidor termine
resolviendo otra copia de Zod.

**Responsive real (resuelto, y con un defecto real encontrado en el camino):** el criterio pedía que
el panel del constructor funcione en un teléfono, no solo el simulador de dispositivo de la vista
previa (que solo cambia el ancho de un iframe y no dice nada sobre el panel en sí). No había con
qué verificarlo, así que se agregó Playwright (ADR-003, ver §"Pruebas de extremo a extremo"). La
primera corrida en un viewport de 412px encontró lo que leyendo el código no se veía: el alto fijo
(`h-[calc(100vh-8rem)]`) y el recorte (`overflow-hidden`) que necesita el layout de tres columnas se
aplicaban igual en una sola columna, así que biblioteca, lienzo y configuración quedaban apilados en
franjas de ~200px, **cada una con su propio scroll interno** — 533px de biblioteca escondidos y el
panel de configuración en 61px con un bloque abierto, con el texto cortado a la mitad. Corregido
acotando el alto fijo y el recorte a `lg`: abajo de ese punto la página fluye y scrollea una sola
vez, cada panel toma su alto natural y nada queda cortado. El encabezado además envuelve en vez de
apretarse. De paso, las tres zonas pasaron a ser `<section>` con nombre accesible (`aria-label`), lo
que las vuelve puntos de referencia reales para un lector de pantalla y da a las pruebas un
selector que no depende del estilo.

Fuera de los criterios de aceptación (no exigido, pendiente aparte): sin UI para
`scheduledStart`/`scheduledEnd` (el campo existe en la API desde F2.4).

## Pruebas de extremo a extremo (`packages/e2e`)

Playwright sobre un navegador real y la **API real** (Postgres y Redis de verdad, igual que las
pruebas de integración de `apps/api` — sin mocks de servidor). Ver `docs/decisions/ADR-003-playwright-e2e.md`
para por qué se agregó y qué alternativas se descartaron.

```bash
docker compose up -d                 # Postgres + Redis
pnpm --filter @impulza/e2e exec playwright install chromium   # una sola vez por máquina
pnpm test:e2e
```

Playwright levanta la API y el dashboard por su cuenta (`webServer`) y reutiliza los que ya estén
corriendo. El arnés (`global-setup.ts`) registra un usuario nuevo por corrida contra la API real,
crea su organización, sitio, página de inicio y unos bloques, y deja la sesión lista para el
navegador. El único atajo es marcar el correo como verificado directo en la base: lo que estas
pruebas miden es el constructor, no el flujo de alta — ese ya tiene su propia cobertura e2e en
`apps/api`, y repetirlo acá solo agregaría una forma más de fallar por un motivo ajeno.

Dos proyectos, `movil` (Pixel 7, 412px) y `escritorio` (1440px), sobre el mismo archivo: el punto es
contrastar los dos extremos. Las pruebas afirman **propiedades del layout** — que nada se desborde
horizontalmente, que los controles del encabezado queden dentro de la pantalla, que en una sola
columna ningún panel scrollee por dentro, que se pueda tocar un bloque y llegar a sus campos — nunca
comparan capturas pixel a pixel, que se romperían con cualquier cambio legítimo de diseño.

**Las pruebas se verificaron contra el código roto, no solo contra el corregido**: se revirtieron
temporalmente las clases del layout anterior y se confirmó que fallan con el defecto real
(533px de scroll oculto, panel de configuración en 61px). Una prueba que nunca se vio fallar no
prueba nada. Medir solo alturas no habría alcanzado — ~200px "parece" razonable; lo que delata el
defecto es el scroll anidado.

`pnpm test:e2e` va aparte de `pnpm test` a propósito: necesita servidores levantados y es de otro
orden de duración. En CI tiene su propio job con Postgres, Redis y Chromium.

## Aislamiento multi-tenant de Fase 2 (F2.10)

`apps/api/src/multi-tenant-isolation.e2e.test.ts` — la misma suite transversal de F1.9, extendida
incrementalmente al cerrar cada historia de esta fase en vez de dejarla para el final: sitios
(F2.2), páginas (F2.3), bloques (F2.4), temas (F2.5), publicación e historial (F2.6) y render
público (F2.7). Dos organizaciones reales (A y B), cada endpoint nuevo probado con el mismo patrón
— organización de A con permiso real de verdad + recurso de B, por cada combinación de ids que un
guard superficial podría dejar pasar sin querer: con la organización de B en la URL (rechazado por
el guard de membresía) y, el caso que de verdad importa, con la organización **propia** de A pero
un sitio/página/bloque/tema/versión de B (rechazado por la verificación de dueño real dentro del
servicio — `getXOrThrow`, no el guard). Incluye ataques combinados (organización propia + sitio Y
página ajenos a la vez, donde filtrar solo por uno de los dos no alcanza) y que el recurso de B
queda intacto después de cada intento.

**Hueco real encontrado al revisar para cerrar esta historia:** se verificaba que el **sitio**
público no expusiera ids internos (`id`, `organizationId`, ningún string de ningún id de
organización en el JSON), pero no lo mismo para la **página** pública — el contrato
(`publicPageResponse`) ya es mínimo por diseño (F2.7), pero nada probaba en runtime que el
controlador no agregara algo de más. Se agregó esa prueba: mismo criterio que el sitio, más que
cada bloque de la respuesta pública solo tenga `{type, config}` — nunca un id de bloque. 31/31
verificado aislado (`pnpm --filter @impulza/api exec vitest run src/multi-tenant-isolation.e2e.test.ts`).

## Modelo de datos de conversión (F3.1)

Primera historia de Fase 3 (ver `docs/BACKLOG_FASE_3.md`). Agrega al esquema las entidades de
`ERD.md` §5/§6/§7: `Form`, `FormField`, `FormSubmission`, `Contact`, `ContactEvent`, `ShortLink`,
`QrCode`, `AnalyticsEvent` y `AnalyticsAggregate`, más cuatro permisos nuevos (`form.manage`,
`contact.manage`, `contact.delete`, `shortlink.manage`) en `packages/database/src/permissions.ts`.
Decisiones que no se leen solas en el esquema:

- **Privacidad y retención por diseño**: `docs/decisions/ADR-004-privacidad-retencion-datos.md`
  resuelve la decisión pendiente #10 de la traceability anticipando la Ley 21.719 (Chile, vigente
  desde diciembre de 2026). Por eso `AnalyticsEvent` no tiene columna de IP cruda,
  `anonymized_visitor_id` está pensado como hash con sal rotada por sitio/día (se deriva en F3.6,
  no se persiste la sal acá), y `Contact` guarda consentimiento auditado
  (`consent_status`/`consent_source`/`consent_text_version`/`consent_at`) en vez de un campo
  genérico.
- **`FormField.type` incluye `CONSENT` como tipo propio**: para que el servidor pueda detectar en
  F3.2 si un formulario puede crear un `Contact` con seguimiento sin adivinar por el texto de la
  etiqueta — es la pieza que hace cumplible el punto 3 de ADR-004.
- **Borrado real (no lógico) de `Contact`**: a diferencia de `Page` (F2.3, borrado lógico), un
  `Contact` se borra en cascada de verdad (`ContactEvent`/`FormSubmission` incluidos) porque el
  derecho de cancelación/ARCO+ (ADR-004 punto 5) exige que el dato desaparezca, no que se oculte.
- **`ShortLink.slug` vive en su propio espacio de rutas** (`/s/:slug`), separado de `Site.slug` en
  la raíz — para que un enlace corto nunca compita por nombre con un sitio. Aclarado en `ERD.md`
  §6 al implementar.
- **`AnalyticsAggregate.siteId` es obligatorio**, a diferencia de `AnalyticsEvent.siteId` (nullable
  en el ERD): cada agregado está pre-calculado por sitio; un rollup de organización se suma en la
  consulta del dashboard (F3.7), no se persiste aparte. Aclarado en `ERD.md` §7.
- **Defecto real encontrado por el test, no por lectura de código**: `QrCode` exige por `CHECK`
  tener `shortLinkId` o `directUrl`, pero la primera versión de la relación con `ShortLink` usaba
  `SetNull` — al borrar un `ShortLink` con un `QrCode` que solo tenía esa referencia, Postgres
  intentaba dejar `shortLinkId` en null y violaba su propio `CHECK`. `packages/database/src/schema-
  conversion.test.ts` lo detectó antes de llegar a producción; se corrigió a `NoAction` (no
  `Restrict`): Postgres verifica `NO ACTION` al final del `statement`, así que borrar una
  organización completa (que en la misma sentencia cascada borra `ShortLink` y `QrCode`, cada uno
  por su propio `organization_id`) sigue funcionando, mientras que borrar un `ShortLink` suelto con
  un `QrCode` que depende solo de él queda bloqueado — no un huérfano silencioso.

`packages/database/src/schema-conversion.test.ts` prueba contra el Postgres real (9 casos): slug de
enlace corto único global, email de contacto único por organización (no entre organizaciones, y
null no colisiona con null), el `CHECK` de `QrCode`, el `NoAction` de arriba, borrado en cascada de
contacto → eventos/envíos, borrado en cascada de formulario → campos/envíos, unicidad del agregado
analítico por organización/sitio/período/métrica, unicidad de la clave de idempotencia (y que
varios eventos sin clave convivan), y borrado en cascada completo de una organización sin huérfanos.

**Migración verificada de ida y vuelta**: base desechable (`impulza_migcheck`), cadena completa
aplicada desde cero (`prisma migrate deploy`), los tres `down.sql` de esta historia ejecutados en
orden inverso, confirmado que solo quedan las 22 tablas de Fase 0/1/2, y la cadena de Fase 3
re-aplicada limpiando antes las filas de `_prisma_migrations` correspondientes (para que
`migrate deploy` las reprodujera de verdad en vez de darlas por ya aplicadas). Solo DDL aditivo
sobre la base de desarrollo real; ningún `DROP`/`DELETE`/`TRUNCATE` fuera de la base desechable.

Verificado: `pnpm --filter @impulza/database exec vitest run` (22/22, incluye F2.1), `build`/
`lint`/`typecheck` de `@impulza/database` limpios, `typecheck` de `@impulza/api` limpio (el cliente
de Prisma regenerado no rompe nada existente), `pnpm db:seed` sigue funcionando (13 permisos, 32
asignaciones rol-permiso).

## Formularios (F3.2)

Segunda historia de Fase 3: `Form`/`FormField` con CRUD (`apps/api/src/modules/forms`) y envío
público real (`apps/api/src/modules/public-forms`) — el primer módulo de Fase 3 con superficie
visible de punta a punta, verificado a mano en el navegador (no solo con tests): formulario creado
desde el panel del constructor, publicado, enviado desde el sitio público real, y confirmado en la
base de datos que quedó todo enlazado correctamente.

- **Antispam y validación real**: honeypot (`_hp`) que responde éxito sin persistir nada si viene
  con contenido, y el esquema de validación del envío se arma en el servidor a partir de los campos
  **reales** guardados del formulario (`buildFormSubmissionSchema`, `@impulza/validation`) — nunca
  se confía en lo que declare el cliente. Límite de tasa propio del envío (20/min por IP), más
  estricto que la lectura (120/min, mismo criterio que F2.7).
- **Consentimiento exactamente como fija ADR-004 punto 3**: un `FormField` de tipo `CONSENT`
  marcado en el envío crea o actualiza un `Contact` (matcheado por email dentro de la organización)
  y agrega su `ContactEvent` `FORM_SUBMISSION`; sin ese campo, o presente pero sin marcar, el envío
  solo deja el `FormSubmission` crudo — ningún seguimiento comercial sin consentimiento explícito.
  `ContactsService` (`apps/api/src/modules/contacts`) es el núcleo compartido con el mini-CRM que
  llega en F3.3, no una pieza de usar y tirar.
- **El bloque `contact_form` (F2.4) pasa de v1 a v2**: ya no declara campos propios — referencia un
  `formId` real. Una config `v1` guardada (`{title, fields, submitLabel, successMessage}`) sigue
  siendo válida: se lee como "sin formulario elegido" en vez de degradarse a `invalid_config`,
  porque el nuevo esquema solo exige `title` (opcional) y `formId` (con default `null`) — ver
  `packages/validation/src/blocks/catalog.ts`.
- **El navegador del visitante nunca llama a `apps/api` directamente**, ni para leer ni para
  enviar — mismo principio ya documentado en `apps/web/lib/env.ts` para el resto del render
  público. La definición del formulario se resuelve en el servidor (`apps/web/components/site-
  page.tsx`, `getPublicForm`) y se le pasa ya lista al bloque; el envío pasa por una ruta propia de
  `apps/web` (`app/api/forms/[siteSlug]/[formId]/submissions/route.ts`) que reenvía server-to-
  server con la cabecera CSRF que `apps/api` exige. El bloque (`packages/blocks-renderer/src/
  blocks/contact-form.tsx`) es el primer componente interactivo (`"use client"`) del paquete —
  todo el resto es presentacional puro.
- **La vista previa del constructor no reconstruye el formulario real**: `apps/dashboard` pasa
  `mode="preview"` a `PageBlocks` sin resolver los campos del formulario — el bloque muestra
  "formulario elegido, se verá real en el sitio publicado" en vez de datos live, para no escribir
  envíos de prueba en `Contact`/`FormSubmission` reales durante la edición. El selector de
  formulario en el panel de configuración (`ContactFormPicker.tsx`) sí es real: "elegir uno
  existente" o "crear formulario rápido" (nombre, correo, mensaje, consentimiento) — guarda con su
  propia llamada a `PATCH .../blocks/:blockId`, aparte del motor declarativo de campos de F2.9
  Etapa B1 (`normalizeBlockConfig` solo conoce los campos declarados en `BLOCK_FIELD_SETS`, y
  `formId` no es uno de ellos a propósito: no es un campo simple, depende de una lista que hay que
  pedirle a la API).

**Deudas declaradas** (no bloquean el cierre de la historia):

- Sin notificación al propietario del sitio ante un envío nuevo — no existe todavía un adaptador de
  email genérico para notificaciones de negocio (el de F1.4 es específico de autenticación).
- El límite de tasa del envío público cuenta por la IP del propio servidor de `apps/web` (la ruta
  proxy no reenvía la IP real del visitante) — mismo límite ya declarado como parcial en
  `docs/BACKLOG_FASE_2.md`, no una regresión nueva de esta historia.
- El panel del constructor no tiene todavía un editor visual campo por campo (agregar/quitar/
  reordenar/tipos/opciones) — solo "elegir existente" y "crear rápido con campos por defecto". Es
  una etapa siguiente, mismo criterio de F2.9 (Etapa A gestión, Etapa B editor real).
- Borrar un `Form` es real (no lógico) y se lleva sus `FormSubmission` — decisión explícita, no un
  descuido: un formulario no es "contenido" con historial propio como una `Page`.

Verificado: 13 tests nuevos (`forms.e2e.test.ts`, `public-forms.e2e.test.ts`) más una prueba nueva
de aislamiento multi-tenant en la suite central (32/32) — `pnpm --filter @impulza/api exec vitest
run`: 197/197. `lint`/`typecheck`/`build` de todo el monorepo (`turbo run lint|typecheck|build`)
limpios. Probado en el navegador de punta a punta: formulario creado y publicado desde
`apps/dashboard`, enviado desde `apps/web` real, y confirmado en Postgres que el `Contact` quedó
con `consent_status=GRANTED`, `consent_source=form:<formId>`, su `ContactEvent` y el
`FormSubmission` enlazado.

## Mini-CRM de contactos (F3.3)

Tercera historia de Fase 3: CRUD completo bajo `/organizations/:organizationId/contacts`
(`apps/api/src/modules/contacts`) — la primera pantalla nueva del panel construida ya con el
criterio de diseño real acordado (no mecánica primero, diseño después): usa
`Table`/`Card`/`EmptyState`/`LoadingState`/`ErrorState` de `packages/ui`, el mismo nivel que
`sitios/page.tsx` desde F2.9, no HTML crudo.

- **Alta manual con consentimiento honesto**: crear un contacto a mano (sin pasar por un
  formulario público) deja `consentStatus=UNKNOWN` — ADR-004 no permite declarar "otorgado" un
  consentimiento que nadie dio explícitamente. El matching automático desde envíos de formulario
  ya existía desde F3.2 (`ContactsService.findOrCreateFromSubmission`); F3.3 construye el CRUD
  completo encima del mismo núcleo compartido, sin duplicar esa lógica.
- **Portabilidad y cancelación reales (ADR-004 punto 5)**: `GET .../contacts/:id/export` devuelve
  la ficha completa con su línea de tiempo y queda auditado como acceso sensible
  (`contact.exported` en `AuditLog`) — el panel lo descarga como `.json` con un botón real, no una
  promesa de que "algún día se puede exportar". `DELETE .../contacts/:id` es borrado real en
  cascada (`ContactEvent`/`FormSubmission` vinculados) con el actor auditado — el mecanismo
  operable para atender una solicitud de cancelación, no una tarea manual de soporte.
- **Se agregó un componente `Select` nuevo a `packages/ui`** (no existía): ya hacían falta selects
  de verdad en dos lugares — los filtros de esta historia y el selector de formulario de F3.2
  (`ContactFormPicker.tsx`), que se corrigió en el mismo commit para dejar de usar un `<select>`
  sin estilo y pasar a `Card`/`Select`/`LoadingState`/`ErrorState` reales. Mismo patrón que
  `Input.tsx`: label accesible con `@radix-ui/react-label`, `aria-describedby`, estado de error.

**Deudas declaradas**: import de contactos por CSV no implementado (el criterio decía "import/
export"; el export quedó completo, el import es una tarea propia con su propio diseño de UX de
errores de fila por fila). "Notas/tareas" del criterio original quedó en solo notas
(`ContactEvent` tipo `NOTE`) — un sistema de tareas con fecha de vencimiento no está modelado en el
ERD y hubiera sido inventar estructura de más para esta historia.

Verificado: 8 tests nuevos (`contacts.e2e.test.ts`) más una prueba de aislamiento en la suite
central (33/33) — 206/206 en `@impulza/api`. `lint`/`typecheck`/`build` de todo el monorepo
limpios. Probado a mano en el navegador: filtros, ficha, notas y etiquetas funcionando sobre el
contacto real creado por el envío de formulario de F3.2 — incluida la búsqueda por etiqueta
inexistente mostrando el `EmptyState` correcto.

## Identidad de marca (paleta de color)

`packages/ui/src/styles/tokens.css` tenía un placeholder indigo neutro desde F1.1, documentado
explícitamente como temporal hasta que existiera una decisión de marca (PM §21 #1). El propietario
del producto la resolvió a nivel de color el 2026-09-23: verde azulado profundo (`#0f6f6b`) sobre
fondo blanco, con superficie/bordes/texto reajustados para cohesionar. Contraste WCAG 2.2 AA
verificado con el mismo calculador del repo (`packages/validation`, `contrast.test.ts` de
`packages/ui`): primario/blanco 5.99:1, texto/fondo 16.84:1, foco/fondo 5.99:1. Los temas del
catálogo de sitios públicos (`packages/validation/src/themes/catalog.ts`) son independientes de
este color — es la identidad propia de Impulza One como producto, no la de los sitios que arma
cada cliente.

## Clic a WhatsApp con analítica (F3.4)

Cuarta historia de Fase 3. El bloque WhatsApp ya generaba su enlace `wa.me` con número E.164 y
mensaje prellenado desde F2.4; esta historia agrega el registro del clic como el primer
`AnalyticsEvent` real del sistema.

- **Minimización desde el primer evento, no cuando llegue F3.6**: `AnalyticsService`
  (`apps/api/src/modules/analytics`) deriva el visitante anonimizado con
  `sha256(sal + día + siteId + ip + user-agent)` calculado en memoria — la IP cruda nunca toca una
  columna ni sobrevive la función que la lee (ADR-004 punto 1). La sal vive en `ANALYTICS_SALT_SECRET`
  (nueva variable de entorno, validada al iniciar como el resto — ver `.env.example`).
- **Endpoint público con allowlist corto**: `POST /public/sites/:siteSlug/events`
  (`apps/api/src/modules/public-analytics`) solo acepta `whatsapp_click` por ahora — el resto de
  los tipos de evento del ERD se generan del lado del servidor o llegan con F3.5/F3.6, no se abre
  el allowlist antes de tener el caso real.
- **El clic real nunca depende de la analítica**: `WhatsappBlock`
  (`packages/blocks-renderer/src/blocks/whatsapp.tsx`) pasó a ser el primer bloque interactivo del
  paquete además de `contact_form` — un `fetch(..., {keepalive:true})` en el propio `onClick` del
  `<a href="wa.me/...">`, sin `preventDefault` ni redirección por JavaScript (`LinkButton` ahora
  acepta un `onClick` opcional puramente de instrumentación). Pasa por la ruta propia de
  `apps/web` (`app/api/analytics/[siteSlug]/events/route.ts`), mismo principio de "el navegador
  nunca llama a `apps/api` directo" que F3.2. En la vista previa del constructor
  (`mode="preview"`) no se registra nada.
- El conteo visible en un dashboard de conversión es explícitamente criterio de F3.7, no de esta
  historia — acá el evento queda bien registrado y consultable en la base.

Verificado: 5 tests nuevos (`public-analytics.e2e.test.ts`) — 211/211 en `@impulza/api`.
`lint`/`typecheck`/`build` de `@impulza/api`, `@impulza/blocks-renderer`, `@impulza/web` y
`@impulza/dashboard` limpios. **Deuda declarada**: la verificación visual del clic real en el
navegador quedó pendiente por un límite de uso de la herramienta de navegador en la sesión — el
mecanismo está probado end-to-end a nivel de API y de build del cliente, no con un clic observado
a mano todavía.

## Negocio digital (Fase 5)

Detalle, criterios y bitácora en `docs/BACKLOG_FASE_5.md`. Nada se cobra dentro de Impulza
(decisión #6): servicios y productos pueden llevar un enlace de pago externo del propio negocio.

- **Reservas (F5.1–F5.4):** servicios, horario semanal, bloqueos y cálculo de horarios libres en el
  servidor según la zona horaria del sitio; reserva pública sin doble reserva (restricción de
  exclusión en la base); agenda en el panel; correo con `.ics` y enlace firmado para cancelar o
  reprogramar; recordatorio idempotente desde `apps/worker`.
- **Catálogo y pedidos (F5.5):** productos físicos, digitales y servicios con categorías y stock
  opcional; el pedido es una solicitud que el negocio gestiona a mano.
- **Campañas (F5.6):** solo a contactos con consentimiento de marketing (aparte del de gestión),
  envío por cola con límite por hora del plan y baja firmada que se respeta de inmediato.
- **Aislamiento y seguridad (F5.7):** cada endpoint de la fase tiene su caso en
  `apps/api/src/multi-tenant-isolation.e2e.test.ts`; los enlaces firmados (gestión de reserva y
  baja) no cruzan organizaciones ni sirven uno por el otro; las respuestas públicas traen solo lo
  del contrato, sin ids internos; y toda escritura pública tiene límite de tasa por IP (probado).

## Diferenciación (Fase 6)

Detalle, criterios y bitácora en `docs/BACKLOG_FASE_6.md`.

- **Salud de página (F6.1):** `evaluatePageHealth` (`packages/validation/src/health`) es una
  función pura que puntúa la página de 0 a 100 y devuelve hallazgos con código estable, severidad
  y bloque afectado (publicación, contenido, acción, SEO, accesibilidad, enlaces, peso). La API la
  calcula sobre el estado vivo real en `GET .../pages/:pageId/health`; el constructor muestra el
  puntaje en la cabecera y un diálogo con cada hallazgo y un botón para corregirlo. Los enlaces se
  revisan de forma estática: el servidor nunca pide URLs del usuario (SSRF).
- **Motor de IA (F6.2, ADR-010):** `packages/ai` habla con cualquier servidor compatible con OpenAI
  (un servidor propio con Ollama o vLLM, OpenAI, Gemini, Groq, OpenRouter…) y con Claude, con
  respaldo automático entre conexiones y toda salida validada con Zod. `AiService` en la API aplica
  la cuota mensual del plan (`aiRequestsPerMonth`) y un límite por usuario, y registra tokens y
  costo por intento sin guardar nunca el texto. Las conexiones se guardan cifradas en la base; sin
  ninguna configurada, el asistente responde "no disponible".
- **Conexiones de IA (F6.2b):** en la administración (`/ia`) el propietario agrega su servidor de
  modelos o proveedores, los prueba con un clic, elige qué conexión usa cada tarea (principal y
  respaldos) y ve el consumo del mes. El token no se vuelve a mostrar y todo queda auditado.
- **Asistente de textos (F6.3):** en el constructor, cada bloque con textos de venta tiene
  "Proponer textos" (hasta 3 versiones de título, subtítulo o texto de botón, con una indicación
  opcional de tono) y "Traducir" (6 idiomas, incluidos textos enriquecidos y textos alternativos); en
  la página, "Proponer con IA" sugiere título y descripción SEO con vista de buscador. **La IA propone,
  el usuario confirma:** se compara "Actual → Propuesta" y nada cambia hasta "Aplicar", que guarda el
  borrador por la edición normal (se deshace con Ctrl+Z y nunca publica; el SEO se carga en el
  formulario y se guarda aparte). El servidor valida cada propuesta contra el esquema del bloque,
  sanitiza el HTML traducido, trata el contenido de la página como datos (no instrucciones) y nunca
  toca URLs, teléfonos ni precios. Rutas `POST .../pages/:pageId/ai/{block-copy,translate,seo}` con
  `page.manage`; los botones solo aparecen si hay un modelo configurado para la tarea.
- **Lectura comercial con IA (F6.4):** en Analítica, con un sitio elegido, la tarjeta "Lectura con IA"
  explica qué dicen los números del período (7, 30 o 90 días) y propone hasta 3 acciones con su
  razón; si una acción corrige un hallazgo de la salud de página, lleva a corregirlo. El modelo
  recibe solo métricas agregadas y códigos de hallazgo (nunca contactos, ids ni eventos sueltos). La
  **muestra suficiente la decide el servidor** (50 visitantes en el período): sin ella, el modelo ni
  siquiera recibe el período anterior ni desgloses, y el panel muestra su propio aviso. La
  comparación con el período anterior respeta el historial de analítica del plan.
  `POST .../sites/:siteId/ai/insights` (cualquier miembro activo, como leer la analítica).
- **Pruebas A/B (F6.5, ADR-011):** desde el constructor, "Probar una variante" en un botón de acción
  (enlace, WhatsApp, reservas, tienda) o en el encabezado de perfil: B cambia solo texto o estilo,
  nunca adónde lleva. La mitad de los visitantes ve cada variante, siempre la misma: `apps/web` elige
  en el servidor (sin parpadeo) con el grupo de una cookie propia (número de 0 a 99, solo en páginas
  con prueba en curso), y la API cuenta visitas, clics y conversiones en la variante que calcula ella
  misma — el navegador nunca la declara. En `/sitios/:id/pruebas`, resultados por variante y un
  veredicto honesto: ganadora solo con ≥ 200 visitas por variante, ≥ 30 clics y p < 0,05. "Aplicar
  B" escribe el borrador del bloque y nunca publica. Límite `abTestsRunning` por plan.
- **Smart CTA (F6.6):** en la pantalla de la página, "Acción principal inteligente": hasta 5 reglas en
  orden (fuera del horario de atención, teléfono/tablet/computador, `utm_source`, `utm_campaign`, sin
  horas para reservar) que eligen qué botón de acción pasa a ser el principal. Gana la primera que se
  cumple; si ninguna, el de siempre. `apps/web` las evalúa en cada visita en el servidor (hora real en
  la zona del negocio, dispositivo, campaña de la URL) sin tocar la caché de la página; "¿quedan
  horas?" se consulta aparte con caché de un minuto y solo si una regla lo usa. Sin geolocalización.
  Rige en vivo, sin publicar. `GET|PUT .../pages/:pageId/smart-cta` y
  `GET /public/sites/:slug/booking/available` (solo sí/no).
- **Automatizaciones (F6.7):** en `/automatizaciones`, reglas "cuando → entonces" de un catálogo
  cerrado: contacto nuevo, reserva creada o pedido → etiquetar al contacto, cambiar su estado
  comercial o avisar por correo a dueños y administradores. La API encola el evento (solo ids, y
  solo si hay reglas encendidas) después de confirmar lo ocurrido; el worker lo ejecuta **una vez
  por evento** (fila única por automatización y evento), reintenta solo lo que falló y deja cada
  ejecución en un registro visible (hecha, omitida con motivo, falló con motivo). Hasta 20 por
  organización; cada cambio auditado.

## Sitio comercial: portadas (ADR-014)

La home abre con un **corredor de fotos** de negocios reales (CSS 3D, pausable, quieto con
movimiento reducido) detrás del mensaje principal, y /plantillas con un **carrusel editorial** de un
rubro por plantilla real (arrastre, teclado y botones; sin atrapar el scroll). Componentes en
`apps/web/components/ui/`; fotos de Unsplash revisadas. Capturas en `docs/design/capturas/sitio-portadas/`.

## Sitio comercial: escena 3D del hero (ADR-009)

La portada de Impulza (`apps/web/app/page.tsx`) tiene una "constelación de enlaces" en 3D con
three.js, entre el mosaico de plantillas y el teléfono de ejemplo: tu enlace al centro, lo que
Impulza conecta alrededor y pulsos que viajan como visitas. Reglas (ADR-009, solo sitio comercial):

- `three` se carga con `import("three")` cuando el navegador está ocioso, en un archivo aparte (ESLint
  prohíbe el import estático en `apps/web`). Sin WebGL 2, con ahorro de datos o ante un fallo queda
  el fondo CSS de siempre.
- Movimiento reducido: un cuadro fijo. Botón para pausar/reanudar (WCAG 2.2.2). Se detiene fuera de
  pantalla y con la pestaña oculta; versión liviana en teléfonos y equipos modestos.
- Geometría, conexiones y calidad por dispositivo en `apps/web/lib/constellation.ts` (funciones puras,
  19 pruebas unitarias); el componente `components/marketing/hero-scene.tsx` solo dibuja.
- Playwright `sitio-comercial.spec.ts` (móvil y escritorio): three.js fuera del paquete inicial, la
  escena no tapa texto ni botones, cuadro fijo con movimiento reducido, pausa por teclado, y las
  tarjetas de plantilla sin enlaces anidados ni errores de hidratación.
- Corregido de paso (bugs previos de la portada y `/plantillas`): las tarjetas de plantilla anidaban
  un enlace dentro de otro (HTML inválido, error de hidratación), y `Reveal` hidrataba distinto con
  movimiento reducido.
- **Deuda detectada (2026-09-27):** `apps/web` no envía cabeceras de seguridad (ni
  `Content-Security-Policy`, ni `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` o
  HSTS; verificado con `curl -I`). `CLAUDE.md` las pide desde el primer commit: queda como historia
  pendiente, a hacer antes de F4.8 (producción).

## Planes, límites y uso (F4.1–F4.3)

Primeras historias de Fase 4. Cada organización tiene un plan efectivo que decide el servidor
(suscripción vigente → plan asignado por superadministración → Gratis), con límites aplicados en
cada alta y visibles en el panel.

- **Catálogo** (`packages/validation/src/plans`): Gratis, Profesional, Negocio y Agencia, precios
  mensual/anual en CLP y límites de sitios, páginas por sitio, formularios, contactos, enlaces, QR,
  miembros e historial de analítica. **Valores provisorios** hasta la decisión #4 del propietario.
- **Límites en el servidor**: dentro de la transacción que crea, con un lock que impide pasarse con
  altas simultáneas; 402 `PLAN_LIMIT_REACHED` con límite, uso y plan. Los contactos que llegan por
  formulario público nunca se pierden; bajar de plan no borra nada.
- **Panel**: `/plan` con medidores de uso y comparador; cada formulario de creación avisa el límite
  alcanzado con el camino a Planes. El cobro llega con F4.6 (ver "Cobro de suscripciones").

Verificado: 270/270 en `@impulza/api` (incluida la carrera de altas simultáneas), Playwright 35/35.
Detalle en `docs/BACKLOG_FASE_4.md`.

## Cobro de suscripciones (F4.6a, ADR-012)

Freemium: el plan Gratis atrae y los planes de pago se contratan con **Webpay Oneclick** o
**Mercado Pago Suscripciones** (F4.6b: Mercado Pago cobra solo y avisa por webhook firmado; el
worker concilia por si se pierde un aviso). Nunca se guarda una tarjeta: solo la referencia de Transbank, cifrada, y
marca y últimos 4 dígitos.

- **`packages/payments`**: adaptador REST de Transbank (Zod en cada respuesta, sin redirecciones,
  timeout), pasarela simulada para pruebas, reglas puras (IVA 19 % con neto + IVA = total, períodos
  que no se saltan febrero, orden de compra determinista, gracia y reintentos, retracto de 10 días)
  y correos con comprobante.
- **API** (`organizations/:org/billing`): ver estado (miembro) y contratar (solo OWNER,
  `billing.manage`). Contratar exige aceptar Términos y aviso de retracto, que se guardan con su
  versión (`LegalAcceptance`). El retorno de Transbank (`/billing/webpay/return`) no usa sesión:
  solo el token de un solo uso; un retorno repetido no cobra dos veces.
- **Worker**: ciclo horario que renueva, concilia cobros sin respuesta consultando a Transbank,
  maneja morosidad (7 días de gracia, reintentos días 1, 3 y 6) y vuelve a Gratis **sin borrar
  contenido**.
- **Configuración**: `WEBPAY_*` (todas o ninguna) y `API_PUBLIC_URL`. En local, las credenciales
  públicas de integración de Transbank (no cobran de verdad).

- **Panel "Plan y pagos" (F4.6c)**: tarjetas de planes con precio final y ahorro anual, diálogo de
  pago con neto/IVA y las dos aceptaciones, resultado al volver de Webpay, tarjeta de la suscripción
  con cancelar (un clic, sigue hasta fin de período), reanudar y retracto con reembolso total en 10
  días, e historial de pagos. Términos del servicio en `/terminos` del sitio comercial.

- **Facturación en la superadministración (F4.6d)**: MRR/ARR, cobrado del mes con neto e IVA,
  boletas por emitir (con su folio), reembolso manual auditado y planilla CSV del mes para el
  contador; el detalle de cada organización muestra su suscripción y sus pagos.

Pendiente para cobrar en producción: contrato Oneclick Mall, proveedor de boletas electrónicas y
texto legal revisado (ver ADR-012, "Seguimiento"). Detalle en `docs/BACKLOG_FASE_4.md`.

## Medición con GA4 y píxel de Meta (F7.1, ADR-016)

Cada sitio guarda en el panel (Sitios → su sitio → "Medición") el ID de GA4 y el del píxel de Meta:
solo identificadores, nunca código. La página pública muestra un aviso de cookies (Aceptar, Rechazar
y Configurar, con el mismo peso) y **no carga nada de terceros sin consentimiento**; con él mide
vistas, clics en WhatsApp, formularios, reservas y pedidos, sin datos personales. `apps/web` ahora
responde con CSP y cabeceras de seguridad (`lib/security-headers.ts`); todo origen nuevo que cargue
la página pública se agrega ahí con su prueba.

## Integraciones: webhooks salientes (F7.2, ADR-017)

En el panel, "Integraciones" (solo dueño o administrador, permiso `webhooks.manage`) registra hasta
10 destinos `https` públicos y elige qué eventos reciben: contacto nuevo, reserva nueva o cancelada,
pedido nuevo o pagado. Cada aviso es un `POST` JSON firmado (`Impulza-Signature: t=…,v1=…`, HMAC
con el secreto `whsec_…` que se muestra una sola vez) con un `id` estable para descartar repetidos.
El worker entrega con 8 intentos en ~1 día; un `410` o 15 fallas seguidas desactivan el destino y
avisan al dueño. Nunca se conecta a redes privadas ni sigue redirecciones (la IP se valida al
conectar). Para Zapier o Make: crear un "Catch Hook"/"Custom webhook", pegar su URL como destino y
usar "Enviar un ejemplo de…" para que aprendan los campos (esos envíos llevan `test: true`). El
registro de entregas se guarda 30 días. Requiere `AUTH_ENCRYPTION_KEY` en la API y el worker.

## Cobros de los negocios (F5.8, ADR-013)

Cada negocio conecta **su propia** cuenta de Mercado Pago desde "Cobros" (OAuth con PKCE): el
dinero de sus ventas va directo a su cuenta, Impulza no lo recibe ni cobra comisión, y guarda solo el
permiso otorgado, cifrado y revocable. El worker renueva el acceso antes de que venza.

**F5.9 — pedidos cobrados en línea.** Con la cuenta conectada, cada pedido de la tienda (en CLP) se
paga en Mercado Pago (Checkout Pro) y se marca pagado solo: el aviso llega firmado y el pago se
consulta con el token del negocio antes de aplicarlo (pedido, cuenta, monto y moneda deben
coincidir). El comprador sigue su pedido en `/pedido/:token`. Requiere
`MERCADOPAGO_APP_WEBHOOK_SECRET` junto a id y secreto de la aplicación.

**F5.10 — seña de reservas.** Un servicio puede pedir una seña fija. Con la cuenta conectada, la
reserva queda "esperando seña" (la hora queda tomada 30 minutos), el cliente la paga en Mercado Pago
desde la confirmación o "Tu reserva" y se confirma sola; si no paga, el worker libera la hora. Un
pago tardío reconfirma la reserva si la hora sigue libre, o avisa al negocio para devolverlo.

**F5.11a — devoluciones y contracargos.** El dueño (permiso `payments.refund`) devuelve todo o
parte de un pedido o una seña desde el panel, sin riesgo de devolver dos veces. Las devoluciones
hechas desde Mercado Pago y los contracargos o reclamos llegan por aviso: quedan registrados y el
negocio recibe el aviso.

**F5.11b — descargas pagadas (ADR-015).** Un producto digital lleva su archivo (PDF, ZIP, EPUB, MP3,
MP4, PNG o JPG, hasta 200 MB, cuenta para el almacenamiento del plan) en un bucket **privado**
aparte (`STORAGE_PRIVATE_BUCKET`, que `pnpm --filter @impulza/storage run setup:local` crea sin
lectura pública). El comprador recibe su enlace de descarga cuando el pedido queda pagado; cada clic
en "Descargar" entrega una URL firmada de 5 minutos (20 descargas por pedido). Cancelar, devolver
todo o un contracargo cortan la descarga.

## Superadministración (F4.4, `apps/admin`)

Panel de la plataforma en `http://localhost:3200` (`pnpm --filter @impulza/admin dev`, con
`NEXT_PUBLIC_API_URL` en `apps/admin/.env.local`). Modelo decidido en
`docs/decisions/ADR-005-superadministracion.md`.

- **Dar acceso** (solo desde el servidor, nunca desde la API): la cuenta debe estar registrada y con
  el correo verificado. Luego
  `pnpm --filter @impulza/api run superadmin -- grant correo@ejemplo.cl`, que activa el 2FA e
  imprime **una vez** la clave para la app autenticadora. Para quitarlo: `... -- revoke correo@...`.
- **Entrar:** correo, contraseña y código de 6 dígitos. Sesión propia de 8 h que no sirve en el panel,
  y la del panel tampoco sirve acá.
- **Qué hace:** resumen global, buscar organizaciones y usuarios, ver plan y uso, cambiar plan a mano,
  bloquear o restaurar (el sitio queda fuera de línea y el panel en solo lectura, con el motivo
  visible para el cliente), editar el catálogo de planes y revisar la auditoría. Nunca muestra
  contactos ni contenido de un cliente, y abrir una organización queda auditado.

Verificado: 26 pruebas e2e nuevas de API (296/296 en total), Playwright 49/49. Detalle y deudas en
`docs/BACKLOG_FASE_4.md`.

## Biblioteca de medios (PP1–PP2, ADR-006)

Imágenes propias para perfil, portadas y galerías, en **Cloudflare R2** en producción y **MinIO** en
desarrollo (el mismo protocolo S3).

```bash
docker compose --profile storage up -d minio          # MinIO local en :9010
pnpm --filter @impulza/storage run setup:local         # crea el bucket con lectura pública
```

- El navegador sube **directo al bucket** con una URL prefirmada (tipo y tamaño firmados, 10 min). La
  API verifica el archivo real (bytes mágicos) y el worker genera versiones WebP livianas **sin
  metadatos**, así que la ubicación GPS de las fotos no se publica.
- Solo JPG, PNG, WebP y AVIF de hasta 8 MB (nunca SVG). La cuota de almacenamiento del plan se aplica.
- **En el panel (PP2):** `/medios` muestra la biblioteca, sube con progreso y muestra el uso de
  cuota. En el constructor, cada imagen (perfil, portada, imagen, galería, servicio, testimonios) se
  elige de la biblioteca o se sube en el momento, con guía de proporción y texto alternativo
  obligatorio (o marcarla como decorativa). La página pública sirve esas imágenes con `srcset`.
  Un bloque no puede usar imágenes de otra organización.
- **Producción:** poner en el `.env` los valores `STORAGE_*` de R2 (ver `.env.example`). En R2, dar
  lectura pública al bucket por un dominio propio y un CORS que permita `PUT` desde el origen del
  panel. Sin esas variables, todo lo demás funciona y la subida avisa que no está configurada.

## Fondo premium de la página (PP3)

En la pantalla del sitio, "Fondo de la página": el del tema, un color, uno de 8 degradados curados,
una imagen de la biblioteca o un video de la biblioteca curada (vacía hasta que se apruebe su
contenido). Se aplica en vivo, como el tema, y la página pública se actualiza al instante.

- **El texto siempre se lee (AA, verificado en el servidor).** Sobre un fondo oscuro, el texto de la
  página pasa a claro, y al revés; las tarjetas conservan los colores del tema. Sobre una imagen, el
  worker mide sus tonos extremos al procesarla y la API rechaza una capa de oscurecido o aclarado
  demasiado suave para esa foto. El panel ya desactiva esas opciones.
- **Nunca CSS libre:** colores hex, códigos del catálogo y archivos propios. Una imagen de fondo
  tiene que ser de la biblioteca de la misma organización, y no se puede borrar mientras sea fondo.
- **Video:** primero se ve el póster; el video se agrega solo sin "reducir movimiento" ni "ahorro de
  datos", con `muted playsInline autoPlay loop` (lo que reproducen Instagram y TikTok).
- **En local**, para que la página pública se actualice sin publicar, `apps/api` necesita
  `WEB_APP_URL` y `WEB_REVALIDATE_SECRET` (el mismo `REVALIDATE_SECRET` de `apps/web`). Sin ellas el
  aviso no se envía, igual que antes (no-op documentado).

## Temas Ejecutivo y Vibrante, y encabezado de perfil (PP4)

- **Dos líneas nuevas de temas**, con pareja tipográfica real (una fuente para títulos y otra para
  el texto): **Ejecutivo** (Marino, Grafito, Borgoña — serif sobria en títulos) y **Vibrante**
  (Coral, Violeta, Turquesa — más color, títulos expresivos). En el panel, "Apariencia" agrupa los
  temas por línea y cada tarjeta muestra su tipografía y su botón. Todos verificados AA.
- **Fuentes alojadas en el propio sitio:** paquetes `@fontsource-variable/*` (licencia OFL) que cada
  app empaqueta en sus estáticos. El visitante nunca le pide fuentes a Google ni a otro tercero, y
  solo descarga la que usa el tema (subconjunto latino, `font-display: swap`).
- **Encabezado de perfil:** el bloque perfil acepta una portada, con el avatar montado sobre su
  borde, y una fila de hasta 8 redes con su logo real bajo la biografía. Ambos opcionales: los
  perfiles existentes se ven igual.
- **Al desplegar sobre una base existente**, correr `pnpm --filter @impulza/database run db:seed`
  para que aparezcan los temas nuevos (idempotente).

## Plantillas y onboarding (PL1, PL3, PL4)

- **Catálogo** (`TEMPLATE_CATALOG`, `packages/validation/src/templates`): 7 plantillas por rubro con
  contenido de ejemplo ficticio, validadas con los mismos esquemas de bloques del constructor.
  `GET /api/v1/templates` (filtros `industry`, `objective`, `family`) sin sesión.
- **Al desplegar sobre una base existente**: `pnpm --filter @impulza/database run db:migrate:deploy`
  (tabla `templates`, reversible con su `down.sql`) y luego `db:seed` (idempotente).
- **Onboarding** en `/bienvenida` (11 pasos del plan maestro §8.2): termina con la página creada
  desde la plantilla elegida, con los datos del usuario, y publicada.
- **Constructor**: "Usar una plantilla" reemplaza los bloques de la página con confirmación; los
  anteriores se recuperan desde el historial de versiones y el tema/fondo se pueden deshacer.

## Acción principal y entrada de los bloques (PP5)

- En el constructor, un bloque de WhatsApp, enlace o formulario se marca como **acción principal**
  (una por página, garantizado por la base de datos). Se destaca en la página y, en el teléfono,
  queda fija abajo mientras la persona recorre el perfil; se esconde cuando el botón original está
  a la vista y nunca tapa el final de la página. Se ve al publicar, como cualquier cambio.
- Los bloques entran con una animación suave y escalonada, que desaparece si el visitante pidió
  "reducir movimiento".

## Video de fondo propio (PP6, ADR-007)

- En `/medios` se sube un video (MP4, WebM o MOV de iPhone, hasta 30 MB y 15 s). El worker lo deja
  listo para cualquier teléfono —incluidos los navegadores de Instagram y TikTok—: H.264 de 720p,
  **sin sonido y sin la ubicación** que graba el teléfono, con póster para que la página cargue rápido.
- En "Fondo de la página → Video" se elige como fondo. La capa de oscurecido o aclarado se verifica
  sobre todas las escenas del video, no solo la primera.
- Necesita ffmpeg en el worker: `FFMPEG_PATH` y `FFPROBE_PATH` (ver `.env.example`). Sin ellas todo
  funciona y la subida de video simplemente no se ofrece.

## Página de enlaces (PP8)

Lo que ve quien toca el enlace de una biografía de Instagram o TikTok: la foto (o las iniciales),
el nombre y una frase, la fila de redes y **una pila de botones con todo lo que la persona tenga**
—web, portafolio, tienda, YouTube, Spotify, OnlyFans, WhatsApp…—, cada uno con el logo de su
plataforma, reconocido solo a partir del enlace. Cada botón abre ahí mismo. Los bloques de negocio
(formulario, servicios, testimonios, preguntas) siguen disponibles como opcionales.

Para ver un ejemplo con la API corriendo: `pnpm --filter @impulza/api run demo:perfil` y abrir
http://localhost:3300/ana-rojas (la cuenta de ejemplo se imprime al terminar; solo desarrollo).

## Verificación de la página pública (PP7)

`pnpm test:e2e` levanta además el sitio público **en modo producción** (puerto 3390) y comprueba lo
que vive el visitante que toca el enlace desde Instagram o TikTok:

- **Rendimiento:** con un teléfono en 4G lento emulado, el contenido principal se ve en menos de
  1 segundo (presupuesto: 2,5 s) aunque la página tenga video de fondo; el video llega después.
- **Navegadores internos** de Instagram, TikTok, Facebook y Pinterest: la página se ve bien, el video
  se reproduce solo y la visita cuenta como de teléfono en la analítica.
- **Revisión visual:** capturas de cada tema y cada tipo de fondo en `packages/e2e/.playwright/revision-visual/`.

## Soporte (F4.5)

- **Cliente:** en el panel, `/soporte` para abrir una solicitud (asunto y detalle, sin adjuntos), ver
  su estado y conversar con el equipo. Funciona aunque la organización esté bloqueada. El propietario
  y el administrador ven todas las solicitudes de la organización; el resto de los miembros, solo
  las suyas.
- **Equipo:** en `apps/admin`, `/soporte` es una bandeja por estado, con las más antiguas primero,
  para responder y cerrar. Todo queda auditado.
- **Correo:** avisos al abrir y al responder, sin copiar el detalle. Para el aviso al equipo,
  configurar `SUPPORT_NOTIFICATION_EMAIL` (y `ADMIN_BASE_URL` para el enlace).

## Revisión de retención de contactos y cierre de Fase 3

ADR-004 (punto 4) pide que un contacto sin interacción durante 36 meses quede marcado para que el
dueño decida si lo conserva — nunca borrado automáticamente. El job diario de `apps/worker` lo
marca (`CONTACT_RETENTION_REVIEW_MONTHS`, 36 por defecto); en `/contactos` aparece la etiqueta
"Revisar retención" y un filtro, y la ficha ofrece "Conservar contacto" (auditado) o el borrado de
siempre. Con esto se cumplen todas las condiciones de salida de la Fase 3 — tabla con la evidencia
de cada una en `docs/BACKLOG_FASE_3.md` ("Salida de Fase 3").

## Dashboard de conversión (F3.7)

Séptima historia de Fase 3. `/analitica` en el panel muestra cómo llegan las personas a los sitios
y cuántas terminan en contacto: visitas, visitantes, clics, leads, tasa de conversión y contactos
nuevos; gráfico diario (con vista de tabla), embudo, dispositivo, país, campañas UTM y rankings de
páginas, bloques, formularios, enlaces cortos y QR. Filtro por sitio y por período (7/30/90 días o
personalizado).

- **API**: `GET /organizations/:organizationId/analytics/overview` lee solo los agregados diarios
  del pipeline (F3.6), nunca el evento crudo; rango validado en servidor (máx. 366 días), `siteId`
  ajeno → 404.
- **Panel**: Recharts para la serie (una métrica a la vez, sin dos escalas en un eje), barras HTML
  de un solo tono para embudo y desgloses, estados de carga/vacío/error y responsive real.

Verificado: 246/246 en `@impulza/api` (8 pruebas nuevas, incluido el aislamiento por query param y
por ruta), Playwright 27/27 (móvil y escritorio), revisión visual con capturas reales. Detalle y
deuda declarada en `docs/BACKLOG_FASE_3.md`.

## Pipeline de analítica (F3.6)

Sexta historia de Fase 3. Cada visita, clic, envío de formulario, lead, escaneo de QR y clic a
enlace corto pasa por un pipeline real: endpoint → rate limit → cola BullMQ → `apps/worker` →
evento crudo + agregados diarios en Postgres (lo que va a leer el dashboard de F3.7).

- **`packages/analytics`**: catálogo de eventos, detección de bots y de tipo de dispositivo,
  convención de métricas y el procesador transaccional e idempotente — compartido por la API, el
  worker y las pruebas.
- **`apps/worker`** deja de ser un esqueleto: consume `analytics-events`, purga cada día el evento
  crudo vencido (`ANALYTICS_RETENTION_MONTHS`, 14 por defecto) y su `/health` ya verifica Postgres y
  Redis. En desarrollo hay que levantarlo (`pnpm --filter @impulza/worker dev`) para que los eventos
  lleguen a la base; sin él quedan esperando en Redis.
- **Sitio público**: un rastreador único (`apps/web/components/analytics-tracker.tsx`) mide vistas
  y clics por bloque sin exponer ids internos (slug + posición; la API resuelve el resto).
- **Privacidad (ADR-004)**: sin IP cruda, visitante con hash rotado por día, bots y vistas previas
  de chats descartados antes de persistir.
- **Arreglo de fondo**: `apps/web` ahora reenvía a la API la IP/user-agent/país del visitante real
  con un secreto compartido (`INTERNAL_PROXY_SECRET`, nueva variable en API y web — ver
  `.env.example`). Antes el rate limit público era un solo balde para toda la plataforma.

Verificado: 238/238 en `@impulza/api` (13 pruebas nuevas del pipeline contra Postgres/Redis reales),
22 unitarias en `@impulza/analytics`, Playwright 15/15, recorrido real con los cuatro procesos.
Detalle y deuda declarada en `docs/BACKLOG_FASE_3.md`.

## Enlaces cortos y códigos QR (F3.5)

Quinta historia de Fase 3. Un negocio crea una URL corta propia (`{web}/s/promo-septiembre`) y
un QR para imprimir, y ve cuántas veces se abrió cada uno.

- **API** (`apps/api/src/modules/short-links`, `.../qr-codes`, `.../public-links`): CRUD
  multi-tenant, slug con las reglas de F2.2 (reservados `s` y `qr` agregados), destino validado
  contra `javascript:`/`data:`/esquemas no-http, estilos de QR de un catálogo cerrado con contraste
  ≥ 7:1 para que siempre escanee.
- **Conteo antes del redirect**: `apps/web` (`app/s/[slug]`, `app/qr/[qrCodeId]`) consulta la API
  server-to-server, la API cuenta y registra `short_link_click`/`qr_visit`, y recién entonces se
  redirige con **307** — temporal a propósito: un 301 quedaría cacheado y dejaría de contar los
  clics repetidos y de respetar un cambio de destino.
- **Panel `/enlaces`** (`apps/dashboard/app/(panel)/enlaces/page.tsx`): crear, copiar, editar
  destino, eliminar, generar QR desde la fila o para una URL directa, ver el QR real con su
  contador y descargarlo en PNG de 1024px. El QR codifica siempre `{web}/qr/:id`, nunca el destino.
  Nueva variable de cliente `NEXT_PUBLIC_WEB_BASE_URL` (ver `.env.example`).
- **Arreglo de layout compartido**: la columna de contenido del panel ganó `min-w-0`; antes una
  tabla ancha desbordaba toda la página en un teléfono. Lo encontró la prueba e2e nueva.

Verificado: 225/225 en `@impulza/api`, Playwright `enlaces.spec.ts` en móvil y escritorio (15/15
de la suite e2e), recorrido real de clic y escaneo contado a mano, `lint`/`typecheck`/`build`
limpios. Deuda declarada (UTM en el panel, editar estilo de un QR existente) en
`docs/BACKLOG_FASE_3.md`.

## Contrato de la API — OpenAPI

`docs/api/openapi.json` describe la API completa: 40 rutas, 54 operaciones, todas con resumen,
etiqueta, cuerpo, respuestas y errores. Se genera desde la aplicación real, nunca a mano — un
documento mantenido a mano describe la API que alguien recuerda, no la que está desplegada.

```bash
pnpm openapi:generate    # necesita Postgres y Redis arriba (docker compose up -d)
```

**El documento no puede mentir sobre la validación, porque no la copia.** `@nestjs/swagger` deduce
la forma de un cuerpo por reflexión sobre clases de class-validator, y este proyecto valida con Zod
(ST §4.3): no hay clase que inspeccionar. La salida fácil sería describir cada cuerpo a mano en el
decorador, y ahí es donde la documentación empieza a envejecer sin que nada falle. En vez de eso,
`apps/api/src/openapi/zod-openapi.ts` convierte a JSON Schema **el mismo esquema Zod que usa
`ZodValidationPipe`**: el decorador recibe ese objeto, no una copia. Los cuerpos se describen con
`io: "input"` (lo que el cliente envía, antes de `.trim()` y los valores por defecto) y las
respuestas con `io: "output"` (lo ya transformado).

**Y no puede envejecer, porque hay una prueba que lo impide.** `apps/api/src/openapi/openapi.test.ts`
regenera el documento y lo compara con el archivo versionado: si alguien cambia la API y no lo
regenera, falla CI con el comando exacto a correr. Eso es lo que convierte "actualiza OpenAPI si
modificas la API" (`CLAUDE.md`, Definición de Terminado) en un criterio verificado y no en una
intención — sin esa prueba nadie lo comprueba, que es exactamente cómo el repositorio llegó hasta
F2.5 sin documento. La misma prueba exige que ninguna operación quede sin resumen ni etiqueta, y
que toda operación fuera de la lista explícita de públicas declare la cookie de sesión.

Los **contratos de respuesta** viven en `packages/contracts` y se comparten con los frontends. Solo
describen respuestas: los cuerpos de petición ya tienen su fuente de verdad en los esquemas que los
validan, y duplicarlos sería crear una segunda versión capaz de mentir. Que digan la verdad tampoco
se supone: las pruebas e2e parsean respuestas reales contra ellos, así que un cambio de forma en un
servicio rompe el contrato antes de llegar a un cliente. En `/auth` se comprueba además el conjunto
exacto de claves — que no aparezcan hash, secreto 2FA ni token es tan parte del contrato como lo
que sí aparece.

El archivo se versiona a propósito: así el contrato se revisa en el diff de un PR, se puede generar
un cliente sin levantar la API, y la prueba de sincronización tiene contra qué comparar.

**Documentación navegable en `/docs`**, montada solo si `NODE_ENV !== "production"`: publicarla es
regalar el mapa completo de la superficie de ataque. La CSP global es `default-src 'none'`, que
bloquea los propios assets de swagger-ui; se aplica una CSP más laxa **solo** sobre `/docs`, montada
después del helmet global para que la sobrescriba ahí y en ningún otro lado. Relajar la CSP global
para que se vea una pantalla de desarrollo sería pagar en toda la API por comodidad.

## CI

`.github/workflows/ci.yml` corre en cada PR y en push a `main`: install reproducible
(`--frozen-lockfile`), lint, typecheck, test, build y auditoría de dependencias, cada uno en un job
separado. El job `ci-ok` es la única verificación requerida a proteger en la rama (evita listar cada
job individualmente en la configuración de branch protection). Cualquier job que falle hace fallar
el pipeline completo — no hay pasos informativos silenciosos. El job `test` levanta servicios
Postgres/Redis reales (no mocks) y aplica las migraciones antes de correr — las pruebas de
integración de `apps/api` necesitan una base de datos real, igual que en desarrollo local.

## Design system (`packages/ui`)

Tokens en `src/styles/tokens.css` (Tailwind v4, `@theme`): fondo claro, tipografía del sistema,
radios moderados, sombras discretas — dirección visual obligatoria de `CLAUDE.md`. Componentes
base: `Button`, `Input`, `Card`, `Table`, y los estados obligatorios `EmptyState`/`LoadingState`/
`ErrorState`/`OfflineState`.

**Auditoría de contraste real, no a ojo**: `src/styles/contrast.test.ts` verifica cada par
texto/fondo del sistema contra AA (4.5:1 texto normal, 3:1 componentes de UI). La fórmula de
luminancia relativa WCAG 2.x vive desde F2.5 en `packages/validation/src/contrast.ts` —la
comparten el design system, los temas del catálogo y la validación de temas en el servidor—, pero
los **valores de color** siguen duplicados a propósito en el test: si cambias un color en
`tokens.css`, actualiza el valor espejo, para que el test pueda detectar una regresión de contraste
en vez de asumir que el token sigue siendo válido.

```bash
pnpm --filter @impulza/ui run storybook         # explorar componentes en localhost:6006
pnpm --filter @impulza/ui run build-storybook   # build estático, valida toda la config
```

> Nota: las skills de diseño que `CLAUDE.md` pide usar para revisar pantallas
> (`design-system`, `design-critique`, `accessibility-review`, `design-handoff`, `ux-copy`) no
> están disponibles como skills instalables en este entorno de Claude Code — se aplicaron a mano
> los criterios de contraste (con test automatizado) y de dirección visual del propio `CLAUDE.md`.

## Estructura

```text
apps/
├── web/          Next.js — sitio comercial + páginas públicas de usuarios
├── dashboard/    Next.js — panel autenticado (F1.8): auth, layout, organizaciones
├── admin/        Next.js — superadministración
├── api/          NestJS — API REST /api/v1: auth, organizations, rbac, audit, sites, pages
│                 (con publicación e historial), blocks y themes (F1.4–F2.6)
└── worker/       Procesamiento asíncrono (BullMQ se agrega cuando exista el primer job real)

packages/
├── ui/               Design system: tokens, Button/Input/Card/Table/estados, Storybook
├── database/         Prisma — schema, migraciones y seeds (roles, permisos, plan Gratis y
│                     catálogo de temas)
├── auth/             Hash de contraseñas (Argon2id), tokens, cifrado 2FA, adaptador de email
├── validation/       Esquemas Zod compartidos: slugs, catálogo de bloques (F2.4), tokens de tema
│                     y verificador de contraste WCAG (F2.5)
├── contracts/        DTOs y contratos de la API
├── analytics/        Taxonomía y utilidades de eventos
├── config/           Configuración de entorno validada (real en F1.2)
├── observability/     Logs, tracing y errores
├── eslint-config/     Configuración ESLint compartida
└── tsconfig/          tsconfig base compartido (base/nextjs/nestjs)

infrastructure/    Docker, proxy, monitoreo y scripts de operación (se llena desde F0.4)
docs/              Documentación de producto, arquitectura, ADRs y backlog
```

Ver `docs/architecture/ARCHITECTURE.md` para el diagrama completo de componentes y
`docs/architecture/ERD.md` para el modelo de datos.

## Decisiones de versión de F0.2 (por qué no siempre "la última")

Las versiones se fijaron consultando el registro de npm en el momento de crear el monorepo, no de
memoria. Dos casos donde se eligió deliberadamente **no** la última mayor disponible, por
incompatibilidad real verificada, no por precaución genérica:

- **TypeScript `6.0.3`**, no `7.0.2` (última en ese momento): `typescript-eslint@8.70.0` declara
  `peerDependencies.typescript: ">=4.8.4 <6.1.0"`. Usar TS 7 habría dejado el lint roto desde el
  día uno.
- **ESLint `9.39.5`** (línea de mantenimiento), no `10.10.0` (última): `eslint-plugin-react@7.37.5`
  —dependencia transitiva de `eslint-config-next`— declara soporte hasta `^9.7` y falla en runtime
  con ESLint 10 (`contextOrFilename.getFilename is not a function`). Verificado empíricamente: con
  ESLint 10, `pnpm lint` rompía en `apps/dashboard`/`apps/admin`/`apps/web`.
- **`apps/api` y `apps/worker` sin `@nestjs/cli`**: se usa `tsx` para dev y `tsc` para build,
  evitando la cadena de peer deps de webpack/SWC del CLI de Nest hasta que exista una razón real
  para necesitar sus schematics o HMR.
- **`apps/worker` sin `bullmq`/`ioredis` todavía**: se agregan cuando exista el primer job real
  (Fase 1 tardía o Fase 3), para no cargar una dependencia sin uso.
- **Prisma `6.19.3`, no `7.x`** (fijado en F1.3, ver sección "Base de datos" arriba para el
  detalle): Prisma 7 generaba tipos vacíos en esta máquina — bug verificado, no evitado por
  precaución.
- **Sin `@nestjs/throttler`** (F1.4): su última versión estable (`6.5.0`) declara
  `peerDependencies` solo hasta `@nestjs/core ^11`, y este proyecto usa Nest `12.0.2`. En vez de
  arriesgar una integración no probada por el propio paquete, se implementó rate limiting propio
  respaldado en Redis (`apps/api/src/common/rate-limit.guard.ts`) — además alineado con
  `ARCHITECTURE.md` §3.3, que ya designa Redis para "caché/rate limits".

Revisar estas decisiones si se retoma el trabajo mucho después: el ecosistema puede haber
alcanzado a ESLint 10 / TypeScript 7 para entonces, Prisma 7/8 puede haber madurado, y
`@nestjs/throttler` puede ya soportar Nest 12.

## Documentación de referencia

- `CLAUDE.md` — reglas duras del proyecto (no negociables de seguridad, UI/UX y definición de
  terminado).
- `docs/REQUIREMENTS_TRACEABILITY.md` — trazabilidad de requisitos por fase.
- `docs/architecture/ARCHITECTURE.md`, `docs/architecture/ERD.md` — arquitectura y modelo de datos.
- `docs/decisions/` — ADRs.
- `docs/BACKLOG_FASE_0_1.md` — backlog activo con criterios de aceptación.
