# Impulza One

Plataforma SaaS multiusuario y multiempresa para construir un centro digital de negocio (marca,
captación, reservas, ventas y analítica) desde una sola URL.

**Estado actual: Fase 0 — Preparación, historia F0.2 (inicialización del monorepo).** Ver
`docs/BACKLOG_FASE_0_1.md` para el backlog completo y `CLAUDE.md` para las reglas de trabajo del
repositorio.

Este repositorio contiene por ahora la **fundación estructural** del monorepo: apps y paquetes con
esqueleto mínimo que compila, sin lógica de negocio, autenticación, base de datos ni diseño real
todavía (eso llega en Fase 1).

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
cp .env.example .env    # ajustar si hace falta
pnpm install
pnpm docker:up           # Postgres + Redis locales (ver "Entorno local" abajo)
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

**Auditoría de contraste real, no a ojo**: `src/styles/contrast.test.ts` calcula la fórmula de
luminancia relativa WCAG 2.x para cada par texto/fondo del sistema y falla si algún color no llega
a AA (4.5:1 texto normal, 3:1 componentes de UI). Si cambias un color en `tokens.css`, actualiza el
valor espejo en ese test — está duplicado a propósito para que el test pueda detectar una regresión
de contraste en vez de asumir que el token sigue siendo válido.

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
├── dashboard/    Next.js — panel del propietario/colaborador y modo agencia
├── admin/        Next.js — superadministración
├── api/          NestJS — API REST /api/v1. Módulos auth (F1.4) y organizations (F1.5) completos
└── worker/       Procesamiento asíncrono (BullMQ se agrega cuando exista el primer job real)

packages/
├── ui/               Design system: tokens, Button/Input/Card/Table/estados, Storybook
├── database/         Prisma — schema, migración inicial y seeds (roles + plan Gratis)
├── auth/             Hash de contraseñas (Argon2id), tokens, cifrado 2FA, adaptador de email
├── validation/       Esquemas Zod compartidos
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
