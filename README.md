# Impulza One

Plataforma SaaS multiusuario y multiempresa para construir un centro digital de negocio (marca,
captación, reservas, ventas y analítica) desde una sola URL.

**Estado actual: Fase 2 — Sitio público y constructor, historia F2.5 (temas y apariencia)
terminada. Siguiente: F2.6 (borrador, publicación e historial).** Fase 0 y Fase 1 cerradas
(F0.1–F0.5, F1.1–F1.10). Ver `docs/BACKLOG_FASE_2.md` para el backlog de la fase activa,
`docs/BACKLOG_FASE_0_1.md` para las anteriores y `CLAUDE.md` para las reglas de trabajo del
repositorio.

| Fase | Historias | Estado |
|---|---|---|
| 0 — Preparación | F0.1–F0.5 | Terminada |
| 1 — Cimientos y cuenta | F1.1–F1.10 | Terminada |
| 2 — Sitio público y constructor | F2.1–F2.5 | En curso (F2.6–F2.10 pendientes) |

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
├── api/          NestJS — API REST /api/v1: auth, organizations, rbac, audit, sites, pages,
│                 blocks y themes (F1.4–F2.5)
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
