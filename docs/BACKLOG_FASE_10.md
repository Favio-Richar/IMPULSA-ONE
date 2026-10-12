# Backlog — Fase 10: Versión 2 (membresías y cursos, wallet y tarjeta digital, PWA, marketplace)

**Decisión base:** ADR-029. **Orden:** F10.1 a F10.7, una historia por vez, con commit por historia y push al cerrar cada una.
Todas cumplen la Definición de Terminado de `CLAUDE.md` (validación en servidor, aislamiento entre organizaciones con su
prueba, estados de carga/vacío/error/éxito, responsive, pruebas, OpenAPI, migración reversible, telemetría, documentación).

| Historia | Título | Estado |
|---|---|---|
| F10.1 | Miembros de sitio y contenido protegido (enlace mágico) | **Hecha** (2026-10-11): API 12/12, suite 74/74 (API 1035), Playwright 4/4; reservas en el detalle |
| F10.2 | Planes de membresía y cobro por la cuenta del negocio | **Hecha** (2026-10-11): (a) planes, compra, acceso por vigencia y reembolsos; (b) avisos de renovación y de vencimiento; reservas en el detalle |
| F10.2c | Webpay Plus como medio de cobro del negocio (ADR-030): cuenta propia + membresías | **Hecha** (2026-10-11) |
| F10.2d | Webpay Plus en los pedidos de la tienda (ADR-030) | **Hecha** (2026-10-11) |
| F10.2e | Webpay Plus en las señas de reservas (ADR-030) | **Hecha** (2026-10-11) |
| F10.3 | Cursos: módulos, lecciones y progreso | **Hecha** (2026-10-12): API 13/13, validación 8/8, Playwright 4/4 (2 viewports); compra única fuera de alcance (ver reservas) |
| F10.4 | Tarjeta digital, vCard y pases de wallet | **Hecha** (2026-10-12): API 16/16 (9 integración + 7 de wallet), validación 7/7, Playwright 4/4 (2 viewports); pases reales pendientes de credenciales |
| F10.5 | PWA: instalación y modo sin conexión acotado | **Hecha** (2026-10-12): paquete `@impulza/pwa` 11/11, Playwright 6/6 (2 viewports); sin auditoría Lighthouse (ver reservas) |
| F10.6 | Marketplace de integraciones y plantillas | **Hecha** (2026-10-12): API 12/12, Playwright 2/2 (2 viewports); suite completa pendiente de F10.7 |
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

**Hecha — F10.2b (2026-10-11): avisos de renovación y de vencimiento.**

- **Qué avisa:** un recordatorio en la última semana antes de que termine el periodo y un aviso poco después de que termina (hasta 3 días; no de lo que venció hace tiempo). Cada uno se manda **una sola vez por
  compra**: la marca (`renewal_reminder_sent_at`, `expiry_notice_sent_at`, migración reversible `20261011210000_f102b_membership_notices`) se reclama de forma condicional antes de enviar, así que varias réplicas o
  pasadas no duplican nada.
- **A quién NO avisa:** a quien ya renovó (otro periodo vigente termina después), a un miembro revocado o invitado, de un pago reembolsado, en disputa o sin aprobar, ni en un sitio despublicado o de una
  organización bloqueada. El correo lleva la marca del negocio, el enlace al sitio (donde la puerta ofrece renovar) y dice expresamente que no se cobra nada automáticamente.
- **Cola** `membership-lifecycle` (BullMQ en la API, `tick` cada hora; registrada en el panel de operaciones; `MEMBERSHIP_SCHEDULER_DISABLED=true` la apaga; no arranca bajo Vitest). Un fallo de correo se
  registra y no se reintenta a ciegas (a lo más una vez por compra, nunca en bucle).
- **Pruebas:** 5 de reglas puras (ventanas, una vez, renovó, no avisa lo reembolsado/en disputa) y 6 de integración (recordatorio, vencimiento, exclusiones, sitio oculto/bloqueado, 6 pasadas simultáneas, fallo
  de correo); **3 mutaciones atrapadas** (sin reclamo condicional —la primera versión de la prueba de carrera no la detectaba y se endureció—, sin filtrar revocados, sin mirar si ya renovó).
- **Reserva:** el «período de gracia configurable» del backlog **no aplica** al modelo prepagado (el acceso termina con el periodo pagado); si el negocio quiere dar días extra, puede invitar al miembro. La
  «cancelación por el miembro» tampoco aplica: no hay cobro automático que cancelar.

**Hecha — F10.2c (2026-10-11): Webpay Plus como medio de cobro del negocio (ADR-030).**

- **Cuenta propia del negocio:** `PUT/DELETE /organizations/:id/payment-accounts/webpay-plus` (solo quien tiene `payments.connect`). Código de comercio (12 dígitos), llave secreta y ambiente. Las credenciales se
  **comprueban de verdad** creando una transacción de prueba de $50 en Transbank (que no se paga ni se cobra y vence sola): si no sirven, no se guarda nada (`WEBPAY_CREDENTIALS_REJECTED` / `WEBPAY_UNAVAILABLE`). La
  llave queda cifrada con la misma clave que los tokens de Mercado Pago y nunca vuelve a salir (el estado solo muestra los últimos 4 dígitos del comercio). Una cuenta por pasarela por organización
  (`PaymentGateway.WEBPAY_PLUS`, migración `20261011220000_f102c_webpay_plus_account`); la suscripción de Impulza nunca usa ese valor (se falla ruidosamente si apareciera).
- **Dinero directo al comercio del negocio:** Impulza no custodia ni cobra comisión. Se descartó una «tienda hija» de Impulza que reciba y reparta (sería custodiar dinero de terceros).
- **Compra de membresía con Webpay:** el visitante ve los medios conectados y elige (si hay uno solo, ese). El servidor crea la transacción con una orden de compra corta y aleatoria y el **precio del plan
  guardado**; el comprador vuelve a `…/payments/webpay/memberships/:id/return` y **el servidor confirma** con las credenciales del negocio (Webpay no manda webhooks). Se confirma el token que GUARDAMOS (nunca el de
  la URL) y solo se aplica si queda autorizada y coincide el orden de compra y el monto; asignar el pago es condicional (varios regresos simultáneos: una sola activación). Tarjeta rechazada: queda pendiente con su
  motivo y se reintenta. Abandonar la ventana no cobra nada. Columnas `payment_provider` y `provider_order_ref` en la compra (migración `20261011230000_f102c_membership_provider`).
- **Web:** la puerta de la página muestra los medios y envía por POST a Webpay con `token_ws`; «Tu membresía» sirve para ambos. **Panel:** tarjeta «Webpay Plus (Transbank)» en Cobros (llave en campo de contraseña,
  nunca rellenada de vuelta) y los planes avisan si no hay ningún medio conectado.
- **Pruebas:** 11 del adaptador (REST, ambientes, errores, simulador), 9 de integración (conexión, forma, credenciales rechazadas, Transbank caído, permisos, medios disponibles, creación, confirmación única, POST de
  regreso, token ajeno/abandono/enlace inválido, tarjeta rechazada y monto distinto, regresos simultáneos, cambio de comercio) y Playwright (formulario y cuenta conectada, 16/16 con la regresión de cobros y
  membresías); **4 mutaciones**: 3 atrapadas (sin verificar monto/orden/estado, sin validar el enlace de estado, asignación no condicional) y 1 equivalente (validar el token de la URL es redundante porque nunca
  se confirma ese token; queda documentado y probado que una transacción ajena NO se consume).
- **Reservas honestas:** (1) **Webpay Plus no avisa reembolsos ni contracargos**: a diferencia de Mercado Pago, la devolución no se detecta sola; el negocio puede revocar al miembro y queda pendiente una acción
  «anular compra» en el panel; (2) **no se ejerció contra Transbank real**: se probó con el simulador y con las credenciales públicas de integración documentadas; el propietario debe probar con su código de
  comercio al conectar; (3) ~~las señas de reservas no ofrecían Webpay~~ (resuelto en F10.2e); (4) solo CLP; (5) cada negocio debe contratar Webpay Plus con Transbank (trámite suyo, fuera del
  producto: la pantalla de Cobros lo explica).

**Hecha — F10.2d (2026-10-11): Webpay Plus en los pedidos de la tienda (ADR-030).**

- **Cómo se ofrece:** con Mercado Pago y/o Webpay Plus conectados, el pedido guarda el plazo de pago y el enlace «Tu pedido» (de siempre) y la confirmación ofrece los medios disponibles. Con Webpay solo, el enlace
  externo de pago del producto deja de mostrarse (igual que con Mercado Pago). Sin ninguno, nada cambia.
- **La transacción se crea al pulsar «Pagar con Webpay» en «Tu pedido»** (`POST /public/orders/:token/webpay`, con límite de tasa): cada intento necesita la suya (Transbank no admite pagar dos veces la misma) y
  así un intento rechazado o abandonado se reintenta sin pedir otra vez el pedido. El monto es el **total guardado del pedido** (cupón y líneas incluidos), nunca uno enviado por el visitante; `sessionId` = pedido.
- **Regreso y confirmación** (`/payments/webpay/orders/:orderId/return`, GET y POST, 303 a «Tu pedido»): el servidor confirma la transacción **guardada** (la última creada; una anterior de otra pestaña no se
  confirma y Transbank la revierte sola) y solo marca pagado si queda autorizada y coinciden orden de compra y monto. Marcar pagado es condicional (6 regresos simultáneos: un solo pago, un solo aviso). Pedido ya
  cancelado → se registra el pago y se avisa al negocio, igual que con Mercado Pago. Tarjeta rechazada → queda `rejected` y se reintenta.
- **Datos:** `orders.payment_provider` (último intento / pasarela que cobró), `webpay_token`, `webpay_buy_order` (única); migración reversible `20261011240000_f102d_order_webpay`. El pago se identifica como
  `webpay:<orden de compra>` en `provider_payment_id` (única: un pago nunca paga dos pedidos).
- **Lo que cambia en el resto del sistema:** correos del comprador y del negocio nombran la pasarela correcta (antes decían siempre «Mercado Pago»); el webhook saliente `order.*` informa `provider: WEBPAY_PLUS`;
  el panel de pedidos muestra «Pagado con Webpay Plus · orden …» y **no ofrece «Devolver dinero»** (la API devuelve 422 con la explicación): la devolución se hace en el portal de Transbank.
- **Defecto encontrado y corregido en la prueba de navegador:** la CSP de `apps/web` tenía `form-action 'self'`, que **bloqueaba el envío del formulario a Webpay** (también el de F10.2c). Ahora `form-action`
  incluye `https://*.transbank.cl`; con prueba unitaria de la política y prueba de navegador que ejerce el envío real.
- **Pruebas:** 13 de integración (solo Webpay, monto/comercio/sessionId, confirmación única y avisos, regresos simultáneos, rechazo y reintento, monto distinto, token ajeno, abandono, vencido/cancelado,
  Transbank caído, dos medios, devolución bloqueada, aislamiento entre negocios) + las 8 de pedidos con Mercado Pago sin cambios; Playwright (4 × 2 viewports); **4 mutaciones** todas atrapadas (sin verificar
  monto/orden, asignación no condicional, sin guarda de devolución, sin vigencia).
- **Reservas honestas:** misma lista de F10.2c (sin avisos de devolución/contracargo de Webpay, no ejercido contra Transbank real, solo CLP). Además: la **devolución de un pedido pagado con Webpay es manual**
  hasta que exista la acción «anular compra» en el panel (se anota como siguiente paso del propio ADR-030).

**Hecha — F10.2e (2026-10-11): Webpay Plus en las señas de reservas (ADR-030).**

- **Cómo se ofrece:** con Mercado Pago y/o Webpay Plus conectados, la reserva con seña queda `PENDING_PAYMENT` (la hora tomada hasta el plazo) y la confirmación ofrece los medios disponibles. Mercado Pago crea la
  preferencia en el acto; Webpay se paga desde «Tu reserva». Si ninguna pasarela puede, la reserva se confirma sin seña: nunca se pierde una reserva por la pasarela.
- **La transacción se crea al pulsar «Pagar con Webpay»** (`POST /public/bookings/:token/webpay`, con límite de tasa y el enlace firmado como credencial): cada intento crea la suya. El monto es la **seña guardada**
  de la reserva, nunca uno enviado por el visitante; `sessionId` = reserva.
- **Regreso y confirmación** (`/payments/webpay/bookings/:token/return`, GET y POST, 303 a «Tu reserva»): el servidor confirma la transacción **guardada**, no la de la URL, y solo confirma la reserva si queda
  autorizada y coinciden orden de compra y monto. La confirmación es condicional (6 regresos simultáneos: una sola confirmación, un solo aviso). Si el plazo venció y el worker ya liberó la hora, se reutiliza
  la rutina de Mercado Pago: confirma si la hora sigue libre; si no, deja constancia y avisa al negocio.
- **Datos:** `bookings.payment_provider`, `webpay_token`, `webpay_buy_order` (única); migración reversible `20261012020000_f102e_booking_webpay`. El pago queda como `webpay:<orden de compra>` en `provider_payment_id`.
- **Resto del sistema:** correos del cliente y del negocio nombran la pasarela correcta; el panel de agenda muestra «Seña pagada con Webpay Plus · orden …» y **no ofrece devolver** (la API responde 422 y explica
  que se hace en el portal de Transbank).
- **Pruebas:** 13 de integración (solo Webpay, monto/comercio/sessionId, confirmación única y avisos, regresos simultáneos, rechazo y reintento, monto distinto, token ajeno, abandono, vencida/cancelada, Transbank
  caído, dos medios, devolución bloqueada, aislamiento) + las 65 de reservas existentes sin cambios (82 con OpenAPI).
- **Reservas honestas:** las mismas de F10.2c/F10.2d (sin avisos de devolución/contracargo de Webpay, devolución manual en Transbank, no ejercido contra Transbank real, solo CLP). Pendiente de F10.2e: prueba
  Playwright del botón «Tu reserva» (la ruta y el botón están cubiertos por integración y por el mismo envío de formulario ya probado en F10.2d).

## F10.3 — Cursos

**Hecha — F10.3 (2026-10-12): cursos, módulos, lecciones y progreso (ADR-029).**

- **Modelo:** `Course` → `CourseModule` → `Lesson` (texto enriquecido **saneado en el servidor** o video por proveedor + id, nunca una URL libre), `CoursePlan` (planes que dan acceso) y `LessonProgress` (único por miembro y lección). Migración reversible `20261012030000_f103_courses`; permiso nuevo `course.manage` (OWNER y ADMIN).
- **Acceso decidido por el servidor** (`canAccessCourse`): `OPEN` cualquiera; `MEMBERS` un miembro invitado activo o con un periodo pagado vigente; `PLAN` solo con un periodo vigente de un plan del curso (un invitado sin compra no entra; reembolso total o contracargo cortan). El contenido de una lección bloqueada **nunca viaja**: 403 `COURSE_LOCKED` sin cuerpo ni video. Una lección «de muestra» la ve cualquiera.
- **Progreso por miembro:** marcar/desmarcar (idempotente), porcentaje, «retomar donde quedó»; exige sesión de miembro con acceso al curso. Ninguna respuesta se cachea (depende de la sesión).
- **Panel** (`/sitios/:id/cursos`): lista, alta, editor con datos, portada, acceso/planes, publicar/ocultar, módulos y lecciones con orden (flechas), mover de módulo, lecciones de texto o video, duración y «de muestra»; avance de alumnos. «Mi sistema» muestra el área de cursos.
- **Público** (`/:sitio/c`, `/c/:curso`, `/c/:curso/:leccion`) dentro del tema del sitio, con puerta de miembros (y compra de membresía) cuando falta acceso; el avance se guarda por una ruta propia que exige cabecera anti-CSRF y lee la cookie `HttpOnly`.
- **Topes:** 50 cursos por sitio, 30 módulos por curso, 60 lecciones por módulo, 10 planes por curso. Publicar exige al menos una lección; quitar la última devuelve el curso a borrador.
- **Pruebas:** 13 de integración (armado y orden, validación, borrador oculto, lección bloqueada sin contenido, acceso MEMBERS/PLAN/OPEN con sesión vencida/ajena/revocada/reembolsada, progreso y aislamiento entre personas, saneo, aislamiento entre negocios, auditoría, direcciones), 8 unitarias de reglas y Playwright (armar → publicar → visitante → miembro → avanzar) en teléfono y escritorio.
- **Reservas honestas:** (1) **no hay compra única de un curso**: el acceso es por membresía (un plan anual cubre «comprar el curso» mientras no exista un producto de curso); (2) sin certificados, comentarios ni cuestionarios; (3) sin archivos descargables dentro de la lección (los videos son embebidos de YouTube/Vimeo/TikTok); (4) el orden se cambia con flechas, no arrastrando.

1. `Course` → `CourseModule` → `Lesson` (texto enriquecido saneado, video por enlace/incrustado permitido, archivo protegido).
2. Acceso por plan de membresía o por compra única (reusa catálogo/pedidos); el servidor entrega solo lo permitido.
3. Progreso por miembro (lección completada, porcentaje), reanudar donde quedó.
4. Constructor en el panel: crear, ordenar (arrastrar), publicar/ocultar; vista previa.
5. Página pública del curso con temario visible y contenido bloqueado según acceso.
6. **Pruebas:** orden y progreso, acceso por plan y por compra, contenido no filtrado, aislamiento, Playwright móvil y
   escritorio.

## F10.4 — Tarjeta digital, vCard y pases de wallet

**Hecha — F10.4 (2026-10-12): tarjeta digital, vCard y pases de wallet (ADR-029).**

- **Modelo:** `DigitalCard`, una por sitio (nombre, cargo, empresa, presentación, teléfono, WhatsApp, correo, web, dirección, foto y hasta 8 redes); migración reversible `20261012040000_f104_digital_card`. Se edita con el permiso `site.update`; guardar queda auditado (`digital_card.updated`).
- **Público** (`/:sitio/t`, dentro del tema del sitio): foto, nombre, cargo, acciones (guardar contacto, WhatsApp, llamar, correo, web), redes, dirección, **QR** de la tarjeta y botones de wallet. Mientras la tarjeta no esté activa, la página, la vCard y los pases responden **404**.
- **vCard 3.0** (`/:sitio/t/vcard`): campos escapados (barra, punto y coma, coma, saltos), caracteres de control quitados, líneas plegadas a 75 octetos sin partir UTF-8, teléfonos y URLs inválidos omitidos, nombre de archivo saneado. Probada contra valores hostiles: ningún campo puede abrir una propiedad ni otra tarjeta.
- **Wallet detrás de `WalletPassProvider`:** **Google Wallet** (JWT RS256 con la clase y el objeto del pase, sin crear nada antes en el emisor) y **Apple Wallet** (`.pkpass` con `pass.json`, íconos, manifiesto SHA-1 y firma PKCS#7 desprendida con el certificado del emisor y la cadena WWDR). Variables `GOOGLE_WALLET_*` / `APPLE_WALLET_*` (todas las de un proveedor o ninguna). **Sin credenciales: 503 `WALLET_UNAVAILABLE` con un mensaje claro, el botón no se muestra y la tarjeta y la vCard siguen.** Los datos del pase salen solo de la tarjeta del sitio dueño.
- **Panel** (`/sitios/:id/tarjeta`): formulario con foto desde la biblioteca, redes, activación, enlace público copiable, QR y estado de los pases.
- **Dependencias nuevas:** `node-forge` (firma PKCS#7 del pase de Apple) y `fflate` (zip del `.pkpass`) en la API; `qrcode` en `apps/web` (el QR se genera en el servidor).
- **Pruebas:** 9 de integración (ciclo del panel, activación, validación, vCard sin inyección, pase de Google y de Apple por el adaptador, sin credenciales, aislamiento, sin sesión), 7 de proveedores (JWT verificado con la clave pública; `.pkpass` con hashes del manifiesto y **firma PKCS#7 verificada** contra el certificado), 7 unitarias de vCard y reglas, y Playwright en teléfono y escritorio.
- **Reservas honestas:** (1) **los pases reales no se probaron contra Google ni Apple**: faltan las credenciales del propietario (cuenta de emisor de Google Wallet y certificado de Apple); se verificó la firma con certificados de prueba; (2) la tarjeta usa el tema del sitio, sin diseño propio del pase (colores fijos oscuros); (3) la fotografía no se incrusta en el pase de Apple (solo íconos sólidos) ni en el de Google; (4) una sola tarjeta por sitio (no por persona del equipo); (5) no hay límite de plan específico para tarjetas (el diseño original lo mencionaba): queda acotada a una por sitio.

1. `DigitalCard` por organización/sitio (nombre, cargo, contactos, redes, QR) con página pública propia.
2. Descarga **vCard** válida (campos escapados, sin inyección de líneas) y QR de la tarjeta.
3. `WalletPassProvider`: Google Wallet (JWT firmado) y Apple Wallet (`.pkpass`); sin credenciales responde «no disponible»
   con un mensaje claro y el resto sigue funcionando.
4. **Pruebas:** vCard contra casos hostiles (saltos de línea, comillas), adaptador simulado, sin credenciales, aislamiento.

## F10.5 — PWA

**Hecha — F10.5 (2026-10-12): app instalable y modo sin conexión acotado (ADR-029).**

- **Paquete `@impulza/pwa`:** una sola fuente del service worker (texto generado, servido en `/sw.js` por el panel y por el sitio público), del manifiesto y del componente de cliente (registro, aviso de versión nueva e instalación).
- **Manifiestos:** panel (`/manifest.webmanifest`, `standalone`, íconos 192/512/maskable), sitio de la plataforma y **uno por sitio** (`/:sitio/manifest.webmanifest`, con el nombre y los colores del tema del sitio; `start_url` y `scope` dentro de `/:sitio/`). Íconos y `offline.html` estáticos en `public/`.
- **Service worker (regla de oro):** nunca atiende peticiones que no sean GET, de otro origen (la API, los medios) ni `/api/` ni `/sw.js`; **las páginas van siempre a la red** y solo si falla se muestra la pantalla «Sin conexión» precacheada; solo guarda estáticos con huella (`/_next/static/`) e íconos, y jamás una respuesta con `Set-Cookie` o un error. Nada con sesión ni datos en caché.
- **Actualización controlada:** la versión nueva se instala y **espera**; la página muestra «Hay una versión nueva disponible» y solo al pulsar «Actualizar» se activa y recarga una vez. La primera instalación no recarga. Se revisa si hay versión nueva cada hora.
- **Instalación guiada** en el panel: ofrece «Instalar» cuando el navegador lo permite, con «Ahora no» recordado. En el sitio público no se muestra un botón propio (se instala desde el menú del navegador).
- **Pruebas:** 11 unitarias del service worker en un entorno simulado (qué nunca atiende, navegaciones, estáticos, cookies, activación, SKIP_WAITING) y del manifiesto; Playwright: manifiestos válidos con íconos, `/sw.js` sin caché y sin `skipWaiting` en la instalación, registro real en el build de producción, **ninguna URL `/api/` ni página con datos en Cache Storage**, pantalla sin conexión con la red cortada y flujo de actualización.
- **Reservas honestas:** (1) **no se corrió Lighthouse**: su categoría PWA ya no existe en las versiones actuales; la instalabilidad se verifica con las condiciones que exige Chrome (manifiesto, íconos, service worker con `fetch`); (2) el registro del service worker solo ocurre en producción (en `next dev` no se registra); (3) los íconos son un cuadrado con una «I»: el negocio no puede subir su propio ícono por sitio todavía; (4) sin notificaciones push ni sincronización en segundo plano; (5) sin modo sin conexión de datos: sin red solo se ve la pantalla de aviso (decisión deliberada para no guardar nada ligado a una persona).

1. Manifiesto e iconos para el panel y para la página pública; instalación guiada.
2. Service worker que cachea solo recursos estáticos y una pantalla sin conexión; **nunca** respuestas de API.
3. Actualización controlada (aviso «hay una versión nueva»), sin dejar a nadie en una versión rota.
4. **Pruebas:** que ninguna respuesta de API ni de sesión se cachea, funcionamiento sin conexión de la pantalla acotada,
   Lighthouse PWA instalable, Playwright.

## F10.6 — Marketplace de integraciones y plantillas

**Hecha — F10.6 (2026-10-12): marketplace de integraciones y plantillas (ADR-029 §6).**

- **Modelo:** `MarketplaceListing` (tipo, socio, versión, permisos derivados, estado `IN_REVIEW`/`APPROVED`/`REJECTED`/`WITHDRAWN`, motivo) y `MarketplaceInstall` (única por organización y publicación; guarda la versión instalada). Migración reversible `20261012050000_f106_marketplace`; permisos `marketplace.install` y `marketplace.submit` (OWNER y ADMIN).
- **Qué se publica (solo DATOS declarativos):** una **plantilla** (bloques del catálogo cerrado, validados con `templateSchema`, saneados y sin referencias a otra organización) o una **integración** (lista de eventos hacia la dirección que pone quien instala). Nada se ejecuta en páginas públicas; no hay cobro ni custodia de dinero. Los permisos que muestra el listado salen de los datos, no del texto del socio.
- **Flujo:** el socio publica (queda en revisión, invisible) → la superadministración aprueba o rechaza con motivo → entra al directorio (público en `/integraciones` y en el panel) → la organización instala (plantilla: queda entre sus plantillas propias; integración: crea un destino de webhooks con la misma validación SSRF y firma, y muestra la clave una sola vez) y desinstala cuando quiera. **Retirar (la plataforma o el socio) desinstala de todas las organizaciones**; aprobar de nuevo reactiva la publicación.
- **Panel:** `/marketplace` (directorio con filtros, instalar con dirección de destino, desinstalar con confirmación, publicar y retirar propias); **administración:** `/marketplace` con cola por estado, aprobar, rechazar y retirar con motivo.
- **Topes:** 10 publicaciones vivas por organización, 50 instalaciones, y el tope de plantillas propias existente. Todo queda auditado (`marketplace.*`, `admin.marketplace_*`).
- **Hallazgo corregido durante la prueba:** el texto enriquecido de una plantilla publicada llegaba sin sanear; ahora se sanea al publicar y al instalar (misma función que el constructor).
- **Pruebas:** 12 de integración (invisible hasta aprobar, solo administración revisa, rechazo con motivo, instalar/desinstalar plantilla e integración, destino borrado a mano, retiro que desinstala y es reversible, retiro del socio, validación y saneo, permisos derivados, aislamiento, tope) y Playwright (publicar → aprobar → ver en el sitio → instalar → desinstalar → retirar) en teléfono y escritorio.
- **Reservas honestas:** (1) no hay correo al socio al aprobar o rechazar (el estado y el motivo se ven en su panel); (2) una plantilla de socio se arma a partir de una de sus páginas (sin editor propio ni imágenes de vista previa); (3) actualizar a una versión nueva exige desinstalar e instalar; (4) no hay publicaciones de pago ni reparto de ingresos (fuera de alcance por ADR-029); (5) las integraciones son envíos de eventos (webhooks): no hay OAuth ni lectura de datos desde el socio.

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

## Extra F10 — Bloque «Rueda de trabajos» (2026-10-11)

Pedido del propietario: un efecto de portafolio que gira (anillo que se abre en tambor 3D) en una sección de la página pública, **administrable** por el negocio.

- **Bloque nuevo `works_wheel`** (catálogo cerrado, sin HTML libre): título central, texto accesible del enlace y de 3 a 16 piezas (nombre de hasta 60 caracteres, imagen con descripción o marcada decorativa, enlace opcional http/https). Se agrega desde la biblioteca del constructor y se edita con el mismo motor declarativo de campos que el resto de los bloques (selector de imágenes de la biblioteca propia).
- **Render (`packages/blocks-renderer`)**: componente cliente adaptado al sistema (tokens `--site-*` del tema, no clases del demo). Cambios respecto del componente de referencia: el gesto en teléfono es el **deslizamiento horizontal** (`touch-action: pan-y`, no atrapa el scroll vertical de la página), el mouse captura el puntero solo al arrastrar de verdad (un clic simple abre el enlace de la pieza) y un arrastre no dispara el enlace; botones anterior/siguiente de 44 px y título activo visibles fuera de la escena 3D; teclado (flechas); `prefers-reduced-motion` sin suavizado; textos con tamaño mínimo legible; en pantallas anchas se sale de la columna (hasta 56 rem), en la vista previa del constructor se queda dentro de su marco.
- **Seguridad:** imágenes y enlaces pasan por `safeUrlSchema`; nombres como texto plano (React los escapa); nada de `dangerouslySetInnerHTML`.
- **Pruebas:** esquema (6), render del servidor (6), API de bloques, catálogo de bloques (24 tipos) y Playwright (constructor + página publicada, teléfono y escritorio, sin desbordes ni violaciones de CSP). Corregido de paso un desborde horizontal de 9 px en el editor móvil cuando un arreglo tiene imágenes (`fieldset` sin `min-w-0`).
- **Dónde conviene usarlo:** portafolio/«trabajos» en el sitio del negocio (fotografía, arquitectura, diseño, tatuajes, repostería), catálogo visual de servicios, y como bloque de apertura de una plantilla creativa. Con muchos productos con precio sigue siendo mejor el bloque Tienda.

## Extra F10 — Portal para fotógrafos, modelos y moda y belleza (2026-10-11)

Pedido del propietario: una plantilla completa, elegante y «futurista» para fotógrafos, modelos y rubros de moda y belleza, con animaciones finas, botones/tarjetas de diseño propio que lleven a su sitio web o a un segundo perfil (álbum), y la rueda de trabajos visible en el sitio comercial.

- **Tema nuevo `oscuro-atelier`** (línea oscura): negro profundo, texto marfil, acento champán, tipografía editorial (Fraunces), botones translúcidos y `motion: "elegant"`. AA verificado por la misma matriz de contraste que el resto del catálogo.
- **Movimiento elegante** (`motion` en los tokens del tema, opcional: lo guardado antes se lee igual): cada bloque aparece mientras entra en pantalla con una animación guiada por el scroll (`animation-timeline: view()`), **solo CSS, sin JavaScript**. Mejora progresiva: navegadores sin esa función (Firefox por ahora) muestran todo normal; con «reducir movimiento» no se anima nada.
- **Dos bloques nuevos** (catálogo cerrado, texto plano, enlaces http/https): `marquee` (cinta de texto en movimiento, pausa al pasar el mouse, quieta con «reducir movimiento») y `showcase` («Colecciones»: tarjetas grandes con portada, insignia y enlace a un álbum, a la web o a **otro perfil biográfico**; el texto va sobre un velo oscuro sólido para no depender de la foto).
- **Plantilla `fotografia-moda`** («Fotógrafo, modelo y moda»): portada a sangre, cinta de texto, acción principal por WhatsApp, rueda de trabajos (6 piezas), álbumes y perfiles (álbum completo, perfil de modelo, sitio web), 3 servicios con precio, reseñas, preguntas frecuentes, newsletter «Lookbook», mapa del estudio y redes. Fondo `#0b0a0a`.
- **Sitio comercial:** la rueda aparece en la portada de Impulza One («Hecho para tu rubro»), con los rubros como piezas que llevan a la galería de plantillas.
- **Pruebas:** esquemas, render del servidor, API de bloques y de plantillas, Playwright (constructor + página publicada, teléfono y escritorio).
- **Reservas honestas:**
  1. Las fotos de la plantilla son de Unsplash (licencia libre de uso comercial), elegidas **sin marcas visibles**, y están marcadas «Foto de ejemplo»; el negocio debe reemplazarlas por las suyas. Unsplash no garantiza autorización de las personas retratadas (sale en el retrato del «perfil de modelo»): por eso son solo ejemplo.
  2. El «segundo perfil» es un **enlace**: el negocio pega la dirección de su otra página (hoy cada sitio tiene su propia página; enlazar páginas internas con selector llega con F10.3+).
  3. La regla de «sin imágenes de terceros en plantillas» (ADR-008) se amplió solo a `images.unsplash.com/photo-…`; sigue prohibido todo lo demás.
  4. Competencia (Linktree, Beacons, Stan, Carrd): ya cubrimos enlaces, formularios, mini-CRM, reservas, tienda, membresías, QR y analítica; lo que este portal suma es composición visual (rueda, colecciones, cinta) y movimiento. Lo que sigue pendiente de la fase: tarjeta digital/vCard y PWA (F10.4/F10.5).

## Extra F10 — Portales completos: páginas reales, vistas y «me gusta», modo día/noche (2026-10-12)

Pedido del propietario: al tocar «Álbum» no pasaba nada (y lo mismo en todas las plantillas); cada portal debe tener sus propias páginas, contar vistas y «me gusta», y poder cambiar entre día y noche.

- **Enlaces internos `page:<slug>`:** un botón, tarjeta, servicio o portada puede llevar a otra página del mismo sitio. Se guarda como `page:album` (sobrevive a cambios de dirección y dominio propio) y el render público lo convierte en la ruta real (la página de inicio, en la raíz). El editor trae un selector «Elige una página de tu portal». Valida en servidor (`linkTargetSchema`): solo `https://…`, `page:<slug>` o la ruta ya resuelta; nada de `javascript:` ni rutas libres.
- **Todas las plantillas son portales completos:** las 13 traen páginas compañeras (a lo sumo 2, para que el plan gratis —3 páginas— alcance): guía, carta, catálogo, lanzamiento, convenios, fechas, ubicación, agenda, portafolio, cursos, horarios, álbum, perfil y contacto. **Ningún botón de plantilla apunta ya a un sitio de ejemplo** (prueba automática por plantilla). Al aplicarla se crean antes de tocar la página actual (si el plan no alcanza responde 402 sin cambiar nada), una página con ese slug que la persona ya armó se respeta, y el onboarding las publica junto con el inicio. Fotos de relleno inexistentes (`example.com/*.jpg`) reemplazadas por fotos de ejemplo sin marcas.
- **Vistas y «me gusta»:** bloque `engagement` (todas las plantillas lo traen). Las vistas las suma el procesador de analítica en la misma transacción que el evento (no se duplican por reintento, no dependen de la retención de eventos crudos); el «me gusta» es uno por visitante y página, con clave HMAC (no se guarda la IP) y unicidad en la base. Solo páginas publicadas y públicas. Panel: tarjeta «Vistas y “me gusta”» por página en el sitio.
- **Modo día/noche:** un tema puede traer `altPalette` (validada con el mismo contraste AA). La página muestra un botón accesible que cambia los colores sin tocar el resto, recuerda la elección y no aparece en miniaturas ni en la vista previa. El tema Atelier lo trae (noche negra ↔ día marfil).
- **Reservas honestas:** el «me gusta» por IP compartida (una oficina) cuenta uno; no hay cuentas de visitante. El interruptor día/noche hoy solo lo trae el tema Atelier; los demás temas pueden sumarlo con su paleta alterna. Falta usar componentes de 21st.dev como bloques propios (sigue como siguiente paso de este extra).

## Extra F10 — Los 13 portales, completos (2026-10-12)

Pedido del propietario: «el álbum muestra pocas cosas, no es nada profesional y está incompleto; cada portal biográfico debe estar diseñado y desarrollado completo, con concesión para quien entra pueda apreciar las fotos o el trabajo».

- **Cinco bloques de portal profesional** (catálogo cerrado, validados en servidor, con editor en el constructor):
  - **Álbum** (`album`): hasta 60 fotos con título y categoría, mosaico o cuadrícula, filtros por categoría, carga de a 12 («Ver más fotos») y **visor a pantalla completa** (flechas, deslizamiento, contador, foco atrapado y devuelto, `Esc` para cerrar, precarga de vecinas). Navega todo el álbum filtrado, también lo no cargado aún.
  - **Encabezado de página** (`page_header`), **Cifras** (`stats`), **Pasos** (`steps`: «cómo trabajo») e **Imagen y texto** (`feature`: «sobre mí», con texto enriquecido saneado y botón).
  - Los bloques anchos (álbum, cifras, pasos, imagen y texto y planes de 3 o más) se salen de la columna angosta en pantallas anchas (`WideBleed`); en teléfono y en la vista previa del constructor no cambia nada.
- **Contenido de las 13 plantillas** (`packages/validation/src/templates/portal-content.ts`): cada una es un portal de **tres páginas** con estructura profesional — inicio con colecciones, cifras, reseñas y redes; una página principal del oficio (álbum, carta, servicios, catálogo, música, planes…); y una de contacto o reservas con mapa, preguntas y acción clara. 35 fotos de ejemplo verificadas y sin marcas a la vista, 60+ bloques de contenido por plantilla en total. Probado de punta a punta: las 13 se aplican y publican sin error por la API.
- **Menú del sitio** con nombres legibles («Álbum», «Música», «Catálogo»…) en vez del slug.
- **Pruebas:** esquemas, render del servidor, API (aplicar plantilla, páginas compañeras, 402 por plan, aislamiento), y Playwright del álbum (filtros, ver más, visor, teclado, foco, CSP) en teléfono y escritorio.
- **Reservas honestas:** las fotos son de ejemplo y el negocio debe reemplazarlas; el visor navega el álbum filtrado pero no tiene zoom con pellizco; la subida masiva de fotos en un solo paso sigue pendiente (hoy se elige foto por foto desde la biblioteca de medios); la auditoría del panel contra la competencia y los componentes de 21st.dev como bloques propios siguen como próximos pasos de este extra.
