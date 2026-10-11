# Backlog — Fase 9: Marca y agencias

> Marca configurable por el dueño de la plataforma y por cada organización; modo agencia; marca
> blanca; reportes por cliente; moderación. Desarrolla **Antigravity**; **Claude revisa** cada historia
> contra la Definición de Terminado de `CLAUDE.md` antes de darla por hecha.

## Decisiones de arquitectura

| ADR | Título | Estado |
|---|---|---|
| [ADR-028](./decisions/ADR-028-agencias-marca-blanca-y-marca-configurable.md) | Agencias, marca blanca y marca configurable | Aceptado |

Resuelve las decisiones #8 (alcance de agencia: F6.8 y F6.9) y #9 (moderación). **Léelo completo antes
de escribir código**: fija el modelo, los límites de la delegación y la cascada de marca.

## Historias (en este orden; no saltar)

| Historia | Título | Estado |
|---|---|---|
| F9.1 | Marca de la plataforma (el dueño del sistema configura todo) | Hecho (2026-10-02, revisada y corregida por Claude; reservas en `CONTINUIDAD.md` §0) |
| F9.2 | Marca de cada organización (logo, colores, datos) | Hecho (2026-10-03, revisada y corregida por Claude; reservas en `CONTINUIDAD.md` §0) |
| F9.3 | Modelo de agencia: clientes, acceso delegado y aislamiento | Hecho (2026-10-03, desarrollada y verificada por Claude; reservas en `CONTINUIDAD.md` §0) |
| F9.4 | Panel de agencia | Hecho con reservas (2026-10-03, desarrollada y verificada por Claude; reservas en el detalle de la historia y en `CONTINUIDAD.md` §0) |
| F9.5 | Gestión de clientes: importar, duplicar, transferir, facturación | Hecho con reservas (2026-10-04): F9.5a facturación, F9.5b transferir, F9.5c duplicar y F9.5d importar CSV; reservas en cada sub-historia y en `CONTINUIDAD.md` §0 |
| F9.6 | Equipo avanzado: roles personalizados, acceso por cliente y módulo, aprobación antes de publicar | En progreso: **F9.6a roles personalizados**, **F9.6b acceso por cliente y módulo** **F9.6c aprobación antes de publicar** y **F9.6d auditoría navegable** hechas (2026-10-04/11): **F9.6 completa** |
| F9.7 | Marca blanca: panel, dominio, portal del cliente, correos y plantillas privadas | **Hecha** (2026-10-11): **a** marca y cascada, **b** correos, **c** plantillas privadas, **d** dominio de agencia, **e** portal del cliente (los reportes del portal llegan con F9.8) |
| F9.8 | Reportes por cliente | Pendiente |
| F9.9 | Moderación y reportes de abuso | Pendiente |
| F9.10 | Aislamiento, seguridad y cierre de la fase | Pendiente |

Una historia no empieza si la anterior no cumple su Definición de Terminado. F9.1 y F9.2 son la base de
todo lo demás (la marca en cascada); F9.3 es la base de F9.4 a F9.8.

---

## Reglas transversales (aplican a TODAS las historias)

1. **Diseño idéntico al resto del producto.** Mismos tokens (`@impulza/ui`), fondo claro y estilo sobrio
   en panel y administración (CLAUDE.md, «No negociables de UI/UX»). **Nada de estilos nuevos
   ad hoc.** Antes de cerrar cada pantalla, revisar con `design:design-critique`,
   `design:accessibility-review` y `design:ux-copy`. WCAG 2.2 AA, responsive real (móvil 412 px y
   escritorio 1440 px), y estados de **carga, vacío, error y éxito** en toda pantalla.
2. **Seguridad en el servidor, siempre.** Validación Zod en toda entrada; **jamás** confiar en permisos
   ni en el `organization_id` del frontend (ADR-002); permisos verificados en el servidor; rate limiting
   en toda ruta nueva sensible; auditoría de toda acción administrativa; cookies, CSRF, CSP y CORS como
   hoy; sin secretos ni datos sensibles en logs ni respuestas.
3. **Aislamiento:** cada endpoint nuevo suma su caso a `multi-tenant-isolation.e2e.test.ts`. Para
   acceso delegado, además: la agencia A **no** puede ver ni tocar clientes de la agencia B ni de
   organizaciones sin relación `ACTIVE`; un módulo no permitido responde 403; un acceso revocado o
   pausado responde 403 de inmediato.
4. **Migraciones reversibles y no destructivas**, con respaldo previo; nada de borrar columnas con
   datos. Actualizar `ERD.md`, `ARCHITECTURE.md`, **OpenAPI (`pnpm --filter @impulza/api run
   openapi:generate`)** y `REQUIREMENTS_TRACEABILITY.md`. **Si cambias contratos o listas repetidas
   (`packages/contracts` ↔ `packages/validation`), súmales una prueba que las compare**: en la Fase 8 esto
   rompió el build y nadie lo notó con typecheck y lint limpios.
5. **Pruebas:** unitarias + integración (e2e de la API) + Playwright en móvil y escritorio con capturas
   en `docs/design/capturas/f9x/`. **Cada prueba nueva se verifica contra el código roto** (revertir la
   corrección, ver que falla, restaurar). Sin Playwright y sin capturas **no se marca nada como hecho**.
6. **Telemetría:** logs estructurados con `organizationId` y `agencyOrganizationId` cuando aplique, y
   métricas de las acciones nuevas.
7. **Cero librerías nuevas** sin ADR que lo justifique.
8. **Antes de afirmar «listo»:** `pnpm turbo run typecheck lint test --continue` **escribiendo a un
   archivo de log** (nunca con `Select-Object -First`), `next build` real de dashboard, web y admin, y la
   suite de Playwright de la historia. Decir con honestidad lo que no se probó.
9. **No tocar archivos ajenos a la historia.** Un commit por historia, mensaje
   `feat(<area>): … (F9.X, ADR-028)`, y sin `push --force`. No marcar la historia como completa en el
   backlog hasta que Claude la revise.
10. **Contenido verificable:** todo texto de la interfaz o del sitio comercial que describa una función
    debe poder señalarse en el código.

---

### F9.1 — Marca de la plataforma (el dueño del sistema configura todo)

**Objetivo:** que el dueño de Impulza One cambie desde `apps/admin` la identidad de la plataforma sin
tocar código, y que **todas** las aplicaciones y correos la lean de ahí.

**Criterios de aceptación:**

1. **Modelo `PlatformBranding`** (singleton): nombre del producto, logo para fondo claro y para fondo
   oscuro, favicon, color de marca principal y secundario, nombre y correo del remitente, enlaces de
   soporte y legales (privacidad, términos), texto de pie. Migración + valores por defecto que
   reproducen exactamente la marca actual (nadie ve cambios hasta que el dueño edite algo).
2. **Pantalla en `apps/admin`** («Marca de la plataforma»): formulario con vista previa en vivo,
   subida de logo y favicon por el pipeline de medios existente, estados de carga/vacío/error/éxito,
   botón «Restablecer a la marca por defecto» con confirmación.
3. **Validación en el servidor:** colores en hexadecimal; el servidor **rechaza** pares de color de marca
   con contraste menor a 4.5:1 sobre el fondo donde se usan; logos solo PNG/JPG/WebP/SVG saneado (sin
   scripts ni referencias externas), tamaño máximo, dimensiones mínimas; enlaces solo `https`.
4. **Solo superadministración** (guard propio, ADR-005), con auditoría de cada cambio (qué campo, quién,
   valor anterior sin datos sensibles) y límite de tasa.
5. **Endpoint público de lectura** `GET /api/v1/platform/branding` con **solo** campos públicos, caché
   corta e invalidación al guardar. Sin autenticación pero sin exponer correos internos.
6. **Consumo real:** `apps/web` (cabecera, pie, metadatos, favicon), `apps/dashboard` (cabecera del
   panel, pantallas de acceso, onboarding), `apps/admin` y los **correos transaccionales** usan la
   marca de plataforma. Con la base vacía o sin respuesta, **caen a la marca por defecto**, nunca a
   una pantalla rota.
7. **Pruebas:** unitarias de validación (contraste, SVG con script rechazado), e2e de la API
   (solo superadmin; usuario normal recibe 403; el público ve solo campos públicos), Playwright en
   móvil y escritorio: cambiar el nombre y el logo en admin → se ve en el sitio comercial y en el
   panel; restablecer vuelve a la marca por defecto. Capturas en `f91/`.

---

### F9.2 — Marca de cada organización (logo, colores, datos) — En revisión

**Objetivo:** que **cada usuario configure la identidad de su negocio** desde `Configuración › Marca`.

**Criterios de aceptación:**

1. **Modelo `BrandProfile`** por organización: nombre visible, logo (claro/oscuro), favicon, color
   principal y secundario, correo y teléfono de contacto, razón social y datos fiscales opcionales.
   Migración con un registro vacío por organización existente (sin romper nada).
2. **Pantalla `Configuración › Marca`** en el panel: edición con vista previa, subida de logo/favicon,
   estados completos, solo para quien tenga el permiso de configuración de la organización.
3. **Validación del servidor** idéntica en rigor a F9.1 (contraste AA, SVG saneado, https), más: un
   usuario **no** puede escribir la marca de otra organización (aislamiento, ADR-002).
4. **Uso real y verificable de la marca de la organización:**
   a. valores por defecto al **crear páginas** y plantillas (avatar/logo y color principal sugeridos),
   b. **correos** que la organización envía (confirmaciones de reserva, newsletter, secuencias): nombre
      visible y logo en el encabezado, **con el remitente de plataforma** si no hay dominio verificado,
   c. **encabezado de los reportes** (F9.8),
   d. **panel con marca blanca** (F9.7), solo si la agencia lo habilita.
5. **Cascada de marca** implementada en **un único servicio** (`resolveBrand(orgId)`) con la regla del
   ADR-028 §4 y su prueba unitaria completa (todas las combinaciones de presente/ausente). Nadie más
   decide la marca por su cuenta.
6. **Pruebas:** e2e de la API (aislamiento, validación, permisos), unitaria de la cascada, Playwright:
   un usuario sube su logo y color → aparece en el correo de prueba y en el valor por defecto de una
   página nueva. Capturas en `f92/`.

---

### F9.3 — Modelo de agencia: clientes, acceso delegado y aislamiento — Hecho

**Objetivo:** el núcleo del modo agencia, con el menor riesgo posible para ADR-002.

**Criterios de aceptación:**

1. **Migraciones** (reversibles): `Organization.kind` (`BUSINESS`/`AGENCY`), `AgencyClient`,
   `Membership` con origen y referencia a la relación de agencia, plan de agencia con **límite de
   clientes** (el plan y su límite se administran desde superadministración). Actualizar `ERD.md`.
2. **Crear una agencia:** un usuario crea una organización de tipo agencia (con plan de agencia). Una
   organización `BUSINESS` no puede volverse agencia sin el plan correspondiente.
3. **Alta de cliente — dos caminos:**
   a. **Crear cliente nuevo:** la agencia crea la organización del cliente y queda como administradora
      delegada; la invitación al **propietario** del cliente sale por correo con enlace firmado y con
      vencimiento; hasta que la acepta, el cliente figura `INVITED`.
   b. **Vincular cliente existente:** el propietario de una organización existente **acepta
      explícitamente** la solicitud de la agencia (consentimiento del cliente).
4. **Acceso delegado = `Membership` con origen `AGENCY`** con rol delegado y permisos por módulo. **Se
   cumplen los límites duros del ADR-028 §2** (no eliminar la organización, no cambiar propietario, no
   tocar la cuenta de cobro, no exportar contactos sin permiso). Cada uno **tiene su prueba negativa**.
5. **Cambio rápido entre cuentas** (selector de organización existente ampliado con los clientes
   permitidos): acción explícita de UI (ADR-002 §3); nunca un parámetro implícito.
6. **Revocación por el propietario del cliente:** inmediata; invalida las sesiones/contextos de la
   agencia en ese cliente; auditada. La agencia también puede soltar al cliente.
7. **Pausar y archivar** cliente: la agencia pierde acceso de edición (pausa = solo lectura; archivo =
   sin acceso); los datos y los sitios **no se borran**; el sitio público sigue o se despublica según lo
   elegido, con confirmación.
8. **Un único guard** (`AgencyAccessGuard`) valida en el servidor: relación `ACTIVE`, módulo permitido
   y acción permitida. Prohibido repetir esa lógica por endpoint.
9. **Auditoría:** toda acción delegada registra al actor real, la agencia y el cliente.
10. **Pruebas (obligatorias):** aislamiento entre agencias A y B; agencia sin relación `ACTIVE` → 403;
    módulo no permitido → 403; cliente pausado → solo lectura; archivado → 403; acceso revocado → 403
    inmediato; los 4 límites duros; cupo de clientes del plan respetado (el cliente nº N+1 falla con
    mensaje claro). Playwright móvil/escritorio: crear agencia, dar de alta un cliente, cambiar de cuenta,
    pausar. Capturas en `f93/`.

**Resultado (2026-10-03):** `turbo typecheck lint test` 70/70 (API 795 pruebas, validación 731); `next build` de dashboard, admin y web; OpenAPI
regenerado (230 rutas); Playwright `agencia.spec.ts` 4/4 en móvil y escritorio (capturas en `f93/`); casos en `multi-tenant-isolation.e2e.test.ts`
(84/84); prueba de paridad `contracts`↔`validation` de los límites del plan. Mutaciones que hacen fallar las pruebas: pausa que deja escribir
(unitaria y e2e), revocación que no retira membresías (e2e), filtro público sin `publicHiddenAt` (e2e), `clients` fuera del contrato (paridad).
**Defectos hallados al probar con la interfaz real y corregidos:** el vínculo sin agencia respondía cuerpo vacío (la pantalla de
Configuración › Agencia mostraba error) y el inicio de un cliente delegado pedía el equipo —que el servidor niega a la agencia— y terminaba en
«Sin acceso». **Criterio 7:** `Organization.public_hidden_at` (reversible; decisión del propietario, 2026-10-03).
**Cómo se cumplen los criterios que difieren de la letra:** 8 → la puerta única es `OrganizationMembershipGuard` + `delegatedAccessVerdict` (no hay un
`AgencyAccessGuard` aparte; ver ADR-028, notas de F9.3); 6 → no hay sesión de agencia que invalidar: el acceso se evalúa en cada petición.
**Reservas (honestidad):** (a) que el sitio público oculto devuelve 404 se prueba por API (e2e), no con el navegador; (b) la aceptación de la
invitación al propietario por el enlace del correo se prueba por API (el token solo viaja por correo); Playwright cubre la vía «solicitud sobre un
negocio existente»; (c) la mutación «solicitud sin aceptar da acceso» no la detecta la e2e (hay una segunda capa: sin membresía activa ya responde 403)
sino la prueba unitaria; (d) no se corrió la suite completa de Playwright, solo la de agencia; (e) sin proveedor real de correo (solo consola) ni
staging; (f) el plan `agencia` con 25 clientes es un valor provisorio (decisión #4).

---

### F9.4 — Panel de agencia — Hecho con reservas

**Objetivo:** la vista consolidada de la agencia (PM §11.1).

**Criterios de aceptación:**

1. **Dashboard de agencia** con: clientes (totales por estado), cuentas activas, **uso por plan** de cada
   cliente (cupo usado vs. incluido), **rendimiento consolidado** (visitas, clics, contactos, reservas,
   pedidos por periodo), **dominios y publicaciones** (estado de dominio, última publicación), **pagos y
   alertas** (suscripción vencida, pago rechazado, dominio sin verificar), **tareas del equipo**.
2. Los datos consolidados se calculan **solo con las organizaciones cuya relación está `ACTIVE` y
   módulo permitido**, en el servidor; un cliente pausado/archivado deja de sumar.
3. Tabla de clientes con búsqueda, filtros por estado y orden (TanStack Table existente), paginación en
   servidor; acciones por fila (entrar, pausar, archivar) según permisos.
4. Consultas eficientes (sin N+1); índices donde haga falta; tiempos medidos con 200 clientes de prueba
   (documentar el resultado).
5. **Estados** de carga, vacío (agencia sin clientes, con guía para el primero), error y éxito.
6. **Pruebas:** e2e de la API (los totales cuadran con los datos; un cliente de otra agencia no
   aparece), unitarias de agregación, Playwright móvil/escritorio, capturas en `f94/`.

**Resultado (2026-10-03):** `GET /agency/dashboard` y `GET /agency/overview` (búsqueda, filtro por estado, orden por nombre/estado/fecha y paginación de
hasta 50 filas, todo en el servidor); reglas puras en `@impulza/validation` (`agency/dashboard.ts`, 13 pruebas); consultas agrupadas (el número de
consultas no crece con los clientes: 5 para el rendimiento y 6 para plan/dominios/publicación); pantalla `/agencia` con resumen, alertas, tabla y alta
plegada. Verificado: e2e de la API `agency-dashboard.e2e.test.ts` 15/15; Playwright `panel-agencia.spec.ts` 6/6 y `agencia.spec.ts` 4/4 (móvil y
escritorio, capturas en `f94/`); `next build` del panel; OpenAPI regenerado (232 rutas); `typecheck` y `lint` sin errores. Mutaciones que hacen
fallar las pruebas: consolidado que suma a todos los estados (2 pruebas) y tabla sin filtro de agencia (6 pruebas).
**Medición con 200 clientes (150 activos):** panel ~55 ms y tabla de 50 filas ~40 ms (3 corridas, base local; criterio 4).
**Decisiones y límites (honestidad):**
- **Tareas del equipo (criterio 1): NO implementado.** No existe ningún modelo de tareas en el sistema; hacerlo es una función nueva, no un dato que
  mostrar. Queda como pendiente a decidir con el propietario.
- **Suscripción vencida y pago rechazado (criterio 1): NO se muestran** para los clientes que pagan por su cuenta, porque el ADR-028 §2 prohíbe a la agencia
  ver su suscripción y sus pagos (hay una prueba que verifica que nada de eso sale en la respuesta). Para los clientes `AGENCY_PAYS` llegan con F9.5
  (facturación), que es donde la agencia sí gestiona el cobro.
- **Uso del plan:** se muestran sitios y contactos (los dos cupos que más se agotan); el resto de los límites los ve cada negocio en su pantalla de plan.
- **«TanStack Table existente» (criterio 3):** no hay TanStack Table en el panel; se usó una lista de filas con el mismo diseño del resto, porque
  búsqueda, filtro, orden y paginación son del servidor. Ordenar por una métrica (visitas, etc.) no está: solo por nombre, estado y fecha.
- «Módulo permitido» (criterio 2): el consolidado cuenta analítica, contactos, reservas y pedidos de los clientes `ACTIVE`; los módulos que el rol
  delegado no tiene no se suman (nada de cobros).
- Un tiempo de espera de `domains.e2e` apareció una vez en la corrida completa (593 s) y pasa aislado 8/8: el flaky por carga ya conocido.

---

### F9.5 — Gestión de clientes: importar, duplicar, transferir, facturación — Hecho con reservas

**Criterios de aceptación:**

1. **Importación de clientes** por CSV (plantilla descargable): validación fila por fila en el
   servidor, informe de errores por fila, tope de filas, **idempotencia** (reimportar no duplica),
   respeta el cupo del plan, procesada por **cola BullMQ**, con progreso visible. Nunca ejecuta
   fórmulas (mitigar inyección CSV al exportar).
2. **Duplicar cliente:** crea una **organización nueva** copiando sitios, páginas, bloques, temas y
   marca. **Nunca** copia contactos, pedidos, pagos, medios con datos personales, claves ni cuentas de
   cobro. Idempotente por clave y auditada.
3. **Transferir cliente** (agencia → propietario, o a otra agencia): flujo con **doble consentimiento**
   y vencimiento; estado `TRANSFERRING`; al aceptar cambia la relación, **sin mover datos**; antes de
   aceptar, nada cambia. Auditoría completa.
4. **Facturación:** `CLIENT_PAYS` o `AGENCY_PAYS`; el cambio exige confirmación del propietario del
   cliente; con `AGENCY_PAYS`, el cupo y el cobro son los de la agencia; **historial de cambios** y
   vista de qué paga quién. Sin custodiar tarjetas (CLAUDE.md): se reutiliza el proveedor de pagos
   existente.
5. **Pruebas:** importación con filas válidas, inválidas y repetidas (idempotencia); duplicación sin
   datos personales (afirmar que no se copió ninguno); transferencia con rechazo, vencimiento y
   aceptación; cambio de facturación sin confirmación → falla. Playwright móvil/escritorio, capturas
   en `f95/`.

**Se entregó en cuatro sub-historias, cada una con su commit y su push:** F9.5a facturación (criterio 4), F9.5b transferir (3), F9.5c duplicar (2) y
F9.5d importar CSV con cola (1). Las cuatro pasaron la Definición de Terminado, con las reservas que cada una declara.

#### F9.5a — Facturación: quién paga el plan — Hecha (2026-10-03)

**Decisión del propietario de la plataforma:** `AGENCY_PAYS` = el negocio usa los **límites del plan de la agencia** y no necesita suscripción propia;
**no se cobra nada nuevo ni se toca Mercado Pago** (un cobro por cliente con el proveedor de pagos queda para cuando haya uno real configurado).
**Qué hay:** modelo `AgencyBillingChange` (historial con propuesta pendiente; migración reversible); la agencia propone y el propietario confirma o
rechaza (aviso por correo); el propietario puede volver a pagar él al instante; la agencia puede cancelar su propuesta; un cliente que la agencia creó y
cuyo propietario aún no acepta se cambia de inmediato (no hay a quién pedir confirmación). El plan efectivo (`PlansService`, rutas individual y masiva)
usa el plan de la agencia si `AGENCY_PAYS` y la relación da acceso; la suscripción propia vigente y el plan asignado a mano **mandan sobre** el de la
agencia. Vista de qué paga quién en el resumen del panel; historial en la fila de la agencia y en Configuración › Agencia del propietario.
**Verificado:** e2e de la API `agency-billing.e2e.test.ts` 19/19 (flujo, permisos, aislamiento, precedencia del plan, concurrencia —dos propuestas a la
vez: una gana—, auditoría); reglas puras 6 pruebas; Playwright `facturacion-agencia.spec.ts` 2/2 en móvil y escritorio con un propietario real
(proponer → rechazar → proponer → confirmar → el plan del negocio muestra el de la agencia → historial → volver a pagar), junto con los 10 de agencia y
panel; capturas en `f95/`; suite completa 70/70 (API 829); builds de panel y admin; OpenAPI regenerado (237 rutas). **Mutaciones que hacen fallar las
pruebas:** plan individual sin la rama de agencia (4 fallan), plan masivo sin ella (1), confirmar sin exigir permiso de propietario (2).
**Límites (honestidad):** (a) no hay cobro real a la agencia por cliente (decisión de arriba); (b) con `AGENCY_PAYS` el negocio recibe los límites **completos**
del plan de la agencia, no una fracción de un cupo compartido; (c) el cambio de plan se refleja al instante en los límites pero no genera aviso en pantalla
para quien ya estaba usando el sistema; (d) el aviso al propietario sale por correo solo a la consola local (no hay proveedor de correo real todavía).

#### F9.5b — Transferir un cliente — Hecha (2026-10-03)

**Qué hay:** modelo `AgencyTransfer` (migración reversible); la agencia propone traspasar un cliente `ACTIVE` a su **propietario** o a **otra agencia**
(identificada con su identificador y el correo de su propietario); el propietario **siempre** consiente y la agencia receptora también si el destino es otra
agencia (decisión de diseño documentada en el ADR); en cualquier orden; vence a los 14 días; la receptora necesita cupo de clientes; antes de completarse
**nada cambia** (`TRANSFERRING` da el mismo acceso que `ACTIVE`); al completarse cambia la relación y **no se mueve ningún dato**. Pantallas: traspaso en la
fila de la agencia, «Te ofrecen un cliente» en la agencia receptora y la tarjeta del propietario en Configuración › Agencia; avisos por correo y auditoría
en las tres organizaciones.
**Verificado:** e2e de la API `agency-transfer.e2e.test.ts` 21/21 (ambos destinos, los dos órdenes de aceptación, rechazo, cancelación, vencimiento,
recuperación de un `TRANSFERRING` huérfano, concurrencia —dos propuestas a la vez: una gana—, cupo de la receptora, aislamiento entre agencias y de
propietarios ajenos, permisos del administrador no propietario, efectos laterales y auditoría); reglas puras 5 pruebas; Playwright `traspaso-agencia.spec.ts`
4/4 en móvil y escritorio con tres actores reales, y los cuatro specs de agencia juntos; capturas en `f95/`. **Mutaciones que hacen fallar las pruebas:**
completar sin esperar a la otra parte (4 fallan), iniciar desde cualquier estado (1), aceptar vencido (1), la agencia saliente conserva el acceso (2) y una
agencia ajena aceptando el traspaso de otra (1). **Defecto hallado y corregido al probar:** cancelar el traspaso de un cliente que no es de la agencia
respondía 409 en vez de 404.
**Límites (honestidad):** (a) el vencimiento se aplica al leer o decidir, no hay una tarea programada que lo ejecute de madrugada (un traspaso vencido que nadie
mira sigue «pendiente» en la base hasta que alguien de la agencia, del negocio o de la receptora consulta); (b) los avisos por correo salen solo a la consola
local (no hay proveedor real todavía); (c) el cliente en traspaso no suma al consolidado del panel (solo suman los `ACTIVE`) aunque la agencia siga trabajando;
(d) al pasar a otra agencia, quién paga vuelve a empezar en `CLIENT_PAYS` y debe volver a acordarse con ella; (e) las corridas completas de la API (850 pruebas, con la
máquina cargada por Docker y otras aplicaciones) hacían expirar una prueba distinta cada vez por el límite por defecto de 5 s (analítica, soporte, webhooks), todas
verdes aisladas: se subió `testTimeout` a 15 s en `apps/api/vitest.config.ts` (solo cambia cuánto se espera, no lo que se verifica) y la suite completa quedó 70/70.

#### F9.5c — Duplicar un cliente — Hecha (2026-10-03)

**Qué hay:** modelo `AgencyDuplication` (migración reversible); `POST /agency/clients/:id/duplicate` crea un cliente **nuevo** (con la invitación a su propietario,
como «Nuevo cliente», respetando el cupo de clientes) y copia en la misma transacción sitios, páginas, bloques, temas propios y colores de marca, todo en
**borrador**. Reglas puras de limpieza en `@impulza/validation` (`agency/duplicate.ts`). Pantalla: «Duplicar en un cliente nuevo» en la fila, con la lista de lo que
no se copia antes de crear, y un informe después (qué se creó, qué revisar antes de publicar, qué se ajustó o quedó fuera por el plan y «Qué NO se copia nunca»).
**Verificado:** e2e de la API `agency-duplicate.e2e.test.ts` 17/17 sobre un origen sembrado **con datos sensibles y referencias** (contacto, pedido, reserva, dominio,
cuenta de cobro con token, formulario, datos fiscales, IDs de GA4 y Pixel, imágenes y fondo de la biblioteca, regla de botón inteligente): se afirma que no se copió ninguna
fila sensible, que **no queda ningún rastro** del origen en lo copiado (ni su id, ni sus archivos, ni su formulario, ni sus claves) y que el origen queda **idéntico**;
plan gratis (1 sitio, 3 páginas) y plan sin tope; idempotencia (reintento, misma clave con otra petición, dos peticiones a la vez → un solo cliente); **todo o nada**
(fallo simulado a mitad de la copia: no queda organización, relación ni sitios, y la clave no se gasta); sin cupo de clientes → 402 sin crear nada; aislamiento entre agencias;
solo con relación con acceso; auditoría. Reglas puras 19 pruebas. Playwright `duplicar-agencia.spec.ts` 2/2 en móvil y escritorio (informe en pantalla y comprobación en
la base), junto con los otros cuatro specs de agencia; capturas en `f95/`. **Mutaciones que hacen fallar las pruebas:** no detectar los medios del origen (3 fallan), copiar los
identificadores de medición (2), duplicar sin relación con acceso (1), duplicar el cliente de otra agencia (1), copiar los datos fiscales (2) e ignorar la clave de
idempotencia (1). **Defecto hallado y corregido al probar:** al quitar la imagen del SEO quedaba un `openGraph: {}` vacío; ahora un contenedor que queda vacío por la limpieza se descarta.
**Límites (honestidad):** (a) los archivos de la biblioteca **no se copian** (hay que volver a subirlos): no se puede saber si contienen datos personales; (b) no se copian productos,
servicios, formularios ni calendarios: los bloques que los usaban quedan sin configurar; (c) sí viajan los textos y datos de contacto del negocio origen (WhatsApp, correo,
mapa, redes, testimonios): el informe los marca para revisar y todo queda en borrador; (d) no se pide consentimiento al propietario del negocio origen (queda en su historial
de auditoría) porque la agencia ya tiene acceso delegado de edición; (e) la duplicación no incluye pruebas A/B, embudos ni campañas.

#### F9.5d — Importar clientes por CSV — Hecha (2026-10-04)

**Qué hay:** plantilla CSV descargable; `POST /agency/clients/import` valida el archivo **entero, fila por fila, en el servidor** y guarda cada fila (las válidas pendientes, las
inválidas con su motivo y su línea); el **worker** consume la cola BullMQ `agency-import` y crea cada cliente (organización, relación, acceso delegado, invitación al propietario,
auditoría) en su propia transacción; el avance se consulta (`GET imports/:id`, con informe paginado) y se descarga el informe de errores como CSV seguro. Modelos `AgencyImport` y
`AgencyImportRow` (migración reversible, con un `CHECK` que impide descuadrar el avance). Paquete nuevo `@impulza/agency` con la lógica que comparten la API y el worker.
Pantalla en `/agencia`: plantilla, selector de archivo, barra de avance con recuento, informe de problemas por fila y «Importaciones anteriores».
**Verificado:** reglas puras del CSV 24 pruebas (comillas, separadores, saltos de línea dentro de un campo, BOM, CRLF, neutralización de fórmulas, ida y vuelta); procesador contra la base
real en el worker 12 pruebas (creación completa, reimportar no duplica, identificador ajeno, cupo, dos workers a la vez, recuperación tras una caída, correo caído, no-agencia,
mantenimiento y borrado, `CHECK` del avance); e2e de la API `agency-import.e2e.test.ts` 17 pruebas **con un worker real de BullMQ consumiendo la cola** (subir → encolar → procesar →
progreso), archivo inservible, tope de filas, una importación a la vez, cupo congelado, informe, aislamiento entre agencias, permisos y límite de subidas; Playwright
`importar-agencia.spec.ts` 4 pruebas por proyecto (móvil y escritorio) con el worker real: avance en pantalla, informe, descargas, reimportar sin duplicar, archivo en Windows-1252 y archivo
inservible; capturas en `f95/`. Los seis specs de agencia juntos pasan. **Mutaciones que hacen fallar las pruebas:** sin reclamar la fila (1), sin comprobar el cupo (2), sin reconocer al
cliente que ya existe (2), sin acceso delegado (1), sin recuperar filas colgadas (1), tomar por suyo un identificador ajeno (1), varias importaciones a la vez (1), una agencia viendo las
de otra (1), no congelar el cupo (1) y no encolar (7).
**Defectos hallados y corregidos al probar:** (1) el archivo descargado **perdía el BOM** (`response.text()` lo descarta) y Excel habría mostrado mal las tildes; (2) la plantilla respondía 200 a una
organización que no es agencia; (3) **en F9.5c**, la duplicación podía crear un sitio con un identificador público reservado (`www`, `planes`…) si el cliente nuevo se llamaba así; ahora el sitio lleva un sufijo.
**Límites (honestidad):** (a) las invitaciones salen a la consola local (no hay proveedor de correo real todavía); (b) el worker no arranca sin `APP_BASE_URL` (no habría a dónde apuntar el
enlace): las importaciones quedan en cola y se procesan al configurarla; (c) una importación a la vez por agencia y 200 filas por archivo (para más, varios archivos); (d) el cupo queda
congelado al subir: si el plan cambia a mitad de una importación, rige el de antes; (e) el vencimiento de las invitaciones y las importaciones viejas se aplican por el mantenimiento del worker (cada minuto), no en el
instante; (f) las filas guardan correos de terceros y se borran a los 60 días.

**Cierre de F9.5:** las cuatro sub-historias están hechas. Reservas que siguen abiertas de F9.5: los avisos por correo solo salen a la consola local; el cobro real por `AGENCY_PAYS` no existe
(decisión del propietario, sin cobrar nada nuevo); los archivos de la biblioteca no se copian al duplicar; el vencimiento de un traspaso se aplica al consultarlo.

---

### F9.6 — Equipo avanzado: roles personalizados, acceso por cliente y módulo, aprobación antes de publicar

**Criterios de aceptación:**

1. **Roles personalizados** (`CustomRole`) por organización con permisos del **catálogo cerrado**;
   editor de roles con matriz módulo × acción.
2. **Sin escalada de privilegios:** nadie asigna permisos que no posee; nadie edita su propio rol; el
   último propietario no puede degradarse; el rol `OWNER` no es personalizable. Pruebas negativas para
   cada regla.
3. **Acceso por cliente y por módulo** para el equipo de una agencia: un integrante puede ver solo
   ciertos clientes y ciertos módulos; verificado por el `AgencyAccessGuard`.
4. **Aprobación antes de publicar:** opción por organización; solicitar → aprobar/rechazar con
   comentario; el servidor **rechaza publicar** sin aprobación cuando está activada; notificación al
   aprobador; historial visible.
5. **Auditoría navegable:** vista de auditoría filtrable por actor, acción, cliente y fecha, con
   paginación en servidor y exportación CSV segura.
6. **Pruebas:** matriz de permisos (cada rol × cada acción relevante), escalada bloqueada, publicar sin
   aprobación → 403, flujo de aprobación completo. Playwright móvil/escritorio, capturas en `f96/`.

#### F9.6a — Roles personalizados y reglas contra la escalada (criterios 1 y 2) — hecha (2026-10-04)

- **Modelo:** `CustomRole` (por organización, nombre único dentro de ella, hasta 20) + `CustomRolePermission` (catálogo cerrado) y `Membership.customRoleId`. La membresía
  conserva `roleId` apuntando a **ANALYST** (solo lectura) como piso: si algo ignorara el rol personalizado, la persona no ganaría nada. Migración reversible
  `20261004100000_f96a_custom_roles` (`down.sql`).
- **Una sola función responde «qué puede esta persona»** (`permissionsOfMembership`): la usan el `PermissionGuard`, los cambios de rol y las invitaciones.
- **Reglas (puras en `packages/validation/src/team`, aplicadas en el servidor):** nadie da permisos que no tiene (`ESCALATION`, con la lista en `missing`); nadie cambia su
  propio rol (`SELF_CHANGE`) ni edita/borra el rol personalizado que tiene; no se actúa sobre quien ya tiene permisos que el actor no tiene (`TARGET_ABOVE_ACTOR`: un rol con
  «cambiar roles» no degrada a un administrador); el propietario no se cambia ni se quita (`OWNER_PROTECTED`; así el último propietario nunca se degrada) y `OWNER` ni se
  asigna ni sirve de nombre de rol; un rol en uso no se borra (409); una agencia con acceso delegado no llega a `/roles` (`AGENCY_LIMIT`).
- **API:** `GET/POST /organizations/:id/roles`, `PUT/DELETE …/roles/:roleId`; invitar y cambiar rol aceptan `role` **o** `customRoleId`. Todo queda en la auditoría
  (`custom_role.created/updated/deleted`, `membership.invited/role_changed`).
- **UI:** Configuración › Equipo (lista, cambiar rol, quitar, invitar) y Configuración › Roles (editor con matriz módulo × acción; lo que quien edita no tiene sale
  desactivado y explicado). Estados de carga, vacío, error y éxito; móvil y escritorio.
- **Pruebas:** 11 de integración (matriz, escalada, propietario, aislamiento entre organizaciones, rol en uso, tope, cuerpo inválido, catálogo = base), 7 mutaciones atrapadas
  (guard, invitar, cambiar rol, quitar, crear rol, borrar en uso, aislamiento), reglas puras, y Playwright móvil/escritorio (`equipo-roles.spec.ts`, capturas en `docs/design/capturas/f96`).
- **Reservas honestas:** los roles personalizados no delegan a clientes de agencia (la agencia sigue delegando por el rol del sistema); editar un rol cambia al instante los permisos
  de quienes lo tienen (por diseño); no hay «clonar rol» ni plantillas de roles.

#### F9.6b — Acceso del equipo de la agencia por cliente y por módulo (criterio 3) — hecha (2026-10-04)

- **Modelo:** `AgencyMemberScope` (por persona de la agencia: `all_clients`, `modules[]`) + `AgencyMemberScopeClient` (clientes permitidos). **Sin fila = todo** (el comportamiento de F9.3), así que
  nada existente cambia; volver a «todo» borra la fila. Migración reversible `20261004110000_f96b_agency_member_scope` (`down.sql`).
- **Dos barreras (el criterio habla de un `AgencyAccessGuard`; la puerta única real es `OrganizationMembershipGuard`, ADR-028):** (1) las **membresías delegadas** solo existen en los clientes que caben en el
  alcance (`loadMemberScope` se aplica al sincronizar a una persona y al dar acceso a un cliente nuevo, todo desde `@impulza/agency`); (2) la **puerta de entrada** vuelve a comprobar en cada petición el cliente
  (`AGENCY_SCOPE_DENIED`) y el módulo (`AGENCY_MODULE_DENIED`), de modo que si la sincronización fallara el servidor sigue negando.
- **Módulos:** 11 (`AGENCY_MODULES`: sitios, contactos y formularios, reservas, catálogo y pedidos, campañas, medios, analítica, enlaces, soporte, marca, IA). Una función pura (`agencyModuleOfSegments`) traduce la
  ruta al módulo; lo que no es módulo (la organización misma, `plan`, `agency…`) no se acota, para que el selector de clientes siga funcionando.
- **Reglas (`scopeChangeVerdict`, puras):** nadie cambia su propio acceso (`SELF_CHANGE`); el propietario de la agencia no se acota (`OWNER_PROTECTED`); nadie da más alcance del que tiene
  (`SCOPE_ESCALATION`: ni «todos los clientes», ni un cliente o módulo que no tiene). Los clientes elegidos deben ser de **esa** agencia (uno ajeno responde 404); solo se acota a quien delega.
- **API:** `GET /organizations/:id/agency/team` y `PUT …/agency/team/:userId/scope` (`agency.manage`); la lista de organizaciones trae `access.modules` para que el menú oculte lo no permitido. Cada cambio queda en
  la auditoría (`agency.member_scope_changed`, con el alcance anterior y el nuevo).
- **UI:** Agencia › Equipo y acceso a clientes (editor con clientes y secciones; lo que quien edita no tiene sale desactivado y explicado). Estados de carga, vacío, error y éxito; móvil y escritorio.
- **Pruebas:** 9 de integración (por defecto todo, por cliente incluidos clientes nuevos y volver a «todos», por módulo, defensa en profundidad, las tres reglas, validaciones y rol sin permiso, aislamiento entre agencias,
  auditoría, salir de la agencia), 7 mutaciones atrapadas (guard cliente, guard módulo, sincronización, cliente ajeno, quien no delega, reglas, resincronizar), reglas puras, Playwright móvil/escritorio
  (`equipo-agencia.spec.ts`, capturas `09`–`11` en `docs/design/capturas/f96`).
- **Reservas honestas:** el alcance es por persona y vale para todos los clientes por igual (no hay «solo Medios en el cliente A y solo Sitios en el B»); el alcance de alguien que sale de la agencia queda guardado
  y rige si vuelve (falla cerrado); el menú muestra «Integraciones» a una persona delegada acotada aunque el servidor ya le niega webhooks (no es un módulo acotable); las lecturas públicas y los webhooks
  salientes no pasan por esta puerta.

#### F9.6c — Aprobación antes de publicar (criterio 4) — hecha (2026-10-05)

- **Modelo:** `Organization.requirePublishApproval` + `PublishRequest` (contenido exacto pedido, su digest sha256, estado, comentarios, uso único). Una pendiente por página (índice parcial). Migración reversible
  `20261005100000_f96c_publish_approval` (`down.sql` verificada: aplicar, borrar la fila de `_prisma_migrations`, redesplegar).
- **Compuerta en el servidor, en las DOS únicas vías que publican** (`publishPage` y `restoreVersion`, comprobado por búsqueda de `PageStatus.PUBLISHED`/`pageVersion.create`): con la opción activa y sin `publish.approve`
  solo se publica el contenido de una solicitud APROBADA, sin usar y con el mismo digest que el contenido vivo; se comprueba y se consume **dentro de la transacción** que crea la versión (403 `PUBLISH_APPROVAL_REQUIRED` /
  `PUBLISH_APPROVAL_OUTDATED`). Publicar sin cambios sigue siendo idempotente y no pide nada.
- **Reglas:** nadie resuelve su propia solicitud (`SELF_REVIEW`, aunque tenga el permiso); solo quien pidió la cancela; una nueva con otro contenido reemplaza a la pendiente; la aprobación de volver a una versión no
  sirve para otra; solo el propietario activa la opción y una agencia delegada no llega a `publish-settings` (`AGENCY_LIMIT`); `publish-requests` cuenta como módulo `sitios` para el alcance de la agencia.
- **API:** `GET/PUT …/publish-settings`, `GET …/publish-requests` (filtro y paginación en servidor), `GET …/:id` (con contenido), `POST …/:id/approve|reject|cancel`, `GET/POST …/pages/:pageId/publish-status|publish-requests`.
  Todo en la auditoría (`publish_request.created/approved/rejected/cancelled`, `publish_settings.updated`) y con aviso por correo a quienes aprueban y a quien pidió (hoy solo consola).
- **Defecto previo corregido de paso:** dos publicaciones simultáneas de una página daban 500 por la unicidad `[pageId, versionNumber]`; ahora cada página publica de a una (candado transaccional) y la segunda responde idempotente.
- **UI:** botón único de publicar (editor, detalle de página y panel de salud) que pasa a «Pedir aprobación» / «Esperando aprobación» / «Publicar»; aviso con el estado y el motivo de un rechazo; historial con «Pedir aprobación» para restaurar;
  nueva pantalla **Aprobaciones** (cola, filtro, paginación, revisión del contenido, aprobar/rechazar con motivo) y tarjeta de la opción en Configuración › Equipo. Estados de carga, vacío, error y éxito; móvil y escritorio.
- **Pruebas:** 18 de integración (`publish-approval.e2e.test.ts`) + caso transversal de aislamiento (85/85), reglas puras, permisos, Playwright móvil/escritorio (`aprobacion-publicar.spec.ts`, capturas `12`–`20` en
  `docs/design/capturas/f96`), y 6 mutaciones atrapadas (compuerta, digest, uso único en publicar, uso único en restaurar, autoaprobación, aislamiento).
- **Reservas honestas:** la compuerta cubre la publicación de **páginas**; el tema, el fondo, los Smart CTA y las pruebas A/B se aplican en vivo por diseño (ADR) y no pasan por ella; no hay vencimiento de una aprobación
  (la protege el digest y el uso único); los correos solo salen a la consola local; el portal del cliente que aprueba (`CLIENT_VIEWER`) llega con F9.7.

#### F9.6d — Auditoría navegable (criterio 5) — hecha (2026-10-11)

- **Sin modelo nuevo:** se consulta `AuditLog`. Permiso `audit.view` (OWNER y ADMIN); una agencia delegada no lo tiene y `audit-logs` entra a los segmentos que un cliente nunca delega (`AGENCY_LIMIT`).
- **API:** `GET …/audit-logs` y `…/audit-logs/export` (organización) y `GET …/agency/audit-logs` y `…/export` (agencia). Filtros validados (persona por fragmento de correo, acción o su prefijo, tipo de recurso, fechas con
  rango máximo de 366 días y, en agencia, cliente); paginación y recuento en la base; exportación por `toCsv` (celdas neutralizadas), tope de 10 000 filas con aviso y límite de 10 por minuto.
- **Límites de visibilidad:** una organización solo ve la suya; la agencia ve **solo las acciones que su equipo hizo con acceso delegado** (nunca lo que el cliente hace por su cuenta), y una persona acotada a ciertos clientes
  solo ve esos (un cliente fuera de su alcance o ajeno responde 404, igual que uno inexistente). Exportar queda registrado (`audit.exported`, con filtros y cantidad, sin contenido).
- **UI:** Configuración › Auditoría y Agencia › Auditoría: filtros, lista con etiquetas legibles y detalle desplegable, paginación, exportar CSV; estados de carga, vacío, sin resultados, error y sin permiso; móvil y escritorio.
- **Pruebas:** 6 de integración (`audit-query.e2e.test.ts`) + caso transversal de aislamiento, esquemas y CSV (unitarias), Playwright móvil/escritorio (`auditoria.spec.ts`, capturas `21`–`24`), y 5 mutaciones atrapadas
  (agencia ve lo del cliente, alcance por cliente, aislamiento de organización, permiso, registro de la exportación).
- **Reservas honestas:** la agencia acotada por **módulo** (F9.6b) ve igual las acciones de todos los módulos en sus clientes permitidos (el filtro es por cliente); el detalle muestra el `metadata` tal cual se guardó (el servidor
  nunca guarda secretos, ST §16); no hay búsqueda de texto libre dentro del detalle; no se archiva ni se purga la auditoría (sin política de retención todavía).

---

### F9.7 — Marca blanca: panel, dominio, portal del cliente, correos y plantillas privadas

**Criterios de aceptación:**

1. **`WhiteLabelSettings`** de la agencia: nombre, logo, colores y textos de pie para el panel de sus
   clientes; activable por cliente. La **cascada de marca** (F9.2 criterio 5) lo aplica: panel, pantallas
   de acceso del portal y correos.
2. **Dominio de agencia** para el portal: alta, instrucciones DNS, verificación, HTTPS, estados
   (`PENDING`/`VERIFIED`/`FAILED`), reutilizando la infraestructura de dominios; un dominio no verificado
   **nunca** sirve el portal.
3. **Portal del cliente:** rol de **solo lectura/aprobación** (`CLIENT_VIEWER`) con ver reportes,
   aprobar publicaciones y comentar. No ve ajustes de facturación ni datos de otros clientes.
4. **Correos con marca de la agencia:** remitente de la agencia **solo** con dominio verificado; si no,
   remitente de plataforma con el nombre de la agencia visible. **Cabecera legal mínima** que indica que
   el correo lo envía la agencia a través de la plataforma.
5. **Plantillas privadas:** una agencia (y una organización) puede crear plantillas **visibles solo
   para ella** (`Template.organizationId` opcional, migración reversible); no aparecen en la galería
   pública ni en `/plantillas`, ni para otras organizaciones. Prueba de aislamiento.
6. **Seguridad:** sin suplantación (no se puede usar la marca de otra organización), colores y logos
   validados como en F9.1, el portal no filtra la existencia de otros clientes, limitación de tasa en
   el acceso al portal.
7. **Pruebas:** cascada completa, dominio no verificado no sirve el portal, correo sin dominio
   verificado cae al remitente de plataforma, plantilla privada invisible para terceros. Playwright
   móvil/escritorio, capturas en `f97/`.

#### F9.7a — Marca blanca de la agencia y cascada (criterios 1 y 6) — hecha (2026-10-11)

- **Modelo:** `WhiteLabelSettings` (una por agencia) + `AgencyClient.whiteLabelEnabled`. Migración reversible `20261011100000_f97a_white_label` (`down.sql` verificada).
- **Cascada** en un solo lugar (`cascadeBrand`) con dos audiencias (`team` y `customer`; ver nota en ADR-028) y un cargador compartido por la API y el worker. Aplica al panel del cliente y a lo que envía su negocio;
  la agencia, el cliente y el público ven cada uno lo que corresponde.
- **API:** `GET/PUT …/agency/white-label`, `POST …/upload`, `PUT …/clients/:relationId`, y `GET …/panel-brand` (cualquier miembro). Validación de contraste AA, logos solo propios, nombre sin suplantación
  (`BRAND_NAME_TAKEN`), no se activa sin marca ni en relaciones no vigentes ni de otra agencia, y no se quita el nombre en uso. Auditoría en la agencia y en el cliente.
- **UI:** Agencia › Marca blanca (formulario con vista previa y aviso de contraste; activación por cliente) y el panel del cliente se viste con la marca (nombre, logo, color, pie y correo de soporte).
- **Pruebas:** 7 de integración (`white-label.e2e.test.ts`) + caso transversal de aislamiento, cascada y esquemas (unitarias), Playwright móvil/escritorio (`marca-blanca.spec.ts`, capturas en `f97/`), y 6 mutaciones atrapadas
  (activación, estado de la relación, suplantación, filtro por agencia, logos externos, nombre en uso).
- **Reservas honestas:** el favicon y el título de la pestaña del panel siguen siendo los de la plataforma; las pantallas de acceso (login) y el dominio propio llegan con F9.7d/e; el remitente y la cabecera legal
  de los correos con F9.7b; el color se aplica a los controles principales del panel (no a todo el sistema de diseño).

#### F9.7b — Correos con la marca de la agencia (criterio 4) — hecha (2026-10-11)

- **Cabecera legal mínima**, generada en el único lugar que arma los correos de marca (`brandEmail`): cuando en la marca interviene una agencia, el texto plano y el HTML dicen «Este correo lo envía <agencia> a
  través de <plataforma>» y el mensaje lleva las cabeceras `X-Sent-On-Behalf-Of` y `X-Sent-Via` (solo ASCII, sin saltos de línea: el nombre de la agencia no puede inyectar cabeceras). El pie de la agencia aparece en el HTML.
- **Remitente:** `senderEmail` solo viene de un dominio **verificado** (`WhiteLabelBrandRow.senderEmail`, que completa el cargador; hoy siempre `null`). Sin él, el correo sale con el remitente de la plataforma y el nombre
  de la agencia visible. Y aunque el dominio esté verificado, solo firma la agencia lo que lleva **su** nombre: si el nombre es el del negocio, el remitente de la agencia no se usa.
- **Dónde aplica hoy:** lo que el negocio envía a su público (por la cascada `customer`; API y worker) y los avisos de aprobación de publicaciones al equipo del cliente (cascada `team`). Los correos de plataforma a
  la organización (cobros, acceso, soporte) conservan la marca de la plataforma a propósito.
- **Pruebas:** reglas puras de remitente y cabecera legal (incluida inyección de cabeceras) y una de integración del aviso con y sin marca blanca; verificadas contra el código roto.
- **Reserva:** el dominio verificado llega con F9.7d; hasta entonces `senderEmail` es siempre `null`.

#### F9.7c — Plantillas privadas (criterio 5) — hecha (2026-10-11)

- **Modelo:** `Template.organizationId` opcional (migración reversible, `down.sql` verificada). Toda lectura del catálogo filtra `organizationId: null`: galería pública, plantilla por código y administración de la plataforma;
  aplicar una plantilla acepta el catálogo o una privada de la organización (o de su agencia, con acceso delegado) y responde 404 para cualquier otra.
- **Qué se copia:** los bloques visibles de una página propia (cadena organización → sitio → página), **sin** referencias a formularios, servicios ni productos (`formId` pasa a `null`; listas y categoría se quitan), y, si se
  pide, el tema y el fondo del catálogo. Pasa por el mismo `templateSchema` que el catálogo. Tope de 50 por organización.
- **Quién ve qué:** la organización dueña ve las suyas; el equipo de una agencia que trabaja en un cliente ve además las de la agencia (marcadas «De tu agencia») y puede aplicarlas allí; el equipo directo del cliente **no** las ve ni las
  usa; nadie borra desde un cliente una plantilla de la agencia.
- **API:** `GET/POST …/private-templates`, `DELETE …/private-templates/:templateId` (`page.manage`; auditado: `template.private_created/deleted`).
- **UI:** «Guardar como plantilla» en el constructor y «Tus plantillas» al elegir una plantilla (con borrado de las propias).
- **Pruebas:** 5 de integración (`private-templates.e2e.test.ts`) + caso transversal de aislamiento, reglas puras, Playwright móvil/escritorio (`plantillas-privadas.spec.ts`, capturas `05`–`06` en `f97/`) y 7 mutaciones atrapadas.
- **Reservas honestas:** las imágenes subidas por la organización de origen se conservan en la plantilla pero **no** se pueden aplicar en otra organización (la comprobación de medios propios las rechaza con 422): una plantilla de
  agencia para clientes debe usar bloques sin medios propios; copiar medios entre organizaciones no se hace. Las etiquetas de rubro/objetivo de una privada son neutras (no se filtra por ellas); no hay vista previa renderizada.

#### F9.7d — Dominio de la agencia para el portal (criterio 2) — hecha (2026-10-11)

- **Modelo:** `AgencyDomain` (mismos estados y token que los dominios de sitio; índice parcial de un dominio verificado por agencia). Migración reversible (`down.sql` verificada).
- **Reutiliza la infraestructura de dominios:** el mismo resolvedor DNS (solo consultas TXT a nombres públicos ya validados, sin HTTP), `customDomainSchema`, el registro `_impulza.<dominio>` y el tope por sitio. Un dominio
  queda verificado en **un solo lugar**: índice parcial propio + comprobación cruzada con `site_domains` en ambos sentidos, bajo un candado por nombre (también al agregar).
- **Un dominio no verificado nunca sirve el portal:** `GET /public/portal/:hostname` solo resuelve un dominio `VERIFIED` de una agencia activa con su marca configurada; en cualquier otro caso, el mismo 404 sin pistas.
  Devuelve solo la marca pública (sin ids ni datos de clientes) y tiene límite de peticiones.
- **API:** `GET/POST …/agency/portal-domains`, `POST …/:domainId/verify`, `DELETE …/:domainId` (`agency.manage`; auditado: `agency.portal_domain_added/verified/removed`).
- **UI:** «Dominio del portal» en Agencia › Marca blanca (agregar, instrucciones del TXT, verificar, quitar).
- **Pruebas:** 6 de integración (`agency-domains.e2e.test.ts`, con DNS falso) + caso transversal de aislamiento + Playwright móvil/escritorio (capturas `07`–`08` en `f97/`) y 5 mutaciones (4 atrapadas por la integración; la de
  «agencia sin marca» la cubre una segunda capa del servicio que descarta una marca sin nombre).
- **Reservas honestas:** el certificado https depende del hosting (igual que los dominios de sitio: `sslStatus` queda `PENDING`); el CNAME de destino se define con el dominio definitivo de la plataforma; el portal en sí
  (pantallas del cliente) es F9.7e.

#### F9.7e — Portal del cliente (criterios 1 —pantallas de acceso—, 3 y 6) — hecha (2026-10-11)

- **Rol `CLIENT_VIEWER`** (sembrado; lo asignan propietario y administradores): solo `publish.approve` y `publish.comment`. Revisa lo que se le pide aprobar, comenta y aprueba o rechaza (con motivo); **no puede publicar**
  (no tiene `page.manage`) ni gestionar nada.
- **Deny por defecto en la puerta única:** `clientViewerVerdict` (función pura, 58 casos) deja pasar solo: leer la organización, `panel-brand`, `publish-settings` (lectura), sitios y páginas (lectura), solicitudes de
  publicación (lista, detalle, aprobar, rechazar) y sus comentarios. Todo lo demás —equipo, roles, plan, facturación, cobros, contactos, pedidos, campañas, webhooks, marca, auditoría, formularios, dominios, escrituras—
  responde 403 `CLIENT_VIEWER_LIMIT`. Una ruta nueva queda cerrada para el visor hasta que alguien la abra a propósito.
- **Comentarios** en las solicitudes (`PublishRequestComment`), con permiso `publish.comment`, límite de peticiones, auditoría (`publish_request.commented`) y aislamiento por organización (404 con una solicitud ajena).
- **Aviso:** quien tiene `publish.approve` (incluido el visor) recibe el correo de una solicitud nueva, con la marca de la agencia si la tiene (F9.7b).
- **Pantallas de acceso con la marca de la agencia:** si el panel se visita por el dominio VERIFICADO del portal de una agencia (F9.7d), el login y el registro llevan su marca (sin el mosaico de plantillas); en cualquier
  otro host, la de la plataforma. La resolución nunca bloquea el acceso.
- **UI:** el visor ve un menú con solo «Aprobaciones», su inicio es esa cola, y en la revisión ve el contenido, el hilo de comentarios y aprueba o rechaza.
- **Pruebas:** 7 de integración (`client-portal.e2e.test.ts`) + reglas puras + Playwright móvil/escritorio (`portal-cliente.spec.ts`, capturas `09`–`10` en `f97/`) y 3 mutaciones atrapadas (puerta, aislamiento de comentarios, permiso).
- **Reservas honestas:** los **reportes** que el criterio 3 menciona llegan con F9.8 (la lista permitida los abrirá entonces); servir el panel en el dominio de la agencia exige configurar hosting, CORS y cookies de ese dominio (no
  hay hosting todavía); solo el propietario o un administrador del negocio invita visores (una agencia delegada no toca el equipo del cliente, ADR-028 §2); los comentarios no envían correo; no hay hilos por bloque.

---

### F9.8 — Reportes por cliente

**Criterios de aceptación:**

1. **Informe por cliente** (visitas, clics por bloque, contactos, reservas, pedidos, conversión) con
   **comparación de periodos** (vs. periodo anterior y vs. mismo periodo del año anterior).
2. **Programación** (semanal/mensual) por **cola BullMQ**, idempotente, con registro de cada
   ejecución, reintentos y correo con la marca resuelta (F9.2).
3. **Comentarios** de la agencia en el informe; el cliente (portal) puede responder.
4. **Exportación:** CSV (con mitigación de inyección de fórmulas) y **versión imprimible** (hoja de
   estilos de impresión; sin dependencia de PDF pesada salvo ADR nuevo).
5. **Enlace compartido:** token aleatorio de alta entropía, **solo lectura**, con vencimiento,
   revocable, con límite de tasa, que **no expone datos personales de contactos**; el token no se
   registra en logs.
6. **Los datos salen solo de la organización del cliente** y respetan el módulo permitido a quien
   genera el informe. Prueba de aislamiento.
7. **Pruebas:** cálculo de comparación (valores conocidos), enlace vencido/revocado → 404/410, enlace
   de un cliente no sirve datos de otro, programación idempotente. Playwright móvil/escritorio,
   capturas en `f98/`.

#### F9.8a — Informe por cliente con comparación, CSV e imprimible (criterios 1, 4 y 6) — hecha (2026-10-11)

- **Informe:** visitas, visitantes, clics en bloques y WhatsApp, contactos por formulario y nuevos, reservas, pedidos, ventas pagadas y conversión (contactos / visitantes), con serie diaria y ranking de bloques y páginas.
  Cada cifra se compara con el **periodo anterior** (misma duración, contiguo) y con el **mismo periodo del año anterior** (el 29 de febrero cae al 28). Una base de 0 o ausente no inventa una variación relativa.
- **Reglas puras** (`@impulza/validation`, `reports/`): `previousPeriod`, `sameWindowLastYear`, `compareValue`, `compareTotals`, `conversionRate`, `reportCsv` — probadas con valores conocidos.
- **Respeta el plan:** el periodo pedido obedece al historial de analítica del plan (402); una comparación que cae fuera de él se informa como **no disponible** y no se calcula (los datos viejos no se muestran, ADR-004).
- **Datos solo de la organización de la ruta** y solo cifras agregadas (ningún dato personal de contactos, ni en el JSON ni en el CSV). Para una agencia con acceso delegado, `reports` cuenta como el módulo «Analítica»
  (F9.6b); el visor del portal (F9.7e) lo ve en solo lectura.
- **API:** `GET …/reports/summary?from&to` y `…/summary.csv` (con límite de peticiones; el CSV pasa por `toCsv`/`csvCell`: nombres que empiecen por `=`, `+`, `-` o `@` salen neutralizados; la ruta evita la palabra
  «export», que la agencia delegada tiene vedada).
- **UI:** «Reportes» en el menú: periodos rápidos y fechas libres, tabla con variaciones, conversión, barras por día, ranking, **Descargar CSV** e **Imprimir** (la hoja de impresión oculta menú y controles).
- **Pruebas:** 5 de integración (cifras conocidas, aislamiento por organización, validación, historial del plan, CSV), reglas puras (9), Playwright móvil/escritorio (`reportes.spec.ts`, capturas en `f98/`) y 4 mutaciones
  atrapadas tras fortalecer dos pruebas que no las atrapaban (la mezcla de ventas entre organizaciones se comprobaba con «no contiene un número», que una suma puede esquivar: ahora son valores exactos).
- **Pendiente de F9.8:** **c** programación semanal/mensual por cola con correo, **d** comentarios de la agencia y respuesta del cliente.

#### F9.8b — Enlace compartido de solo lectura (criterio 5) — hecha (2026-10-11)

- **Token:** 32 bytes aleatorios (256 bits, base64url de 43 caracteres) que **no se guarda**: solo su SHA-256. Se muestra una única vez al crearlo y viaja con `Cache-Control: no-store`. Ni la auditoría ni la lista lo llevan.
- **Solo lectura y acotado:** periodo fijo, vencimiento obligatorio (1 a 90 días), revocable (idempotente) y con tope de 20 enlaces vigentes por organización. Sirve **solo cifras agregadas** de la organización dueña (sin contactos ni ids
  internos). Una organización bloqueada o con el sitio oculto por su agencia deja de servirlo; un plan que ya no cubre el historial tampoco.
- **Respuestas:** desconocido o mal formado → 404 (una forma que no es de token ni se consulta); revocado → 410 `LINK_REVOKED`; vencido → 410 `LINK_EXPIRED`. Con límite de peticiones por origen.
- **El token no se registra:** `redactPath` lo oculta en los logs (`/public/reports/<token>[/csv]`), la página va con `noindex`, `Referrer-Policy: no-referrer` y sin caché. Solo se guarda un contador de visitas y la última hora.
- **API:** `GET/POST …/reports/share-links`, `DELETE …/:linkId` (`report.share`; auditado: `report.share_created/revoked`) y `GET /public/reports/:token` y `…/csv`.
- **Sitio público:** `/informe/[token]` (sin sesión; marca del negocio, cifras con su comparación, bloques con más clics y descarga del CSV desde el mismo origen) y mensaje claro cuando el enlace ya no está disponible.
- **UI:** «Compartir este informe» en Reportes (nombre, vencimiento, copiar el enlace una sola vez y lista con visitas y revocar).
- **Pruebas:** 5 de integración (`report-share.e2e.test.ts`) + redacción en logs + caso transversal de aislamiento + Playwright móvil/escritorio (enlace sin sesión, CSV, revocación y 404 de uno inventado; capturas `02`–`04`)
  y 6 mutaciones atrapadas (revocado, vencido, filtro por organización, organización bloqueada, token en claro, tope).
- **Reservas honestas:** el enlace fija el periodo (si termina hoy, cada visita ve cifras actualizadas hasta hoy); no hay contraseña opcional ni lista de correos permitidos; el CSV público lleva los mismos totales del informe.

---

### F9.9 — Moderación y reportes de abuso

**Criterios de aceptación:**

1. **Reportar una página pública:** enlace discreto en la página pública del cliente abre un formulario
   con **motivo de un catálogo cerrado** (spam, suplantación, contenido ilegal, fraude, otro), texto
   opcional acotado y correo opcional. **Límite de tasa por IP**, sin exigir datos personales, sanitizado.
2. **`AbuseReport`** guarda motivo, sitio, estado y resolución; **no** guarda más datos del denunciante
   de los necesarios.
3. **Cola de moderación en `apps/admin`:** listado con filtros y paginación; acciones **auditadas**:
   descartar, advertir al propietario, **despublicar el sitio**, **suspender la organización**; todas
   reversibles y con motivo obligatorio.
4. **Aviso al propietario** por correo con el motivo y una **vía de apelación**; la apelación reabre el caso.
5. **Anti-abuso del propio mecanismo:** un mismo IP/usuario no puede inundar reportes; un sitio con
   muchos reportes sube de prioridad, pero **nunca se despublica automáticamente**.
6. **Pruebas:** límite de tasa, sanitización, solo superadmin modera, despublicar/restaurar, apelación.
   Playwright (admin y página pública, móvil/escritorio), capturas en `f99/`.

---

### F9.10 — Aislamiento, seguridad y cierre de la fase

**Criterios de aceptación:**

1. Todos los endpoints de la fase están en `multi-tenant-isolation.e2e.test.ts` y en el conjunto de
   «agencia no sale de su cupo».
2. **Revisión de amenazas** escrita en `docs/architecture/` (suplantación por marca blanca, escalada por
   roles, enlaces compartidos, importación CSV, dominios) con la mitigación y su prueba.
3. OpenAPI regenerado y probado; ERD, ARCHITECTURE, README, CONTINUIDAD y trazabilidad actualizados.
4. **Suite completa:** `pnpm turbo run typecheck lint test --continue` (a log), `next build` de dashboard,
   web y admin, y **Playwright completo**, todo en verde.
5. Barrido de **accesibilidad** (`design:accessibility-review`) y de **consistencia visual**
   (`design:design-critique`, `design:design-system`) sobre todas las pantallas nuevas, con hallazgos
   corregidos o documentados.
6. Lista final de reservas (qué no se probó) escrita con honestidad.

---

## Hoja de ruta posterior (no entra en la Fase 9)

Versión 2 del plan maestro (§19), a definir en su propio backlog: **membresías y cursos**, **wallet y
tarjeta digital** (el pase de Apple requiere certificados del propietario: se deja para el momento de las
credenciales), **PWA avanzada** (solo si las métricas lo justifican) y **marketplace** (diferido hasta
resolver KYC, tributación, reembolsos y contracargos, ST §12).

## Antes de producción (no es código, es del propietario)

Credenciales de proveedores (Mercado Pago real, Google OAuth, correo con dominio verificado, R2),
hosting de producción, política de privacidad revisada por un abogado, staging y backups con prueba de
restauración. El sistema se **desarrolla sin ellas**: cada integración tiene su estado «sin
configurar» y su respaldo, y se activan al poner las credenciales.
