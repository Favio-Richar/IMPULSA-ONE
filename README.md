# Impulza One

Plataforma SaaS multiusuario y multiempresa para construir un centro digital de negocio (marca,
captación, reservas, ventas y analítica) desde una sola URL.

**Estado actual: Fase 2 — Sitio público y constructor. F2.10 (aislamiento multi-tenant de la fase)
terminada. F2.9 (constructor visual, `apps/dashboard`) en curso: Etapa A cerrada; Etapa B cubre ya
los criterios de aceptación escritos — lienzo, biblioteca, panel de configuración, vista previa en
vivo, deshacer/rehacer (acotado a bloques existentes) y publicar desde el propio constructor, para
los 15 tipos del catálogo. Antes de marcar F2.9 (y con ella, toda la Fase 2) como terminada falta
un solo punto: verificar el responsive real del panel en una pantalla angosta (no solo el simulador
de la vista previa) — no se pudo confirmar desde esta sesión, ver más abajo.**
Fase 0 y Fase 1 cerradas (F0.1–F0.5, F1.1–F1.10). Ver
`docs/BACKLOG_FASE_2.md` para el backlog de la fase activa, `docs/BACKLOG_FASE_0_1.md` para las
anteriores y `CLAUDE.md` para las reglas de trabajo del repositorio.

| Fase | Historias | Estado |
|---|---|---|
| 0 — Preparación | F0.1–F0.5 | Terminada |
| 1 — Cimientos y cuenta | F1.1–F1.10 | Terminada |
| 2 — Sitio público y constructor | F2.1–F2.10 | En curso (F2.1–F2.8 y F2.10 terminadas; falta un punto de F2.9) |

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

**No cerrada del todo — una verificación pendiente antes de marcarla como terminada:** el
**responsive real del propio panel del constructor en pantallas angostas** (no el simulador de
dispositivo de la vista previa, que sí se probó). Confirmado que `resize_window` de la herramienta
de navegador no cambia el viewport real en esta máquina — no solo la captura, sino
`window.innerWidth` medido por JS después del resize, que siguió en 1920 sin importar qué tamaño se
pidiera. Solo se pudo verificar a mano en ancho de escritorio. Las clases responsive
(`grid-cols-1 lg:grid-cols-[...]`) siguen la misma convención que el resto del dashboard, pero eso
es leer el código, no verlo andar en un teléfono real — falta que alguien lo revise en un
dispositivo de verdad o en las devtools de su propio navegador.

Fuera de los criterios de aceptación (no exigido, pendiente aparte): sin UI para
`scheduledStart`/`scheduledEnd` (el campo existe en la API desde F2.4).

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
