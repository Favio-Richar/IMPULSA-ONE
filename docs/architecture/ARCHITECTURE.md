# Arquitectura — Impulza One

Estado: propuesta inicial para Fase 0/1, derivada de `02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md`.
No implica código todavía; requiere aprobación antes de inicializar el monorepo.

## 1. Estilo arquitectónico

**Monolito modular dentro de un monorepo**, con aplicaciones desplegables separadas pero un único
dominio de despliegue por ahora. Cada módulo de negocio (auth, sites, forms, contacts, etc.) vive
como una unidad interna desacoplada — con sus propios casos de uso y acceso a datos — para permitir
extraerlo a un servicio independiente en el futuro sin reescritura completa. No se crean
microservicios, colas entre servicios de dominio, ni orquestación tipo Kubernetes en el MVP.

## 2. Componentes

```text
                         ┌─────────────────────────┐
                         │        Cloudflare        │
                         │   CDN / DNS / WAF / TLS   │
                         └────────────┬─────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
┌───────▼────────┐           ┌────────▼────────┐           ┌────────▼────────┐
│   apps/web      │           │  apps/dashboard  │           │   apps/admin     │
│  Next.js        │           │  Next.js         │           │  Next.js         │
│  marketing +     │           │  panel usuario/   │           │  superadmin      │
│  sitios públicos │           │  agencia          │           │                  │
└───────┬────────┘           └────────┬────────┘           └────────┬────────┘
        │  REST /api/v1 (fetch/SSR)   │                             │
        └─────────────────────────────┼─────────────────────────────┘
                                      │
                             ┌────────▼────────┐
                             │    apps/api      │
                             │    NestJS        │
                             │  controller →     │
                             │  use case →        │
                             │  domain → repo     │
                             └───┬────────┬─────┘
                                 │        │
                    ┌────────────┘        └────────────┐
                    │                                   │
           ┌────────▼────────┐                 ┌────────▼────────┐
           │   PostgreSQL 18  │                 │      Redis       │
           │  (Prisma)        │                 │ caché/ratelimit/  │
           │  datos          │                 │ colas BullMQ      │
           │  transaccionales │                 └────────┬────────┘
           └─────────────────┘                          │
                                                 ┌────────▼────────┐
                                                 │   apps/worker    │
                                                 │   BullMQ jobs    │
                                                 │  (analítica,      │
                                                 │  emails, media,   │
                                                 │  webhooks)        │
                                                 └────────┬────────┘
                                                          │
                              ┌───────────────────────────┼───────────────────────────┐
                              │                            │                            │
                     ┌────────▼────────┐         ┌─────────▼────────┐         ┌────────▼────────┐
                     │  S3 / R2 (media)  │         │  Resend/SES (email)│         │  Adaptadores      │
                     │                   │         │                    │         │  pagos/IA/WhatsApp │
                     └───────────────────┘         └────────────────────┘         └────────────────────┘

Transversal: Sentry (errores), OpenTelemetry (trazas), Prometheus+Grafana (métricas), Loki (logs),
Uptime Kuma (disponibilidad).
```

## 3. Responsabilidades por capa

- **apps/web**: sitio comercial de Impulza One + render público de los sitios de los usuarios
  (páginas, bloques, SEO). Sin lógica de negocio; consume la API.
- **apps/dashboard**: panel del propietario/colaborador y modo agencia. Constructor visual, CRM,
  formularios, analítica, configuración.
- **apps/admin**: superadministración (usuarios, planes, moderación, operación).
- **apps/api** (NestJS): toda la lógica de negocio, permisos, validación y orquestación. Organizada
  por módulo de dominio; dentro de cada módulo: `controller → application service/use case →
  domain → repository/adapter`. Ningún control de negocio vive en el frontend.
- **apps/worker**: procesamiento asíncrono vía BullMQ — eventos de analítica, envío de emails,
  procesamiento de media, webhooks salientes, jobs de facturación.
- **packages/***: código compartido sin lógica de infraestructura propia — `ui` (design system),
  `database` (Prisma schema/migraciones/seeds), `auth`, `validation` (Zod compartido), `contracts`
  (DTOs API), `analytics` (taxonomía de eventos), `config` (env tipado), `observability`.

## 4. Multi-tenancy

- Entidad raíz: `Organization`. Todo recurso comercial (`Site`, `Contact`, `Form`, etc.) tiene
  `organization_id` obligatorio.
- Resolución de tenant: a partir de la membresía autenticada (`Membership`), nunca de un valor
  enviado por el cliente sin verificar.
- Cada query protegida en `apps/api` filtra por `organization_id` derivado del contexto de
  autenticación/autorización, no de parámetros de request.
- Superadministración usa rutas, guards y auditoría independientes del resto de la API.
- Se requieren tests de aislamiento (una organización no puede leer/escribir datos de otra) como
  parte de la definición de terminado de cualquier módulo con datos comerciales.

## 5. Contratos con proveedores externos

Interfaces internas (puertos) con adaptadores intercambiables para: pagos, email, almacenamiento,
IA, analítica externa, calendarios, WhatsApp. Ningún módulo de dominio importa un SDK de proveedor
directamente; siempre pasa por el adaptador correspondiente en `packages/*` o en un módulo de
infraestructura dedicado dentro de `apps/api`.

## 6. Decisiones abiertas de infraestructura

- Proxy inverso: Caddy, Traefik o Nginx — a decidir y documentar en un ADR antes de Fase 4
  (producción).
- Un solo proveedor por categoría en el primer despliegue (no combinar alternativas).
- ClickHouse para analítica: diferido, se evalúa solo si Postgres deja de cumplir objetivos medidos.

## 7. Referencias

- Ver `docs/architecture/ERD.md` para el modelo de datos.
- Ver `docs/decisions/ADR-001-modular-monolith.md` y `ADR-002-multi-tenancy.md` para el
  razonamiento detrás de estas dos decisiones estructurales.
