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
pnpm install
pnpm build      # turbo run build en todas las apps/paquetes
pnpm dev        # turbo run dev (apps Next.js + API en watch mode)
```

Scripts disponibles en la raíz (delegan en Turborepo):

| Script | Qué hace |
|---|---|
| `pnpm build` | Compila todas las apps y paquetes. |
| `pnpm dev` | Levanta las apps en modo desarrollo. |
| `pnpm lint` | Lint en todo el monorepo. |
| `pnpm typecheck` | Chequeo de tipos en todo el monorepo. |
| `pnpm test` | Pruebas en todo el monorepo. |

## Estructura

```text
apps/
├── web/          Next.js — sitio comercial + páginas públicas de usuarios
├── dashboard/    Next.js — panel del propietario/colaborador y modo agencia
├── admin/        Next.js — superadministración
├── api/          NestJS — API REST /api/v1, toda la lógica de negocio
└── worker/       Procesamiento asíncrono (BullMQ se agrega cuando exista el primer job real)

packages/
├── ui/               Design system compartido (tokens y componentes llegan en F1.1)
├── database/         Prisma — schema, migraciones y seeds (schema real en F1.3)
├── auth/             Contratos y utilidades de autenticación
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

Revisar estas decisiones si se retoma el trabajo mucho después: el ecosistema puede haber
alcanzado a ESLint 10 / TypeScript 7 para entonces.

## Documentación de referencia

- `CLAUDE.md` — reglas duras del proyecto (no negociables de seguridad, UI/UX y definición de
  terminado).
- `docs/REQUIREMENTS_TRACEABILITY.md` — trazabilidad de requisitos por fase.
- `docs/architecture/ARCHITECTURE.md`, `docs/architecture/ERD.md` — arquitectura y modelo de datos.
- `docs/decisions/` — ADRs.
- `docs/BACKLOG_FASE_0_1.md` — backlog activo con criterios de aceptación.
