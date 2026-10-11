# Backlog — Fase 10: Versión 2 (membresías y cursos, wallet y tarjeta digital, PWA, marketplace)

**Decisión base:** ADR-029. **Orden:** F10.1 a F10.7, una historia por vez, con commit por historia y push al cerrar cada una.
Todas cumplen la Definición de Terminado de `CLAUDE.md` (validación en servidor, aislamiento entre organizaciones con su
prueba, estados de carga/vacío/error/éxito, responsive, pruebas, OpenAPI, migración reversible, telemetría, documentación).

| Historia | Título | Estado |
|---|---|---|
| F10.1 | Miembros de sitio y contenido protegido (enlace mágico) | **Hecha** (2026-10-11): API 12/12, suite 74/74 (API 1035), Playwright 4/4; reservas en el detalle |
| F10.2 | Planes de membresía y cobro recurrente por la cuenta del negocio | Pendiente |
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
