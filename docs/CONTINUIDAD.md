# Continuidad del desarrollo (léelo al empezar una sesión nueva, también en la nube)

Este archivo existe para que cualquier sesión de Claude Code —en la máquina de Favio o en la nube,
directo sobre el repositorio— retome el trabajo **sin rehacer nada y sin repetir errores ya
encontrados**. Complementa a `CLAUDE.md` (reglas duras), no lo reemplaza. Actualízalo al cerrar
cada historia: estado, siguiente paso y cualquier trampa técnica nueva.

## 0. RETOMAR AQUÍ (2026-10-02, noche) — Fase 8 commiteada; Fase 9 definida y lista para Antigravity

**Fase 8: commiteada y subida** (`b418cb5`…`2df931d`, rama `master`). Queda con las reservas descritas abajo.

**Fase 9 «Marca y agencias»: definida, sin código.** Lo escribió Claude el 2026-10-02:
`docs/decisions/ADR-028-agencias-marca-blanca-y-marca-configurable.md` (resuelve las decisiones #8 y #9),
`docs/BACKLOG_FASE_9.md` (F9.1–F9.10 con criterios y reglas transversales) y
`docs/PROMPT_ANTIGRAVITY_FASE_9.md` (texto para pegar a Antigravity). **Quién hace qué:** Antigravity
desarrolla una historia a la vez, en orden; Claude la revisa contra la Definición de Terminado y recién
entonces la marca «Hecho». Siguiente paso: **F9.1 (marca de la plataforma)**. Modelo actual sin marca:
`Organization` no tiene logo ni colores y no hay configuración del dueño; F9.1 y F9.2 lo resuelven.
Faltantes del plan maestro que **no** entran en la Fase 9: membresías y cursos, wallet, PWA, marketplace
(ver «Hoja de ruta posterior» del backlog).

### Estado de la Fase 8 (detalle)

**Estado real:** la Fase 7 está cerrada y commiteada (`cdb4ea6`). La **Fase 8 (F8.1–F8.4) quedó verificada** el 2026-10-02 y está **commiteada y subida**. Antigravity dejó el código sin pruebas de interfaz; Claude lo revisó, corrigió y probó.

**Corregido por Claude:**
- `packages/contracts/src/templates.ts`: faltaba `"educacion"` (rompía el `next build` de la web). Prueba `apps/api/src/modules/templates/templates-contract.test.ts` (verificada contra código roto).
- `docs/api/openapi.json` regenerado con el rubro `educacion` (lo detectó `openapi.test.ts`; Antigravity no lo había hecho).
- Borrado de bloques: si el servidor rechazaba, el bloque quedaba con `opacity-0` y sin clics; ahora se restaura (`onDelete(blockId, onFailed)`).
- Plantilla "Músico y banda": se quitó "venta de entradas" (el sistema solo enlaza a una venta externa).
- La prueba que "se colgaba" no era un defecto del código: tras un borrado fallido el `ConfirmButton` sigue abierto y la prueba buscaba el botón «Eliminar bloque», que ya no existe. Se corrigió la prueba (reintenta con «Sí»).

**Verificado (2026-10-02):** `pnpm turbo run typecheck lint test`: todo en verde salvo `openapi.test.ts`, ya corregido y en verde. Playwright **22/22** (`experiencia-animaciones.spec.ts`, `onboarding-animaciones.spec.ts`; móvil y escritorio, con y sin movimiento reducido). Las de foco del onboarding y de borrado fallido se verificaron contra el código roto. Capturas en `docs/design/capturas/f81` a `f84`. `next build` de la web (dentro de Playwright) y del panel.

**Pendiente:**
1. ~~Commits~~ Hecho: 5 commits subidos a `origin/master` el 2026-10-02.
2. **Decisión del propietario:** se ajustaron dos criterios (ver `docs/BACKLOG_FASE_8.md`): F8.2 criterio 1 (el paso saliente NO se desvanece) y F8.1 criterio 6 (los toasts NO tienen salida animada). Confirmar o pedir que se implementen.
3. **Reservas honestas** (detalle en el backlog): F8.1 criterio 8 (CLS) sin medir; `Reveal` usa `threshold`, no `rootMargin -10%`; sin contadores en la portada (no aplica); sin staging.
4. **Corrida completa de Playwright** (toda la suite) antes de dar la fase por cerrada en CI.

**Lección para Antigravity:** `typecheck` y `lint` limpios **no** detectan un contrato duplicado ni un OpenAPI desactualizado; hay que correr el build, la suite completa y las pruebas de interfaz antes de marcar algo como listo. No marcar nada sin Playwright y capturas, y no tocar archivos ajenos a la historia.

**Servicios en esta máquina:** API 4000 y worker 4100 en `ok`; panel 3100, administración 3200 y sitio público 3300 arriba (se levantaron a mano; `vite-node --watch` de la API se cae al regenerar Prisma o recompilar paquetes: reiniciarla). Docker (Postgres, Redis, MinIO) arriba. Variables nuevas ya en el `.env` local: `WEB_APP_URL`, `WEB_REVALIDATE_SECRET`, `WORKER_HEALTH_URL`.

**Decisiones pendientes del propietario (no bloquean la Fase 8):** política de privacidad (razón social, RUT, domicilio, correo y revisión de un abogado); aplicación OAuth de Google (`GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, con retorno `<APP_BASE_URL>/integraciones/google-calendar`); vencimiento de los enlaces firmados de reserva; planes con medición y webhooks; Mercado Pago real; bucket R2; app de Zapier; hosting de producción (sin él no hay correo real, backups con prueba de restauración ni staging).

## 1. Estado al 2026-10-02 (Fase 8 en progreso; ver §0)

- Rama principal: `master` (no `main`). Cada historia es **un commit** con el código en el asunto,
  p. ej. `feat(experiencia): … (F8.X, ADR-027)`, y termina con la línea `Co-Authored-By` que indique
  el sistema.
- **Fase 8 en progreso, sin commit** (`docs/BACKLOG_FASE_8.md`, `ADR-027`). Lo siguiente describe lo que Antigravity implementó, **no** lo verificado (ver §0):
  - **F8.1 (Microinteracciones en constructor y panel):** clases `.motion-fade` y `.motion-slide-left` añadidas en `globals.css` bajo `prefers-reduced-motion: no-preference`. Entradas `.motion-rise` al crear y duplicar bloques en `BlockCanvas`. Salida suave de 300 ms con `opacity-0` en `BlockRow` antes de desmontar. Panel lateral con entrada `motion-slide-left`. Indicadores de guardado y publicación con `.motion-pop` y check verde. Typecheck y lint en `@impulza/dashboard` limpios (0 errores).
  - **F8.2 (Transiciones animadas en el onboarding):** contenedor del paso con `.motion-fade` y foco automático en el título. Efecto hover lift en `ChoiceCards` con `translateY(-2px)` y sombra suave. Entrada escalonada de tarjetas de plantilla en `TemplateGallery` (`animationDelay: index * 60ms`). Indicador de completitud de tareas de publicación con `.motion-pop`.
  - **F8.3 (Animaciones de scroll en el sitio comercial):** componentes `Reveal` integrados en las tarjetas del directorio de `/integraciones` y en las guías y herramientas de `/recursos`. Actualizado `soluciones.ts` para apuntar a la plantilla real de educación. Typecheck y lint en `@impulza/web` limpios (0 errores).
  - **F8.4 (Plantillas nuevas por rubro):** agregada industria `educacion` a `TEMPLATE_INDUSTRIES`. 4 plantillas nuevas reales en `TEMPLATE_CATALOG`: "Academia y talleres" (`academia-talleres`), "Fitness y entrenamiento" (`fitness-entrenamiento`), "Músico y banda" (`musico-banda`), y "Restaurante con menú" (`restaurante-menu`), utilizando bloques avanzados (`booking`, `catalog`, `pricing`, `events`, `music`, `video`, `map`, `gallery`, `newsletter`). Suite de 65 pruebas unitarias en verde (`catalog.test.ts`), verificadas contra el código roto y paquete `@impulza/validation` compilado.
- ADR más reciente: ADR-027 (animaciones y microinteracciones para la Fase 8).
- Fases 0–7 cerradas o en revisión; el detalle de cada historia está en su backlog
  (`docs/BACKLOG_FASE_*.md`, `BACKLOG_PLANTILLAS.md`, `BACKLOG_PAGINA_PREMIUM.md`).
- ADR vigentes: `docs/decisions/` (hasta ADR-027). No reabrir uno sin una razón técnica nueva.

### Decisiones pendientes del propietario (no avanzar sobre ellas sin respuesta)

- Qué planes incluyen medición (F7.1) y webhooks (F7.2) — decisión #4.
- Probar Mercado Pago con una aplicación real (credenciales del negocio de prueba).
- Crear el bucket privado de R2 en producción (descargas pagadas, F5.11b).
- App propia de Zapier (requiere la cuenta de desarrollador de Favio).
- Producción completa (hosting, correo real, backups): bloqueada por hosting.
- Política de privacidad pública (`/privacidad`): datos del responsable (razón social, RUT, domicilio), correo
  de privacidad real y revisión legal antes de publicar. El texto actual es un borrador técnico.
- Aplicación OAuth de Google (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`): hasta tenerla, Google Calendar
  figura como "Próximamente" en `/integraciones`; al conseguirla, probar de punta a punta y pasarlo a "Disponible".

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
- **Capturas de Playwright**: cada corrida vacía `packages/e2e/.playwright` (es su `outputDir`),
  capturas incluidas. Copiarlas a `docs/design/capturas/fXX/` apenas termina la corrida de la
  historia, antes de correr cualquier otra prueba de Playwright.
- **`position: fixed` en la página pública no funciona**: el `@container` de `page-blocks.tsx` (y la
  animación de entrada de cada bloque) lo atrapan. Una barra al pie va `sticky` en el contenedor del
  final de la página (ahí están la acción principal y el carrito); en Playwright, comprobar con
  `toBeInViewport()`, no solo que exista.
- **Rutas públicas nuevas**: `apps/api/src/openapi/openapi.test.ts` tiene la lista cerrada de
  operaciones sin sesión. Una ruta pública nueva se agrega ahí, con su justificación en un comentario.
- **Pedidos con líneas (F7.8a)**: todo pedido nuevo crea sus `order_items` en la misma transacción.
  Una prueba que cree pedidos a mano con Prisma no tiene líneas (el panel muestra `items: []` y
  cancelar no mueve stock): para probar stock, crear el pedido por la API pública.
- **Sujeto de los eventos del servidor**: `order_created` y `booking_created` guardan como sujeto el
  producto y el servicio (agregados por producto); el pedido o la reserva están en la clave de
  idempotencia (`order_created:<id>`). Así cruza el pago el embudo (ADR-021).
- **Borrar un profesional (F7.9)**: `bookings.staff_id` es `SET NULL` y `bookings_no_overlap` cuenta
  `NULL` como "sin profesional", así que el borrado se rechaza con 409 si quedan reservas
  `CONFIRMED`/`PENDING_PAYMENT`. Cualquier recurso nuevo que entre en esa restricción necesita la misma
  guarda. Las pruebas e2e de la API no limpian la base entre tests: filtrar por el id exacto, no por
  nombre (otro test pudo crear "Dra. Uno").
- **Secretos en la URL (F7.9c)**: el token del feed iCal viaja en el path y el log de cada petición
  escribía la URL completa. `apps/api/src/common/redact-path.ts` oculta el token en logs y Sentry; todo
  secreto nuevo en un path debe agregarse ahí, con su prueba.
- **OAuth con terceros**: el `state` va firmado (HMAC) y atado a usuario, organización y sitio, y la
  dirección de retorno es una sola ruta fija del panel (el proveedor la exige registrada exacta). No
  reutilizar el patrón del `state` sin firma. Las pruebas del proveedor se hacen con `fetch` simulado
  (ver `google-calendar.service.test.ts`); la prueba real necesita credenciales del propietario.
- **No confiar en "verificado al 100%" de otra sesión**: Antigravity entregó F7.9c afirmando tipos y lint
  limpios con un `tsc` roto, una sincronización que nadie llamaba y un panel que no completaba el
  retorno de Google. Antes de marcar algo, correr `typecheck` y `lint` uno mismo y buscar con grep que lo
  nuevo se llame de verdad (una función sin llamadas es código muerto).
- **Mutaciones sobre archivos nuevos**: para probar una prueba contra el código roto en un archivo sin
  commitear no sirve `git checkout`; copiar el archivo antes y restaurarlo desde la copia.
- **Contenido comercial = promesa**: todo texto público (`apps/web/lib/marketing/*`) debe poder señalarse
  en el producto. Verificar nombres de plantillas contra `TEMPLATE_CATALOG`, eventos y cabecera de webhooks
  contra `@impulza/validation` / `@impulza/webhooks`, y bloques contra `BLOCK_TYPES`. Un test que solo
  comprueba "no vacío" no atrapa nada: cruzar con la fuente real (ver `marketing-pages.test.ts`).
- **No cortar `pnpm turbo` con `Select-Object -First N`**: cierra el pipe y mata el proceso (exit 255).
  Redirigir toda la salida a un archivo y leerlo después.
- **Un interruptor sin consumidores engaña** (F7.11): toda bandera nueva debe tener rutas reales que la consulten (`FeatureFlagGuard` + `@RequireFeature`) y una prueba e2e de efecto, no solo "se guarda en la base". Las listas de nombres que se usan para actuar sobre algo real (colas, plantillas) se comparan en un test con la fuente de verdad del código.
- **La auditoría de seguridad es un test, no una lista**: las reglas (límite de peticiones con su guard, redacción de tokens de la URL, permisos en rutas mutantes) viven en `apps/api/src/security-audit.test.ts` y se aplican a cada ruta nueva. Si agregas una ruta pública, un token en la ruta o una ruta de organización sin permiso, ese test falla y dice cuál; solo se añade a la lista de excepciones con su justificación.
- **Los enlaces firmados no vencen**: reserva (`/public/bookings/:token`), baja de correo, descarga y estado de pedido son `id.firma` HMAC **sin vencimiento** y no se revocan uno a uno (solo rotando `BOOKING_LINK_SECRET`, que invalida todos). Hoy no exponen datos personales del cliente, pero no afirmar "vigencia" en documentos. Es una decisión pendiente del propietario.
- **Lint de la API ≠ el archivo que crees**: el error `no-unused-vars` apunta a una línea concreta;
  buscar el símbolo con grep antes de borrar un import (un `type` importado en dos archivos).

## 5. Reglas del propietario que no están en el código

- Responder en español, directo y completo. "Links del sistema" significa la tabla de los cinco
  servicios con sus puertos.
- Desarrollo completo y profesional, nunca "básico": diseño moderno y sobrio en el panel, el
  estilo enlace-en-bio de ADR-008 en la página pública, y pruebas de verdad.
- No apagar servidores sin avisar. No hacer `push --force`. No borrar trabajo ni documentación.
