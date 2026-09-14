# CLAUDE.md — Impulza One

Este archivo se carga automáticamente en cada sesión de Claude Code en este repositorio. Contiene
las reglas duras del proyecto. No las repitas al usuario en cada mensaje; simplemente cúmplelas.

## Orden de autoridad documental (si hay contradicción)

1. Instrucción explícita y más reciente del propietario (Favio), en el chat o commit.
2. `docs/02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` (o su copia en la raíz) — cómo construir.
3. `docs/PLAN_MAESTRO_PLATAFORMA_IDENTIDAD_DIGITAL.md` (o su copia en la raíz) — qué construir.
4. Bocetos, referencias visuales y documentos anteriores.

Si detectas una contradicción entre documentos, **detente, avísalo, indica los archivos afectados
y propone una resolución** antes de implementar.

## Orden de lectura y ejecución para cualquier tarea nueva

1. `docs/REQUIREMENTS_TRACEABILITY.md` — qué requisito es, de dónde sale, en qué fase va.
2. `docs/architecture/ARCHITECTURE.md` y `docs/architecture/ERD.md` — cómo encaja técnicamente.
3. `docs/decisions/ADR-001-modular-monolith.md` y `ADR-002-multi-tenancy.md` — decisiones ya
   tomadas, no las reabras sin una razón técnica nueva.
4. `docs/BACKLOG_FASE_0_1.md` (y los backlogs de fases siguientes cuando existan) — el orden exacto
   de historias y sus criterios de aceptación específicos.

No saltar de fase. No empezar una historia de una fase posterior si la fase activa no está
terminada según la Definición de Terminado de abajo.

## Definición de terminado (obligatoria para marcar cualquier historia/fase como completa)

Una historia o módulo **solo** se considera terminado si:

- Cumple los criterios de aceptación específicos del backlog de esa fase.
- Tiene validación del servidor (nunca confiar solo en el frontend).
- Aplica permisos multi-tenant y, si toca datos comerciales, incluye el test de aislamiento entre
  organizaciones (ver ADR-002).
- Incluye estados de carga, vacío, error y éxito en toda UI.
- Es responsive (móvil y escritorio) cuando tiene UI.
- Incluye pruebas relevantes (unitarias/integración/E2E según corresponda) y pasan en CI.
- No genera errores de TypeScript, lint ni build.
- Actualiza OpenAPI si modifica la API.
- Incluye migración de base de datos si cambia el modelo de datos.
- Incluye telemetría adecuada (logs estructurados, métricas, trazas).
- Actualiza la documentación afectada (traceability/arquitectura/ERD/backlog).
- No expone secretos ni datos sensibles.
- Fue probado en staging cuando afecta el despliegue.

**No marques una fase como "completa" solo porque la pantalla se ve bien.** Si falta un criterio,
la historia sigue en progreso y debes decirlo explícitamente.

## No negociables de seguridad (desde el primer commit)

Variables de entorno validadas al iniciar, secretos fuera del repo, hash seguro de contraseñas,
cookies `HttpOnly`/`Secure`/SameSite correcto, CSRF donde corresponda, CORS restrictivo, CSP y
cabeceras de seguridad, rate limiting por IP/usuario/organización, validación de servidor en toda
entrada, sanitización de contenido enriquecido, prevención de XSS/SQLi/SSRF/open-redirect, webhooks
firmados, idempotencia en pagos y jobs importantes, auditoría, dependencias examinadas en CI,
backups cifrados con prueba de restauración. Ver `docs/architecture/ARCHITECTURE.md` §5 para los
contratos/adaptadores de proveedores externos.

## No negociables de UI/UX

Fondo blanco o muy claro, estilo profesional/moderno/elegante, tipografía clara con jerarquía
fuerte, iconos lineales, sombras discretas, bordes moderados, nada excesivamente redondo, evitar
paneles hechos solo de tarjetas grandes, CTA visibles, vista previa protagonista en el constructor,
responsive real, objetivo WCAG 2.2 AA. No copiar la interfaz visual de Linktree, HeyLink, Beacons
ni Stan — son referencias funcionales, no visuales. Usar las skills de diseño disponibles
(`design-system`, `design-critique`, `accessibility-review`, `design-handoff`, `ux-copy`) para
revisar cualquier pantalla antes de darla por terminada.

## Arquitectura y stack (no cambiar sin ADR nuevo)

Monolito modular en monorepo (pnpm + Turborepo), TypeScript estricto, Node 24 LTS. Frontend:
Next.js App Router + React + Tailwind + Radix + shadcn adaptado + Zod + React Hook Form + TanStack
Query/Table + Zustand + dnd-kit + Tiptap + Recharts. Backend: NestJS + REST `/api/v1` + OpenAPI +
Prisma + PostgreSQL 18 + Redis + BullMQ. Ver `docs/architecture/ARCHITECTURE.md` para el diagrama
completo.

**No hacer** (sin decisión explícita nueva del propietario): microservicios, Kubernetes, Kafka,
MongoDB como base principal, GraphQL, HTML/JS arbitrario en páginas públicas, confiar en permisos
del frontend, mezclar datos entre organizaciones, custodiar tarjetas/credenciales de terceros,
publicar cambios de IA sin confirmación del usuario, borrar documentación o trabajo existente,
ejecutar migraciones destructivas sin respaldo y aprobación.

## Al empezar cualquier sesión nueva

1. Lee este archivo completo.
2. Revisa el estado real del repositorio (no asumas nada del historial de chat).
3. Identifica en qué fase/historia del backlog estás.
4. Si vas a tocar algo fuera del backlog activo, dilo explícitamente y pregunta antes de avanzar.
5. Al terminar una historia, valida contra la Definición de Terminado antes de marcarla como hecha.
