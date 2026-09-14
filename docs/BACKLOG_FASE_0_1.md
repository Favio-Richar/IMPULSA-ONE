# Backlog — Fase 0 (Preparación) y Fase 1 (Fundación)

Fuente: `02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` §19. Cada historia usa la Definición de
Terminado general de §21 más los criterios específicos listados aquí. Ninguna historia de Fase 1
se marca completa sin pruebas y sin cumplir el aislamiento multi-tenant (ADR-002) cuando aplique.

## Fase 0 — Preparación

### F0.1 — Diagnóstico y documentación base
**Criterios de aceptación:**
- Existen `REQUIREMENTS_TRACEABILITY.md`, `ARCHITECTURE.md`, `ERD.md`, ADR-001 y ADR-002.
- El repositorio (vacío o existente) fue inspeccionado antes de proponer cambios; se documentó su
  estado.
- El propietario aprobó el diagnóstico antes de cualquier inicialización.

### F0.2 — Inicialización del monorepo
**Criterios de aceptación:**
- Estructura de carpetas según ARCHITECTURE.md (`apps/*`, `packages/*`, `infrastructure/*`, `docs/*`).
- pnpm workspaces + Turborepo configurados; `pnpm install` y `turbo build` corren sin error en un
  entorno limpio.
- Lockfile committeado.
- README con instrucciones de arranque local.

### F0.3 — CI base
**Criterios de aceptación:**
- Workflow de GitHub Actions ejecuta en cada PR: install reproducible, lint, typecheck, tests
  unitarios, build de apps afectadas, auditoría de dependencias.
- Pipeline falla si cualquiera de los pasos falla (no hay pasos "informativos" silenciosos).

### F0.4 — Entornos y configuración
**Criterios de aceptación:**
- Existen definiciones para `local`, `test`, `staging`, `production` con bases de datos, Redis,
  buckets y claves separadas por entorno (al menos documentado si algunos entornos remotos se
  crean después).
- `.env.example` sin secretos reales; validación tipada de configuración (`packages/config`) que
  falla al arrancar si falta una variable requerida.
- `docker-compose.yml` levanta Postgres + Redis (+ MinIO opcional) para desarrollo local.

### F0.5 — ADRs y control de decisiones
**Criterios de aceptación:**
- ADR-001 y ADR-002 mergeados.
- Proceso definido para nuevos ADRs (plantilla, ubicación `docs/decisions/`).

## Fase 1 — Fundación

### F1.1 — Design system base (`packages/ui`)
**Criterios de aceptación:**
- Tokens de color, tipografía y espaciado según dirección visual obligatoria (fondo claro, iconos
  lineales, sombras discretas, bordes moderados).
- Componentes base (botón, input, card, tabla, estado vacío/carga/error) documentados en
  Storybook.
- Auditoría de contraste básica (no bloqueante aún, mecanismo presente).

### F1.2 — Configuración tipada compartida
**Criterios de aceptación:**
- `packages/config` valida variables de entorno con Zod en `apps/api` y workers al iniciar.
- Falla rápido y con mensaje claro si falta una variable requerida.

### F1.3 — Base de datos y esquema inicial
**Criterios de aceptación:**
- Prisma configurado en `packages/database`.
- Migración inicial cubre entidades de identidad/organización del ERD (`User`, `Session`,
  `Account`, `Organization`, `Membership`, `Role`, `Permission`, `Plan`, `Subscription`,
  `UsageCounter`, `AuditLog`).
- Seeds mínimos para desarrollo (roles base, un plan gratuito).

### F1.4 — Autenticación
**Criterios de aceptación:**
- Registro con email/contraseña, verificación de correo, login, recuperación de contraseña.
- Login con Google marcado como opcional/flag, no bloqueante para el resto de la fase.
- Hash seguro de contraseñas; cookies `HttpOnly`/`Secure`/`SameSite` correctas.
- Rate limiting en endpoints de auth; bloqueo temporal tras intentos abusivos.
- Sesiones y dispositivos activos listables y revocables por el usuario.
- 2FA: al menos diseño de datos y endpoint base (puede no ser obligatorio hasta antes de
  producción comercial, según ST §7, pero no debe requerir cambio de esquema después).

### F1.5 — Organizaciones y membresías
**Criterios de aceptación:**
- Crear organización, invitar miembro, aceptar invitación, cambiar rol, remover miembro.
- Un usuario puede pertenecer a varias organizaciones y cambiar el contexto activo en el frontend.
- Todo endpoint que toque datos de organización exige membresía verificada — no confía en
  `organization_id` de la request.

### F1.6 — Roles y permisos (RBAC)
**Criterios de aceptación:**
- Roles iniciales implementados: OWNER, ADMIN, EDITOR, ANALYST, SUPPORT, AGENCY_MANAGER,
  SUPER_ADMIN.
- Permisos explícitos por rol, verificables por endpoint (guard reutilizable en NestJS).
- Modelo preparado para restricciones por recurso (no solo por rol global) aunque no se implemente
  todavía el detalle fino.

### F1.7 — Auditoría
**Criterios de aceptación:**
- `AuditLog` registra acciones sensibles (cambios de rol, invitaciones, login fallido repetido,
  acciones de superadmin) con actor, acción, objetivo y timestamp.
- Logs de auditoría no contienen secretos ni contraseñas.

### F1.8 — Layouts del panel
**Criterios de aceptación:**
- `apps/dashboard` tiene layout base autenticado (navegación según §13 del plan maestro, mostrando
  solo módulos habilitados).
- Estados obligatorios implementados a nivel de layout: carga, vacío, error recuperable, sin
  permisos, desconectado.
- Responsive verificado en móvil y escritorio.

### F1.9 — Aislamiento multi-tenant (prueba transversal)
**Criterios de aceptación:**
- Suite de tests de integración que crea dos organizaciones y verifica que ningún endpoint de
  Fase 1 permite leer o modificar datos cruzados.
- Este criterio se re-ejecuta y se exige en cada fase posterior que agregue endpoints nuevos.

### F1.10 — Observabilidad mínima
**Criterios de aceptación:**
- `apps/api` y `apps/worker` emiten logs JSON estructurados con `request_id`/`trace_id`.
- Endpoint de salud (`/health`) en API y worker.
- Sentry conectado (sin secretos en los reportes).

## Salida de Fase 1

Fase 1 se considera terminada cuando un usuario puede: registrarse, verificar su correo, iniciar
sesión, crear una organización, invitar a un colaborador con un rol específico, y ver un panel
vacío pero funcional — todo con aislamiento multi-tenant probado y observabilidad básica activa.
Recién entonces se inicia Fase 2 (sitio público y constructor).
