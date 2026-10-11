# Backlog — Fase 10: Versión 2 (membresías y cursos, wallet y tarjeta digital, PWA, marketplace)

**Decisión base:** ADR-029. **Orden:** F10.1 a F10.7, una historia por vez, con commit por historia y push al cerrar cada una.
Todas cumplen la Definición de Terminado de `CLAUDE.md` (validación en servidor, aislamiento entre organizaciones con su
prueba, estados de carga/vacío/error/éxito, responsive, pruebas, OpenAPI, migración reversible, telemetría, documentación).

| Historia | Título | Estado |
|---|---|---|
| F10.1 | Miembros de sitio y contenido protegido (enlace mágico) | **Hecha** (2026-10-11): API 12/12, suite 74/74 (API 1035), Playwright 4/4; reservas en el detalle |
| F10.2 | Planes de membresía y cobro por la cuenta del negocio | **Hecha la parte (a)** (2026-10-11): planes, compra, acceso por vigencia, reembolsos; falta (b) avisos de renovación y vencimiento |
| F10.3 | Cursos: módulos, lecciones y progreso | Pendiente |
| F10.4 | Tarjeta digital, vCard y pases de wallet | Pendiente |
| F10.5 | PWA: instalación y modo sin conexión acotado | Pendiente |
| F10.6 | Marketplace de integraciones y plantillas | Pendiente |
| F10.7 | Aislamiento, seguridad y cierre de la Fase 10 | Pendiente |

---

## F10.1 — Miembros de sitio y contenido protegido

1. **Modelo** `SiteMember` (organización, sitio, correo normalizado, estado, creado) con único `(site_id, email)`; sesión
   propia de miembro (`SiteMemberSession`, solo hash del token, vencimiento, revocable). Sin relación con `User`.
2. **Acceso por enlace mágico:** el visitante pide acceso con su correo; recibe un enlace de un solo uso con vencimiento
   corto; respuesta idéntica exista o no el correo (sin enumeración); límite de tasa por IP y por correo.
3. **Bloque «contenido protegido»** y marca de página «solo miembros»: el servidor decide el acceso; sin sesión válida el
   contenido **no se envía** (no basta ocultarlo en el frontend).
4. **Panel:** lista de miembros (buscar, filtrar, paginar, revocar) con permiso `membership.manage`; auditado.
5. **Privacidad:** correo solo del sitio, baja/eliminación por el propio miembro, sin datos de otros sitios.
6. **Pruebas:** enlace de un solo uso y vencimiento, sin enumeración, contenido no filtrado sin sesión, aislamiento entre
   organizaciones y entre sitios, revocación inmediata, Playwright (pedir acceso, entrar, ver contenido, salir).

**Hecha — F10.1 (2026-10-11):**

- **Modelo** (migración reversible `20261011190000_f101_site_members`): `SiteMember` (único `(sitio, correo)`, correo en minúsculas con `CHECK`), `SiteMemberLoginToken` y `SiteMemberSession` (solo el
  SHA-256 del token), y `Page.members_only` (en vivo, no versionado). Sin relación con `User`. **Atención:** revertir la migración vuelve públicas las páginas restringidas (queda escrito en `down.sql`).
- **La caché pública nunca lleva el contenido:** una página `membersOnly` se devuelve **sin bloques**, con `robots: noindex_nofollow` y sin descripción ni imagen (se corta antes de resolver bloques, A/B o Smart
  CTA). El contenido sale solo por `GET /public/sites/:slug/members/pages/:page` con sesión de ESE sitio y `Cache-Control: no-store`. La página sigue en el menú, marcada, y se excluye del `sitemap.xml`.
- **Acceso sin contraseña:** `POST …/members/access` (misma respuesta para cualquiera: sin enumeración; límite por IP y 3 por correo cada 10 min; el correo se envía sin esperar para que el tiempo no delate), enlace de
  un solo uso que vence en 15 min y se canjea con un clic (`POST /public/members/verify`, también ante dos canjes simultáneos), sesión de 30 días en cookie `HttpOnly` por sitio.
- **Corte inmediato:** revocar a un miembro revoca sus sesiones e inutiliza sus enlaces pendientes; además cada petición vuelve a comprobar que el miembro siga activo y el sitio servido (moderación, bloqueo,
  archivo).
- **Panel:** `/sitios/:id/miembros` (marcar páginas, alta, búsqueda, filtro, paginación, revocar/reactivar/quitar con borrado de datos). Permiso nuevo `member.manage` (OWNER y ADMIN). Todo auditado, sin correos
  en la auditoría.
- **Defecto preexistente corregido de paso:** una cookie de sesión de panel con formato inválido producía un 500; ahora es 401 (`SessionAuthGuard`).
- **Pruebas:** 6 de validación; 12 de integración (puerta, sesión por sitio, sin enumeración, un solo uso, carrera, revocación, defensa en profundidad, moderación/bloqueo, panel, permisos y aislamiento, tope);
  3 de proxys de `apps/web`; barrido de aislamiento automático con las rutas nuevas (OpenAPI 310 rutas); **3 mutaciones atrapadas** (sin puerta, enlace reutilizable, sesión sin estado — esta última exigió una
  prueba nueva); Playwright `miembros.spec.ts` móvil y escritorio.
- **Reservas honestas:** el alta es solo por invitación del propietario (el alta por compra llega con F10.2); sin límite de miembros por plan (solo el tope técnico de 5000 por sitio); el contenido protegido
  es por **página**, no por bloque; los correos usan el adaptador de consola hasta que el propietario configure el proveedor real.

## F10.2 — Planes de membresía y cobro recurrente

1. `MembershipPlan` (nombre, descripción, precio en unidad mínima, periodicidad mensual/anual, acceso a qué contenido).
2. Suscripción de miembro (`MemberSubscription`: estado, vigencia, próxima renovación) y **checkout por la cuenta de
   Mercado Pago del negocio** (ADR-013) mediante el adaptador de pagos existente; webhooks firmados e idempotentes.
3. Renovación y vencimiento como **jobs idempotentes**; período de gracia configurable; cancelación por el miembro.
4. Aviso por correo (compra, renovación, falla, cancelación) con la marca resuelta de la organización.
5. Panel: planes (crear, editar, archivar), miembros con su estado, ingresos del periodo.
6. **Pruebas:** proveedor simulado (aprobado, rechazado, pendiente, reembolsado), idempotencia del webhook, vigencia que
   corta el acceso, doble cobro imposible, aislamiento, Playwright de compra y cancelación.

**Hecha — F10.2a (2026-10-11): planes, compra y acceso por periodo pagado.**

- **Modelo** (migración reversible `20261011200000_f102_membership_plans`): `MembershipPlan` (precio entero en la unidad mínima, `CHECK > 0`, moneda de 3 letras), `MembershipPurchase` (copia del plan, pago único y
  asignado de forma condicional, vigencia con `CHECK` de que una compra pagada tiene periodo) y `SiteMember.source` (`INVITED` | `PURCHASED`). Revertirla deja a los compradores como invitados (conservan acceso): documentado
  en `down.sql`.
- **Modelo de cobro: periodos PREPAGADOS que se apilan, sin cobro automático.** Cada compra paga un periodo de 30 o 365 días; renovar antes suma los días (el nuevo empieza donde termina el vigente). Se eligió así porque
  reutiliza el Checkout Pro del negocio ya verificado (ADR-013) y no exige permisos de suscripción sobre la cuenta del vendedor.
- **El dinero va directo a la cuenta de Mercado Pago del negocio** (Impulza no custodia ni cobra comisión). El precio sale del plan guardado: el cuerpo de la compra rechaza cualquier campo de precio. La confirmación
  nunca sale del aviso ni de la URL de regreso: se consulta el pago con el token del negocio y se aplica solo si la cuenta receptora, la referencia, el monto y la moneda coinciden; asignar el pago es condicional (dos
  avisos simultáneos: uno activa, otro `unchanged`). Un pago aprobado que llega con el cobro vencido igual se aplica.
- **Acceso por vigencia:** un miembro invitado entra mientras esté activo; uno que compró, solo con un periodo pagado vigente y aprobado. Un reembolso total, un contracargo o un reclamo lo cortan (parcial no). La
  sesión sigue siendo válida: el contenido responde **403 `MEMBERSHIP_INACTIVE`** y la puerta ofrece renovar. Un miembro revocado no puede comprar.
- **API:** panel `…/members/plans` (crear, editar, archivar, restaurar; tope de 10 planes activos; solo CLP por ahora, que es lo que cobra el Checkout Pro integrado; ingresos del mes neto de devoluciones y miembros vigentes
  por plan); público `GET …/members/plans`, `POST …/members/plans/:id/checkout`, `GET /public/memberships/purchases/:token`; webhook firmado `POST /payments/mercadopago/memberships/:id/webhook`.
- **Web:** la puerta ofrece comprar (o renovar) si el negocio tiene cuenta conectada; `/membresia/:token` («Tu membresía», con el tema del sitio, `noindex`, sin caché). **Panel:** sección «Planes de membresía» con aviso
  de «conecta tu cuenta» y origen/vigencia de cada miembro.
- **Defecto encontrado por la prueba de navegador y corregido:** un componente cliente arrastraba la validación de variables de entorno del servidor; el formateador de precio vive ahora en un módulo sin dependencias
  del servidor.
- **Pruebas:** 10 de validación (planes, reglas de acceso, apilado), 11 de integración (panel, permisos y aislamiento, sin cuenta, precio del plan, firma, mismatch de monto/cuenta/pago ajeno, carrera, apilado y
  vencimiento, reembolso, revocado/archivado/falla de pasarela, sitio despublicado), 3 de proxy web, Playwright `membresias.spec.ts` + regresión de `miembros.spec.ts` 8/8; **4 mutaciones atrapadas** (sin verificar
  monto/cuenta, asignación no condicional, sin regla de vigencia, periodos sin apilar). Barrido de aislamiento automático con las rutas nuevas (OpenAPI 317 rutas).
- **Reservas honestas:** (1) **sin cobro recurrente automático** (Mercado Pago permite preaprobaciones en la cuenta del vendedor, pero exige otro permiso OAuth y credenciales reales para probarse); (2) **aún sin
  recordatorios de renovación ni aviso de vencimiento** (F10.2b); (3) la compra real contra Mercado Pago se prueba con la pasarela simulada: Playwright no tiene la aplicación configurada, así que el botón de pago no se
  ejerce contra Mercado Pago; (4) solo CLP; (5) la devolución se hace desde Mercado Pago (no desde el panel): el aviso la registra y corta el acceso.

## F10.3 — Cursos

1. `Course` → `CourseModule` → `Lesson` (texto enriquecido saneado, video por enlace/incrustado permitido, archivo protegido).
2. Acceso por plan de membresía o por compra única (reusa catálogo/pedidos); el servidor entrega solo lo permitido.
3. Progreso por miembro (lección completada, porcentaje), reanudar donde quedó.
4. Constructor en el panel: crear, ordenar (arrastrar), publicar/ocultar; vista previa.
5. Página pública del curso con temario visible y contenido bloqueado según acceso.
6. **Pruebas:** orden y progreso, acceso por plan y por compra, contenido no filtrado, aislamiento, Playwright móvil y
   escritorio.

## F10.4 — Tarjeta digital, vCard y pases de wallet

1. `DigitalCard` por organización/sitio (nombre, cargo, contactos, redes, QR) con página pública propia.
2. Descarga **vCard** válida (campos escapados, sin inyección de líneas) y QR de la tarjeta.
3. `WalletPassProvider`: Google Wallet (JWT firmado) y Apple Wallet (`.pkpass`); sin credenciales responde «no disponible»
   con un mensaje claro y el resto sigue funcionando.
4. **Pruebas:** vCard contra casos hostiles (saltos de línea, comillas), adaptador simulado, sin credenciales, aislamiento.

## F10.5 — PWA

1. Manifiesto e iconos para el panel y para la página pública; instalación guiada.
2. Service worker que cachea solo recursos estáticos y una pantalla sin conexión; **nunca** respuestas de API.
3. Actualización controlada (aviso «hay una versión nueva»), sin dejar a nadie en una versión rota.
4. **Pruebas:** que ninguna respuesta de API ni de sesión se cachea, funcionamiento sin conexión de la pantalla acotada,
   Lighthouse PWA instalable, Playwright.

## F10.6 — Marketplace de integraciones y plantillas

1. `MarketplaceListing` (tipo integración/plantilla, socio, versión, permisos que pide, estado de revisión).
2. Directorio público y panel de instalación por organización (permiso `marketplace.install`); instalación reversible.
3. Revisión por superadministración (aprobar, rechazar con motivo, retirar) con auditoría.
4. Reglas de seguridad: lo instalado nunca ejecuta HTML/JS arbitrario en páginas públicas; sin custodia de dinero.
5. **Pruebas:** instalación y desinstalación, aislamiento, listado no aprobado invisible, retiro que desinstala, Playwright.

## F10.7 — Aislamiento, seguridad y cierre de la Fase 10

1. Endpoints de la fase en el barrido de aislamiento y en las pruebas por recurso.
2. Revisión de amenazas (enlaces mágicos, contenido de pago, caché del service worker, pases de wallet, marketplace).
3. OpenAPI, ERD, ARCHITECTURE, README, CONTINUIDAD y trazabilidad actualizados.
4. Suite completa, builds y Playwright completo en verde; barrido de accesibilidad y de consistencia visual.
5. Lista final de reservas, escrita con honestidad.
