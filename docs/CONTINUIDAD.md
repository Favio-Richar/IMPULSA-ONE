# Continuidad del desarrollo (léelo al empezar una sesión nueva, también en la nube)

Este archivo existe para que cualquier sesión de Claude Code —en la máquina de Favio o en la nube,
directo sobre el repositorio— retome el trabajo **sin rehacer nada y sin repetir errores ya
encontrados**. Complementa a `CLAUDE.md` (reglas duras), no lo reemplaza. Actualízalo al cerrar
cada historia: estado, siguiente paso y cualquier trampa técnica nueva.

## 1. Estado al 2026-10-01 (después de F7.7)

- Rama principal: `master` (no `main`). Cada historia es **un commit** con el código en el asunto,
  p. ej. `feat(newsletter): … (F7.4, ADR-019)`, y termina con la línea `Co-Authored-By` que indique
  el sistema.
- **Fase 7 en curso** (`docs/BACKLOG_FASE_7.md`): F7.1–F7.7 listas para revisión del propietario.
  **Sigue F7.8** (tienda: variantes, cupones y carrito). Después F7.9–F7.12 en el orden del backlog. Las historias sin criterios escritos los reciben al
  empezar (como F7.6), con su ADR si hay una decisión de arquitectura.
- ADR más reciente: ADR-022 (modo campaña).
- Fases 0–6 cerradas o en revisión; el detalle de cada historia está en su backlog
  (`docs/BACKLOG_FASE_*.md`, `BACKLOG_PLANTILLAS.md`, `BACKLOG_PAGINA_PREMIUM.md`).
- ADR vigentes: `docs/decisions/` (hasta ADR-022). No reabrir uno sin una razón técnica nueva.

### Decisiones pendientes del propietario (no avanzar sobre ellas sin respuesta)

- Qué planes incluyen medición (F7.1) y webhooks (F7.2) — decisión #4.
- Probar Mercado Pago con una aplicación real (credenciales del negocio de prueba).
- Crear el bucket privado de R2 en producción (descargas pagadas, F5.11b).
- App propia de Zapier (requiere la cuenta de desarrollador de Favio).
- Producción completa (hosting, correo real, backups): bloqueada por hosting.

## 2. Preparar el entorno

**En la nube** el hook `SessionStart` de `.claude/settings.json` corre
`scripts/cloud-session-setup.sh` (solo si `CLAUDE_CODE_REMOTE=true`):

- copia `.env.example` a `.env` y a los `.env.local` de las apps;
- corre `pnpm install`;
- intenta levantar Postgres (55433) y Redis (56380): primero con Docker y, si no hay, con `apt`;
- aplica las migraciones, el seed y la base de pruebas.

**Lee `.claude/cloud-setup.log` antes de correr pruebas**: si dice que Postgres o Redis no
quedaron, las pruebas e2e de `apps/api` y `apps/worker` y `openapi:generate` no van a correr. En ese
caso sí corren tipos, lint, build y las unitarias. Dilo explícitamente al reportar; nunca marques
una historia como terminada con esas pruebas sin correr.

**En local (Windows de Favio):**
- `pnpm` no está en el PATH de las shells de Claude Code: usar
  `node "C:\Users\favio\AppData\Local\node\corepack\v1\pnpm\12.4.1\bin\pnpm.mjs" …`, o un `pnpm.cmd`
  en el scratchpad para Turbo.
- `docker compose up -d` levanta Postgres, Redis y MinIO.

**Servicios de desarrollo** (README, "Arranque local"):

| Servicio | Puerto |
|---|---|
| Panel | 3100 |
| Superadministración | 3200 |
| Página pública | 3300 (dev); 3390 en Playwright, con el build de producción |
| API | 4000 (`/health`) |
| Worker | 4100 (`/health`) |

**Cuentas de desarrollo:** el panel `demo@impulza.cl` (dueño de "Café Aroma"); la
superadministración con 2FA (`pnpm --filter @impulza/api run superadmin -- grant <correo>`). En
desarrollo los correos no se envían: se imprimen en la consola de la API (`email.dev_send`).

## 3. Cómo cerrar una historia (checklist real, en este orden)

1. Criterios en `docs/BACKLOG_FASE_*.md`. Si la decisión es de arquitectura, un ADR nuevo y su fila
   en `docs/decisions/README.md`.
2. Esquemas en `packages/validation` (isomorfos, con pruebas unitarias). Contratos de respuesta en
   `packages/contracts`.
3. Si cambia el modelo: `schema.prisma` + migración **a mano** con `down.sql`. Verificar la
   reversa: aplicar `down.sql`, borrar la fila de `_prisma_migrations`, `migrate deploy`. Después
   `db:generate` y `db:test:prepare` (la base de pruebas es otra: `impulza_test`).
   - **No** correr `prisma format`: reacomoda todo el archivo.
   - En Windows, `prisma generate` falla si la API o el worker están corriendo.
4. API: módulo + e2e del módulo (permisos, validación, **aislamiento entre organizaciones** y
   auditoría) + caso en `src/multi-tenant-isolation.e2e.test.ts` si toca datos comerciales.
5. `pnpm --filter @impulza/api run openapi:generate` y la **suite completa** de `apps/api`.
   `src/openapi/openapi.test.ts` exige agregar toda ruta pública (`/public/...`) a su lista con
   justificación.
6. UI: estados de carga, vacío, error y éxito; teléfono y escritorio; WCAG 2.2 AA. Una prueba de
   Playwright en `packages/e2e/tests/` (proyectos `movil` y `escritorio`), con capturas copiadas a
   `docs/design/capturas/fXX/` **apenas termina la corrida** (cada corrida borra la carpeta
   `.playwright/capturas`).
7. `pnpm turbo run typecheck lint test` y `next build` real del panel y de la web (`tsc` limpio no
   basta, ver §4).
8. Verificar las pruebas nuevas **contra el código roto**: romper la corrección, ver que la prueba
   falla por la razón correcta, restaurar desde una copia (nunca con `git checkout <archivo>`:
   borra lo no commiteado).
9. Marcar la historia en tres lugares: la tabla del backlog, la sección del README y la línea
   "Estado actual" del README. Actualizar el ERD y `docs/REQUIREMENTS_TRACEABILITY.md`.
10. Escanear lo modificado por caracteres de control y BOM (§4). Un commit por historia.

## 4. Trampas técnicas ya encontradas (no repetirlas)

- **Escapes al editar**:
  - Python y los heredocs de bash convierten `\b`, `\n` o `\s` en caracteres reales.
  - Las herramientas de escritura convierten `\uXXXX` en el carácter real: un `"\\u003c"` quedó
    como `"<"` y el escape de JSON-LD no escapaba nada.
  - Para escapes Unicode, generarlos en tiempo de ejecución
    (`String.fromCharCode(0x5c) + "u" + código`) y siempre con una prueba que falle si no escapan.
  - Antes de cada commit, escanear lo modificado por bytes `< 0x20` (salvo `\n\r\t`) y por BOM.
- **Heredocs largos** con comillas, `«»` o backticks a veces no llegan a ejecutarse
  ("unexpected EOF"). Para ediciones grandes: escribir un `.py` con la herramienta de escritura y
  ejecutarlo.
- **Zod 4**:
  - `refine` corre aunque la regex anterior haya fallado: proteger con `if (!match) return true`, o
    un texto mal formado tumba el servidor con un 500.
  - Una `z.union` resume sus errores en "Invalid input". Para campos "enlace o forma guardada" usar
    `embedFromUrlSchema` (`packages/validation/src/blocks/primitives.ts`).
  - En el navegador, Zod va en modo `jitless` (`zod-config.ts`, que se importa primero) por la CSP.
- **Imports en `apps/dashboard` y `apps/web`**: solo `import type` lleva `.js`. Un import de valor
  con `.js` pasa `tsc`, pero rompe Turbopack (`next build`/`dev`).
- **react-hook-form**: un autoguardado por `watch()` debe filtrar `type === "change"`: un `reset()`
  externo también dispara `watch`.
- **CSP de `apps/web`** (`lib/security-headers.ts`):
  - Todo origen nuevo (script, iframe, fetch, redirección) va ahí, con su prueba.
  - `lib/frame-origins.test.ts` cruza cada plantilla de iframe con `frame-src`.
  - En Playwright, juntar las violaciones con `securitypolicyviolation`.
- **Foco tras un envío**: moverlo con un `useEffect` después de pintar, no con
  `requestAnimationFrame` (a veces se pierde: lo encontró Playwright en F7.4).
- **Pruebas inestables bajo carga**: timeout de Prisma (P2028), puertos agotados (ENOBUFS) o TOTP.
  Si una prueba que no toca lo cambiado falla en la corrida completa, correrla aislada antes de
  tratarla como regresión.
- **`vite-node --watch` de la API** se cae tras varias ediciones o cuando se recompila un `dist`
  ("Nest can't resolve dependencies"). Reiniciarla; no es un bug del código.
- **Pruebas que usan el worker de desarrollo**: el worker real procesa las colas de las pruebas
  e2e. Las URL de prueba usan dominios inexistentes (`*-nx.com`) para no salir a internet.
- **Prisma**: un valor nuevo de un `enum` no se puede usar en la misma migración que lo crea.
- **Next.js tiene su propio `role="alert"`** (el anunciador de rutas): en Playwright, filtrar las
  alertas por texto.
- **Un servidor de desarrollo con horas de uso** puede fallar al compilar una ruta nueva ("Jest worker
  encountered … child process exceptions"). Reiniciarlo; no es un error del código.

- **`next build` de `apps/web` necesita la API encendida**: la portada consulta las plantillas al
  prerenderizar (desde `131cead`). Sin la API en el 4000 falla con `ECONNREFUSED` (también en CI si
  se corre `pnpm build` sin servicios). Pendiente de decisión: tolerar la API caída en ese fetch.
- **`pkill -f` con un patrón que aparece en el propio comando** mata la shell que lo ejecuta (código
  144). Para reiniciar la API, lanzarla en otra llamada con `setsid nohup …`.
- **En la nube**, si el `.env` local es de una sesión anterior, puede faltarle una variable nueva
  (`DASHBOARD_BASE_URL`, `WEBPAY_*`): regenerarlo desde `.env.example` (valores de desarrollo).
- **Node 22 en el PATH de la nube**: `pnpm turbo …` falla con "Exec format error (os error 8)"
  al lanzar tareas. Anteponer Node 24: `export PATH=/opt/node24/bin:$PATH`.
- **Nombres accesibles en Playwright**: un campo `required` se llama "Nombre *" (el asterisco entra
  en el nombre), y un `<label>` que envuelve la casilla y su explicación le da todo ese texto como
  nombre. Etiquetas cortas con `htmlFor` y la explicación por `aria-describedby`.
- **Sujeto de los eventos del servidor**: `order_created` y `booking_created` guardan como sujeto el
  producto y el servicio (agregados por producto); el pedido o la reserva están en la clave de
  idempotencia (`order_created:<id>`). Así cruza el pago el embudo (ADR-021).

## 5. Reglas del propietario que no están en el código

- Responder en español, directo y completo. "Links del sistema" significa la tabla de los cinco
  servicios con sus puertos.
- Desarrollo completo y profesional, nunca "básico": diseño moderno y sobrio en el panel, el
  estilo enlace-en-bio de ADR-008 en la página pública, y pruebas de verdad.
- No apagar servidores sin avisar. No hacer `push --force`. No borrar trabajo ni documentación.
