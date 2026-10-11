# Continuidad del desarrollo (léelo al empezar una sesión nueva, también en la nube)

Este archivo existe para que cualquier sesión de Claude Code —en la máquina de Favio o en la nube,
directo sobre el repositorio— retome el trabajo **sin rehacer nada y sin repetir errores ya
encontrados**. Complementa a `CLAUDE.md` (reglas duras), no lo reemplaza. Actualízalo al cerrar
cada historia: estado, siguiente paso y cualquier trampa técnica nueva.

## 0. RETOMAR AQUÍ (2026-10-11) — **F9.6 y F9.7 completas** (a–e) en la rama `fase-9/f9-6-equipo-avanzado`; siguiente: F9.8 (reportes por cliente)

**F9.7 (marca blanca) cerrada en cinco commits** (detalle y reservas en `docs/BACKLOG_FASE_9.md`): **a** marca blanca de la agencia + cascada con dos audiencias (`team`/`customer`, ver nota en ADR-028); **b** correos con cabecera
legal y remitente solo con dominio verificado; **c** plantillas privadas (`Template.organizationId`); **d** dominio del portal de la agencia (`AgencyDomain`, `GET /public/portal/:hostname`); **e** portal del cliente (rol
`CLIENT_VIEWER`, lista de rutas permitidas en la puerta única, comentarios).
**Trampas nuevas:** toda lectura de `templates` debe filtrar `organizationId: null` (catálogo) o los dueños visibles; un rol nuevo exige `db:seed` y agregarlo a `KNOWN_ROLE_NAMES` (permissions.test), `RESERVED_ROLE_NAMES` y
`ASSIGNABLE_ROLES`; si un módulo usa `PlatformBrandingService` debe importar `PlatformBrandingModule`; `prisma generate` exige parar API y worker; los scripts de edición con `\n` escritos por heredoc se rompen: usar la
herramienta Write.

**Siguiente — F9.8 (reportes por cliente):** leer el criterio en `docs/BACKLOG_FASE_9.md` (informe por cliente con comparación de periodos, programación por cola, exportación CSV/imprimible, enlace compartido con token de
alta entropía y vencimiento). Cuando exista, abrir `reports` en la lista permitida del visor (`clientViewerVerdict`). **No tocar `apps/api` mientras corre su suite completa.**

**Claude desarrolla F9.3 a F9.10 él mismo** (decisión de Favio, 2026-10-03), una historia por vez, con commit por historia y **push de la rama al cerrar cada una** (autorizado por Favio; ver memoria «Subir cada fase a GitHub»). Fusionar a `master` sigue pidiendo confirmación.

**F9.5 hecha** (detalle y reservas en `docs/BACKLOG_FASE_9.md`): **a** facturación (`AGENCY_PAYS` = el negocio usa los límites del plan de la agencia, sin cobrar nada nuevo), **b** transferir (el
propietario siempre consiente), **c** duplicar (cliente nuevo en borrador, sin datos personales ni archivos del origen) y **d** importar CSV (cola BullMQ procesada por el worker, informe por fila,
idempotente, con cupo). **Siguiente: F9.6** (equipo avanzado: roles personalizados, acceso por cliente y módulo, aprobación antes de publicar).
**Novedad de arquitectura:** existe el paquete **`@impulza/agency`** (alta de cliente, acceso delegado, correo de invitación e importación) que comparten la API y el worker; la API ya no tiene su propia
copia. Al agregar un paquete al workspace: declararlo en el `package.json` de quien lo usa, `pnpm install --prefer-offline` (cambia `pnpm-lock.yaml`, hay que commitearlo) y recompilarlo (`pnpm turbo run build
--filter=@impulza/agency`) antes de correr pruebas del worker, que lo leen compilado.
**Trampas nuevas:** `response.text()` de `fetch` **descarta el BOM** (para CSV con tildes decodificar los bytes con `TextDecoder(..., { ignoreBOM: true })`); el cuerpo JSON por defecto de la API es de 100 kB
(con acentos a 2 bytes: topes de texto por debajo de eso); la reserva de nombres (`www`, `planes`…) es del identificador público de un **sitio**, no del de una organización; el registro de cuentas tiene límite
de 5 por minuto (los specs usan `packages/e2e/register-user.ts`); un `<label>` que envuelve un `<select>` toma como nombre accesible todas sus opciones (poner `aria-label`); **no correr `prisma format`**
sobre `schema.prisma`; en los heredocs de Bash con acentos el shell puede rechazar todo el comando (escribir los scripts con la herramienta Write); las claves de almacenamiento de medios llevan `/org/<id>/`;
`apps/api` usa `testTimeout` de 15 s; en PowerShell, `2>&1 | Select-String` sobre salidas ruidosas oculta el resumen: redirigir a un archivo y leer solo las líneas útiles.

**F9.4 — panel de agencia (cerrada con reservas; detalle en `docs/BACKLOG_FASE_9.md`):** resumen y tabla de clientes con rendimiento, plan, dominios, última
publicación y alertas; solo suma clientes `ACTIVE`; búsqueda/filtro/orden/paginación en el servidor; 200 clientes en ~55 ms. **Reservas:** «tareas del equipo»
no existe en el modelo (falta decidir si se construye); las alertas de suscripción/pago no se muestran por el límite duro del ADR-028 (llegan con F9.5 para
`AGENCY_PAYS`); no se ordena por métricas. **Siguiente: F9.5** (importar, duplicar, transferir, facturación).

**F9.3 — cerrada** (detalle, mutaciones y reservas en `docs/BACKLOG_FASE_9.md`): modelo de agencia, acceso delegado (membresía `AGENCY` evaluada
en cada petición por `OrganizationMembershipGuard` + `delegatedAccessVerdict`), alta de clientes por dos caminos, pausa/archivo/soltar/revocar,
**ocultar el sitio público al pausar/archivar (`public_hidden_at`, reversible)**, panel (`/agencia`, `/configuracion/agencia`,
`/invitaciones/agencia`), selector con grupo de clientes y aviso permanente, inicio propio para quien entra a un cliente. Verificada: suite
completa 70/70, builds, OpenAPI, Playwright 4/4, aislamiento 84/84.
**Pendiente de Favio:** fusionar la rama a `master` y subirla (no se hizo sin tu confirmación). Luego F9.4 (panel de agencia: vista consolidada).

**Trampas nuevas de esta sesión:** (1) un controlador de Nest que devuelve `null` responde **cuerpo vacío**: si el contrato dice `null`, usar
`@Res()` y `res.json(valor)`; (2) la lista de miembros se niega a la agencia a propósito: ninguna pantalla que cargue un cliente delegado debe
pedirla; (3) cualquier filtro nuevo de «superficie pública» va en `ACTIVE_ORGANIZATION`, nunca suelto; (4) la mutación de una capa redundante
(p. ej. el veredicto con la membresía ya ausente) no la detecta la e2e: poner también prueba unitaria; (5) Playwright registra 2 cuentas por
corrida: limpiar `ratelimit:*` del Redis local entre corridas (`docker exec impulza-one-redis-1 redis-cli --scan --pattern "ratelimit:*"`);
(6) tras cambiar permisos/planes: `db:migrate:deploy`, `db:generate`, `db:seed`, `db:test:prepare` y reconstruir `validation`, `contracts`,
`database`, `auth`; (7) con Docker apagado hay que abrir Docker Desktop (`C:\Program Files\Docker\Docker\Docker Desktop.exe`) y esperar a `docker info`.

### (anterior) F9.2 hecha y fusionada a master; siguiente era F9.3

**Revisión de Claude de F9.2 (2026-10-03): NO se aprobó tal cual; Claude corrigió los defectos en la misma rama.**
Encontrados contra la API real: (1) **`resolveBrand` no se usaba en ninguna parte** (el criterio 4a/4b exige páginas nuevas y correos de la
organización con su marca); (2) la subida de logos de la organización volvía a dar **413 con archivos > ~75 KB** (la corrección de F9.1 solo cubría la
ruta de la plataforma); (3) un usuario podía guardar como logo **cualquier URL externa** (píxel de rastreo) o la de otra organización; (4) ~60 líneas
de validación de subida **copiadas** de F9.1, y dos copias de las funciones de seguridad de URLs (`index.ts` y `common.ts`); (5) 4 advertencias de lint
nuevas y etiquetas de los campos de archivo sin asociar (accesibilidad).
**Correcciones:** la cascada vive en UN lugar (`cascadeBrand`/`resolveOrganizationBrand` en `@impulza/validation`) y la usan API y worker;
`applyOrganizationBrandDefaults` (nombre visible + logo como avatar en las páginas nuevas, solo con valores propios de la organización);
`brandEmail` (nombre, logo, color y contacto de la marca en lo que la organización envía a SUS clientes: reservas, pedidos, newsletter,
campañas y secuencias —API y worker—; el remitente real no se toca hasta F9.7); `prepareBrandingAsset` compartido entre la plataforma y las
organizaciones; límite de subida para ambas rutas **solo con sesión real** (consulta a la base de datos, no basta una cookie inventada);
logos **solo de su propio espacio** de almacenamiento (`branding/org/<id>/`); lectura del perfil con `upsert` (sin carrera); `GET
/organizations/:id/brand-profile/resolved`; funciones de URLs consolidadas en `common.ts`.
**Pruebas:** validación 707, e2e de la API (brand-profile 27), Playwright 6/6 (incluye subir un logo real de ~190 KB), y 5 mutaciones que hacen fallar
sus pruebas (valores por defecto, correo con marca, logos externos, límite de la ruta de la organización, límite sin sesión real).
**Límites que siguen vigentes (honestidad):** la aplicación de la marca a páginas se prueba por API y unidad (no por Playwright del onboarding); los
correos de plataforma a la organización (cobros, soporte, acceso) conservan la marca de la plataforma a propósito; los avisos a los dueños tampoco
llevan la marca; el remitente sigue siendo el de la plataforma hasta F9.7 (dominio verificado); no hay proveedor de correo real (solo consola). Las
pruebas lentas de la API (newsletter, auth, dominios, calendario, marca de plataforma) fallan por tiempo **solo cuando se corren muchas a la vez** y
pasan solas (ver «Tests flaky bajo carga»).
**Siguiente paso:** Antigravity desarrolla **F9.3** (modelo de agencia y acceso delegado: la historia más delicada, ADR-028 §2) en una rama nueva
`fase-9/f9-3-modelo-agencia` creada desde `master`; Claude la revisa antes de fusionar.

**F9.2 (Marca de cada organización) — lo que entregó Antigravity (antes de la revisión):**
- Desarrollada en rama dedicada `fase-9/f9-2-marca-organizacion`.
- Modelo `BrandProfile` en PostgreSQL (`packages/database`), migración `20261002230000_f92_brand_profile` desplegada en `impulza` e `impulza_test` con script de reversa `down.sql`. Crea un registro vacío por organización existente para no romper datos previos.
- Validación Zod en `@impulza/validation`: `brandProfileSchema`, `updateBrandProfileSchema` con contraste WCAG 2.2 AA (>= 4.5:1 sobre fondo claro #ffffff), saneamiento SVG y URLs seguras HTTPS. `resolvedBrandSchema` para la cascada.
- Utilidades compartidas en `packages/validation/src/branding/common.ts` para evitar dependencias circulares.
- Contratos en `@impulza/contracts` con prueba de paridad de claves y tipos (`src/brand-profile.test.ts`, 2 pruebas en verde).
- API en `apps/api`: `BrandProfileModule`, `BrandProfileService` y `BrandProfileController`. Endpoints bajo `/api/v1/organizations/:organizationId/brand-profile` protegidos con `CsrfGuard`, `SessionAuthGuard`, `OrganizationMembershipGuard`, `PermissionGuard` (`PERMISSIONS.THEME_MANAGE`) y `RateLimitGuard` (`GET`, `PUT`, `POST upload`).
- Cascada de marca `resolveBrand(organizationId)` implementada como única fuente de verdad (ADR-028 §4) con suite unitaria completa (`brand-profile.service.test.ts`, 5/5 pruebas en verde cubriendo todas las combinaciones presente/ausente).
- Aislamiento multi-tenant estricto (ADR-002): el servidor rechaza cualquier acceso cruzado (403 Forbidden por membresía inactiva o inexistente). Suite e2e en `brand-profile.e2e.test.ts` (11/11 en verde) y caso transversal añadido en `multi-tenant-isolation.e2e.test.ts` (83/83 en verde).
- OpenAPI regenerado (`docs/api/openapi.json`: 220 rutas, 297 operaciones) con `openapi.test.ts` pasando 4/4.
- UI en `apps/dashboard/app/(panel)/configuracion/marca/page.tsx`: formulario reactivo con estados de carga (`LoadingState`), error (`ErrorState`) y vacío (`EmptyState`) de `@impulza/ui`, vista previa interactiva en vivo, cálculo en tiempo real de contraste AA, subida de logos y favicon, persistencia con TanStack Query y guardado con validación.
- Enlace en navegación lateral del panel (`SidebarNav`) con icono de paleta hacia `/configuracion/marca`.
- Pruebas Playwright en `packages/e2e/tests/brand-profile.spec.ts`: móvil (Pixel 7) y escritorio (1440px) 2/2 en verde. 8 capturas guardadas en `docs/design/capturas/f92/`.
- `next build` en producción de `apps/dashboard`: compila en verde con código 0.
- `typecheck` y `lint` limpios en todos los paquetes afectados.

**F9.1 (Marca de la plataforma) — Aprobada y fusionada a master:**
- Desarrollada en rama dedicada `fase-9/f9-1-marca-plataforma`.
- Modelo `PlatformBranding` singleton en PostgreSQL (`packages/database`), migración `20261002120000_f91_platform_branding` desplegada y documentada en `docs/architecture/ERD.md` (§9s). Con seed oficial de Impulza One.
- Validación Zod en `@impulza/validation` con verificación estricta de contraste WCAG 2.2 AA (>= 4.5:1 sobre fondo claro #ffffff), saneamiento exhaustivo de SVG (bloqueo de scripts, eventos inline, entidades externas/XXE, foreignObject y URLs no seguras), y validación de tipos MIME y URLs HTTPS.
- Contratos Zod en `@impulza/contracts` con prueba de paridad de claves y formas (`src/branding.test.ts`).
- Endpoints en `@impulza/api`: público `GET /api/v1/platform/branding` (con rate limiting y caché Redis con invalidación) y superadministración protegidos por `AdminSessionGuard`, `CsrfGuard` y `RateLimitGuard` (`GET`, `PUT`, `POST reset`, `POST upload`).
- OpenAPI regenerado (`docs/api/openapi.json`: 218 rutas, 294 operaciones) y pruebas de OpenAPI en verde (4/4).
- Suite e2e de la API en `@impulza/api`: `platform-branding.e2e.test.ts` (11/11 pruebas en verde), verificada contra código roto.
- UI en `apps/admin` (`/marca`): formulario de configuración, vista previa en tiempo real en cabecera clara, panel oscuro, correo transaccional y medidor de contraste AA; subida de archivos; restablecimiento con confirmación.
- Consumidores integrados: `apps/web` (layout metadata, header, footer con fallback a defaults) y `apps/dashboard` (metadata, auth layout, auth mosaic, aside y drawer con fallback).
- Pruebas Playwright en `packages/e2e/tests/platform-branding.spec.ts`: móvil (412px Pixel 7) y escritorio (1440px Desktop Chrome) 2/2 en verde. 8 capturas guardadas en `docs/design/capturas/f91/`.
- `next build` en producción de `apps/web`, `apps/dashboard` y `apps/admin`: los tres pasan con código 0.
- `lint` y `typecheck` limpios en todos los paquetes tocados.
- **Revisión de Claude (2026-10-02): F9.1 NO se aprobó tal cual y Claude corrigió los defectos en la misma rama.**
  Encontrados con pruebas contra la API real: (1) la subida de logos daba 413 con archivos > ~75 KB; (2) el
  «saneador» de SVG (lista de prohibidos) se saltaba con 4 payloads (entidad `&#106;avascript:`, `<animate>`,
  `<set>`, `<iframe>`); (3) `http://localhost.evil.com` pasaba como localhost; (4) cambió `fetchCatalog` de la
  portada para tragarse errores (fuera de alcance); (5) los enlaces legales, el color y el remitente no se usaban,
  y la marca solo llegaba a la portada (las otras 8 páginas comerciales seguían fijas); (6) dominio y remitente
  inventados (`impulza.app`); (7) tabla sin garantía de fila única y 4 advertencias de lint nuevas.
  **Correcciones:** subida con límite propio solo para esa ruta y solo con cookie de administración
  (`apps/api/src/common/branding-upload-body.ts`); `sharp` decodifica y valida dimensiones; saneador de SVG por
  **lista de permitidos que reconstruye el SVG** (`packages/validation/src/branding/svg.ts`); URLs por hostname exacto
  (`isSafeAssetUrl`/`isSafeLinkUrl`), enlaces internos permitidos; remitente opcional y usado en los correos de
  verificación/recuperación (`EmailMessage.from`); `fetchCatalog` revertido; encabezado y pie comerciales piden la
  marca en todas las páginas; color de marca aplicado a la interfaz del panel y de administración
  (`brandCssVariables`, valida el hexadecimal antes de interpolar); migración `20261002200000` (fila única, sin datos
  inventados). Pruebas nuevas: validación (36), e2e de la API (27) con los ataques y la subida de 1 MB.
- **Límites que siguen vigentes (honestidad):** el color de marca no cambia las páginas comerciales de `apps/web`
  (usan colores fijos); los correos de campañas, reservas y demás no usan aún `from` (no hay proveedor real de correo
  todavía: solo `ConsoleEmailAdapter`); el SVG no se sirve con `Content-Security-Policy: sandbox` porque el adaptador de
  almacenamiento no permite cabeceras por objeto (la defensa es el saneador); el logo oscuro no se usa en ninguna
  pantalla todavía.
- **Estado final de F9.1:** aprobada por Claude tras las correcciones (turbo typecheck/lint/test en verde, builds de
  dashboard y admin, Playwright 2/2 y 3 mutaciones que hacen fallar las pruebas). Fusionada a `master`.
- **Siguiente paso:** Antigravity desarrolla **F9.2** (marca de cada organización) en una rama nueva
  `fase-9/f9-2-marca-organizacion` creada desde `master`; Claude la revisa. Reutilizar `resolveBrand`, `brandCssVariables`,
  `sanitizeSvg`, `isSafeAssetUrl` y `brandingUploadBody` de F9.1 en vez de duplicarlos.

**Fase 8: commiteada y subida** (`b418cb5`…`2df931d`, rama `master`). Queda con las reservas descritas abajo.

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
