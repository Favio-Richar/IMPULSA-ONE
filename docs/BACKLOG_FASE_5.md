# Backlog — Fase 5 (Negocio digital)

Fuente: `02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` §19 (Fase 5: servicios, reservas,
catálogo, productos digitales, pedidos, pagos de negocios, campañas) y §12 (pagos: en el MVP **no se
custodia ni se distribuye dinero de terceros**; enlaces externos de pago configurables),
`PLAN_MAESTRO_PLATAFORMA_IDENTIDAD_DIGITAL.md` §9.9 (reservas), §9.10 (tienda), §9.11 (campañas),
`docs/architecture/ERD.md` §10 (entidades diferidas a esta fase) y ADR-004 (privacidad). Cada
historia usa la Definición de Terminado general (`CLAUDE.md`) **más** los criterios de abajo.

Precondición: Fase 4 cerrada salvo lo que depende de decisiones del propietario (F4.6 pasarela,
F4.8 hosting, SSL de F4.7). Favio pidió el 2026-09-26 seguir con la fase siguiente sin esperar
("si terminas una fase debes seguir con la siguiente"); lo bloqueado de Fase 4 no se toca.

## Decisiones de negocio que rozan esta fase

| # | Decisión | Qué bloquea | Cómo se avanza mientras tanto |
|---|---|---|---|
| 6 | Responsabilidad de pagos de terceros | Checkout propio, cobro de seña, reembolsos, pagos de productos | Nada se cobra dentro de Impulza: cada servicio o producto puede llevar un **enlace de pago externo** del propio negocio (Mercado Pago, Flow, transferencia). El pedido o la reserva quedan registrados; el pago lo confirma el negocio a mano |
| 2 | Mercado de lanzamiento | Moneda, zona horaria por defecto | Precios como `(monto en unidad mínima, moneda ISO)`; zona horaria IANA por sitio, `America/Santiago` por defecto |
| — | Proveedor de email masivo | Envío real de campañas en volumen | `EmailAdapter` (F1) detrás de una cola; límites de envío por plan y por hora; sin proveedor configurado, las campañas se preparan y prueban pero no se envían en volumen |

## Estado

| Historia | Estado |
|---|---|
| F5.1 — Servicios reservables y disponibilidad | Lista para tu revisión (capturas en `docs/design/capturas/f51/`) |
| F5.2 — Reserva pública desde la página (bloque "Reservar") | Lista para tu revisión (capturas en `docs/design/capturas/f52/`) |
| F5.3 — Agenda del negocio en el panel | Lista para tu revisión (capturas en `docs/design/capturas/f53/`) |
| F5.4 — Confirmaciones, cancelación/reprogramación y recordatorios | Lista para tu revisión (capturas en `docs/design/capturas/f54/`) |
| F5.5 — Catálogo y pedidos (productos físicos, digitales y servicios) con pago externo | Lista para tu revisión (capturas en `docs/design/capturas/f55/`) |
| F5.6 — Campañas de email con consentimiento y bajas | Lista para tu revisión (capturas en `docs/design/capturas/f56/`) |
| F5.7 — Aislamiento y seguridad de Fase 5 | Lista para tu revisión (sin UI: pruebas en la suite central) |
| F5.8 — Conectar la cuenta de Mercado Pago del negocio (OAuth + PKCE) | Lista para tu revisión (capturas en `docs/design/capturas/f58/`; falta probar con tu aplicación real de Mercado Pago) |
| F5.9 — Cobro de pedidos de la tienda con Checkout Pro y confirmación automática | Lista para tu revisión (capturas en `docs/design/capturas/f59/`; falta probar con tu aplicación real de Mercado Pago) |
| F5.10 — Seña de reservas cobrada al reservar | Pendiente |
| F5.11 — Reembolsos, contracargos y descargas pagadas | Pendiente |
| — Afiliados | Sin fase (se diseña con uso real) |
| — Profesionales y sucursales múltiples, integración de calendario externo/videollamada | Después de F5.4 (se diseña con uso real) |

### Cobros de los negocios (F5.8–F5.11, ADR-013) — desbloqueados el 2026-09-30

Decisión #6 resuelta: cada negocio conecta **su propia** cuenta de Mercado Pago; el dinero va
directo a él; Impulza no custodia fondos, no ve tarjetas y no cobra comisión por venta.

**F5.8 — Conectar la cuenta de Mercado Pago del negocio**
- Botón "Conectar Mercado Pago" (permiso nuevo `payments.connect`, solo OWNER): OAuth con `state`
  firmado de un solo uso y PKCE `S256`; tokens cifrados; nunca en respuestas, logs ni auditoría.
- Estado de la conexión en el panel (cuenta conectada, desde cuándo, modo prueba/producción),
  desconectar (borra los tokens), renovación automática en el worker antes de vencer (180 días);
  si la renovación falla, queda desconectada y se avisa al dueño.
- Auditoría de conectar/desconectar; aislamiento: una organización nunca usa la cuenta de otra.

> **Estado (2026-09-30): F5.8 lista para revisión.**
> - `packages/payments`: `MercadoPagoOAuth` (URL de autorización con PKCE `S256`, cambio de código y
>   renovación por `/oauth/token`, Zod en la respuesta) y utilidades PKCE, probadas contra el vector
>   de la RFC 7636. Configuración `MERCADOPAGO_CLIENT_ID`/`MERCADOPAGO_CLIENT_SECRET`, las dos o ninguna.
> - Base: migración aditiva `20260930020000_f58_payment_accounts` (`PaymentAccount`, única por
>   organización y pasarela, tokens cifrados, `CHECK` de motivo en error) con `down.sql`. Permiso
>   nuevo `payments.connect` (solo OWNER).
> - API: estado (miembro, con `canManage` del servidor), empezar a conectar (`state` aleatorio en
>   Redis 10 min + verificador PKCE), callback sin sesión que **consume** el `state` (GETDEL),
>   **revalida el permiso** al volver, cambia el código y guarda los tokens cifrados; desconectar
>   borra los tokens. Auditoría sin tokens. `accessTokenFor(organización)` solo entrega un token de
>   una cuenta sana y vigente de esa organización. OpenAPI (156 rutas).
> - Worker: renovación diaria con 30 días de margen, condicional sobre el token leído; si Mercado
>   Pago rechaza o venció, la cuenta queda en error y se avisa al dueño una sola vez.
> - Panel: "Cobros" en el menú, estado de la cuenta, conectar/reconectar, desconectar con
>   confirmación, avisos al volver de Mercado Pago y "Cómo funciona" (dinero directo al negocio, sin
>   comisión, boleta del negocio).
> - Pruebas: pagos 50 (PKCE con el vector de la RFC), API e2e 8 + caso en la suite central (67),
>   worker 3, Playwright `cobros.spec.ts` 6/6. **Verificadas contra el código roto:** con el `state`
>   reutilizable y sin revalidar el permiso, las pruebas fallan.
> - Errores encontrados: (1) el vector PKCE que escribí de memoria estaba mal (el código estaba
>   bien); se verificó y se usa el de la RFC. (2) Con la cuenta conectada pero la conexión no
>   habilitada en el ambiente, el panel ocultaba "Desconectar" y mostraba mensajes contradictorios:
>   desconectar queda siempre al alcance del dueño (ADR-013). (3) La primera corrida de las pruebas
>   del worker tuvo dos fallos sin aserción (arranque en frío); cinco corridas seguidas pasaron.
> - Pendiente para producción: crear la aplicación de Impulza en Mercado Pago, registrar la URL de
>   redirección y activar PKCE, y probar la conexión con una cuenta de prueba.

> **PUNTO DE CORTE (2026-09-30) — ya retomado y cumplido: F5.9 quedó lista para revisión (abajo).**
> Hecho y commiteado: F5.8 completa
> (`782d940`), base de pruebas propia y CI en `master` (`361581f`), cobros de suscripciones F4.6a–d
> y F4.6b. Siguiente paso literal, en orden:
> 1. F5.9: cliente de Checkout Pro en `packages/payments` (`POST /checkout/preferences` y
>    `GET /v1/payments/{id}` con el token del negocio), campos de pago en `Order` (migración).
> 2. En el pedido público (`public-catalog.service.ts`): si el negocio tiene cuenta conectada
>    (`PaymentAccountsService.accessTokenFor`), crear la preferencia con `external_reference` = id
>    del pedido y devolver la URL de pago; si no, el enlace externo de siempre.
> 3. Webhook por pedido: consultar el pago con el token del negocio y marcar pagado solo si
>    cuenta, pedido, monto y moneda coinciden (idempotente); avisos al negocio y al comprador.
> 4. Pruebas (unitarias, e2e, aislamiento, Playwright), capturas y documentación.

**F5.9 — Cobro de pedidos con Checkout Pro**
- Con cuenta conectada, el pedido público crea una preferencia a nombre del negocio
  (`external_reference` = pedido) y el comprador paga en Mercado Pago; al volver ve el estado.
- Webhook por pedido: se consulta el pago con el token del negocio; solo se marca pagado si la
  cuenta, el pedido, el monto y la moneda coinciden. Idempotente. Aviso al negocio y al comprador.

> **Estado (2026-09-30): F5.9 lista para revisión.**
> - `packages/payments`: `MercadoPagoCheckout` (preferencia con `X-Idempotency-Key` = pedido, URL de
>   pruebas con credenciales de prueba, consulta de pago con Zod) y su simulación por token (un token
>   no ve pagos de otra cuenta). Solo CLP (cuenta de Mercado Pago Chile); otra moneda sigue con el
>   enlace externo. Configuración: `MERCADOPAGO_APP_WEBHOOK_SECRET` se suma a id y secreto de la
>   aplicación (las tres o ninguna): los avisos de los pedidos llegan firmados con esa clave.
> - Base: migración aditiva `20260930030000_f59_order_checkout` (campos opcionales de cobro en
>   `orders`, `provider_payment_id` y `status_token_hash` únicos) con `down.sql` probado (revertir → 0
>   columnas, reaplicar → 6).
> - API: el pedido público crea el cobro con el token del negocio si tiene cuenta conectada (si
>   Mercado Pago falla, el pedido sigue con su enlace externo); aviso por pedido con firma
>   `x-signature` verificada antes de leer nada; el pago se consulta con el token del negocio y solo
>   se aplica si pedido, cuenta receptora, monto y moneda coinciden; asignación condicional
>   (idempotente, sin avisos repetidos). "Tu pedido" (`GET /public/orders/:token`, sin datos
>   personales) consulta el pago al volver de Mercado Pago. Pagar un pedido cancelado lo deja
>   cancelado y avisa al negocio. Un pago confirmado por Mercado Pago no se "deshace" a mano (422).
>   Auditoría `order.paid_online`/`order.cancelled_order_paid`. OpenAPI (157 rutas).
> - Web: botón "Pagar con Mercado Pago" en la confirmación de la tienda y página `/pedido/:token`
>   (pendiente, en revisión, rechazado, pagado, entregado, cancelado; sin indexar, sin referer).
>   Panel: el pedido muestra el estado del cobro en línea.
> - Correos: al comprador (enlace "Tu pedido"; pago recibido) y al negocio (pago recibido con id del
>   pago y recordatorio de boleta; pedido cancelado pagado).
> - Pruebas: pagos 56, API e2e 8 nuevas + caso nuevo en la suite central (68), Playwright
>   `pedido-pago.spec.ts` 8/8 (y `tienda`, `cobros`, `reserva-gestion` sin regresiones). CI: se agregó
>   `API_PUBLIC_URL`, que faltaba también para F5.8.
> - **No verificado contra el código roto:** al intentar correr las e2e con las comprobaciones de
>   monto y cuenta quitadas, el verificador de permisos de la sesión lo bloqueó; el código se
>   restauró sin correr. Queda para hacerlo a mano si se quiere.
> - Pendiente para producción: en la aplicación de Impulza en Mercado Pago, copiar la clave de
>   firma de webhooks a `MERCADOPAGO_APP_WEBHOOK_SECRET` y probar un pedido con usuarios de prueba
>   (confirmar que los avisos de las preferencias de cuentas conectadas llegan firmados con esa clave).

**F5.10 — Seña de reservas**
- El servicio define una seña (monto fijo); la reserva queda "pendiente de pago" y se confirma al
  pagarse; si no se paga en el plazo, se libera el horario.

**F5.11 — Reembolsos, contracargos y descargas pagadas**
- Reembolso desde el panel del negocio (con su token), contracargos informados, y productos
  digitales con enlace de descarga firmado que solo se entrega tras el pago.

### Bitácora de avance (para retomar)

- **2026-09-26 — Backlog creado.** Orden: F5.1 → F5.2 → F5.3 → F5.4 → F5.5 → F5.6, y F5.7 se va
  completando con cada historia (cada endpoint nuevo suma su caso a la suite central).
- **2026-09-26 — F5.1 terminada**, en "Lista para tu revisión".
  - Migración `20260926200000_f51_booking_setup` (solo tablas nuevas: `booking_settings`,
    `bookable_services`, `booking_blackouts`; `down.sql` probado: revertir → 0 tablas, reaplicar → 3).
  - `@impulza/validation/bookings`: esquemas (horario semanal ordenado y sin solapes, zona IANA,
    servicio con precio completo y enlace de pago seguro, bloqueos ≤ 1 año) y **cálculo de horarios
    libres** puro con `Intl` (sin dependencias), probado con los cambios de horario reales de Chile
    (6/9/2026 no existe 00:00–00:59; 3/4/2027 se repite 23:00–23:59). La prueba del salto se
    verificó contra el código roto.
  - API `organizations/:id/sites/:siteId/booking/{settings,services,blackouts,availability}`
    (`site.update` para escribir, auditoría, topes técnicos de 50 servicios y 1 configuración por
    sitio). Suite central 50/50 con el caso de reservas; suite completa de la API 383/383.
  - Panel: `/sitios/[id]/reservas` (horario por día con tramos, "copiar el lunes", reglas,
    servicios con edición en línea, días bloqueados en la zona del negocio y vista previa de 7
    días) y acceso desde la página del sitio. Playwright `reservas.spec.ts` (móvil, escritorio y
    360 px).
  - Corregido de paso: `openapi.test.ts` fallaba desde F4.7 (faltaba declarar como pública
    `GET /public/domains/{hostname}`).
  - **Aviso de entorno:** el build de producción de `apps/web` falla por
    `apps/web/app/page.tsx:324` (sitio comercial en progreso de otra sesión); Playwright se corrió
    con un servidor provisional en el 3390 solo para estas pruebas, que no usan el sitio público.
  - Siguiente: F5.2 (reserva pública desde la página).
- **2026-09-26 — F5.2 terminada**, en "Lista para tu revisión".
  - Migración `20260926220000_f52_bookings`: tabla `bookings` (copia del servicio al reservar,
    datos del cliente, estado, origen) y **restricción de exclusión** `bookings_no_overlap`
    (`btree_gist`: mismo sitio + rangos que se pisan, solo `CONFIRMED`). Probada en la base:
    rechaza la que se pisa, admite una cancelada en el mismo horario y una contigua. Requiere la
    extensión `btree_gist` en el Postgres de producción (disponible en RDS, Neon, Supabase).
  - API pública `public/sites/:slug/booking` (servicios, horarios libres, reservar): CSRF, límite
    de tasa (10 reservas cada 10 min por visitante), trampa antispam, consentimiento obligatorio.
    Alta bajo bloqueo por sitio que revalida la hora con el mismo cálculo (incluye el margen); la
    restricción es la última garantía. Crea o actualiza el contacto (`booking:<sitio>`), su evento
    `BOOKING` y los eventos de analítica `booking_created` (nuevo en la taxonomía) y `lead_created`.
    Nunca cobra: la confirmación trae el enlace de pago del negocio si existe (decisión #6).
  - Bloque `booking` (16.º tipo): botón de la pila que despliega servicio → día y hora → datos →
    confirmación con "Pagar ahora" y "Agregar a mi calendario" (`.ics` generado en el navegador,
    con escape contra inyección de campos). Puede ser la acción principal (barra fija del
    teléfono). Errores en el color de texto del tema (AA), foco al título de cada paso.
    `apps/web/app/api/bookings/...` reenvía al API (el navegador nunca la llama directo).
  - Pruebas: API 391/391 (12 de reservas, con una carrera de 5 pedidos simultáneos → 1 reserva),
    suite central con el caso público, validación 475, renderer 53+, web 24; Playwright
    `reserva-publica.spec.ts` (móvil y escritorio) y `reservas.spec.ts`. Recorrido real en la demo
    de la barbería: reserva guardada, teléfono normalizado, contacto enlazado.
  - **Aviso**: `reserva-publica.spec.ts` se verificó con el servidor de desarrollo del 3300,
    porque el build de producción de `apps/web` sigue roto por `app/page.tsx` (sitio comercial en
    progreso de otra sesión). En CI corre contra el build de producción como las demás.
  - Siguiente: F5.3 (agenda del negocio en el panel).
- **2026-09-26 — F5.3 terminada**, en "Lista para tu revisión".
  - Permiso nuevo `booking.manage` (OWNER, ADMIN, EDITOR, SUPPORT; ANALYST solo ve): 16 permisos,
    41 asignaciones en el seed.
  - API `organizations/:id/bookings`: listar por rango (hasta 62 días, filtro por sitio y estado),
    leer, **anotar a mano** (puede quedar fuera del horario publicado, nunca encima de otra
    confirmada; sin consentimiento no crea contacto, pero enlaza uno existente con ese correo) y
    **cambiar estado** (atendida, no llegó, cancelada, deshacer; reactivar una cancelada se
    rechaza si su hora ya se ocupó). Auditoría en cada cambio.
  - Panel `/reservas` (nuevo en el menú): resumen de la semana (por atender, atendidas, no
    llegaron, ingreso estimado por moneda), tira de días con cuántas reservas tiene cada uno, vista
    de día o semana, filtro por estado, tarjetas con correo, teléfono y WhatsApp del cliente, y
    formulario para anotar. Todo en la zona horaria del sitio.
  - Pruebas: API 396/396 (agenda 4, con ANALYST sin permiso) y caso en la suite central;
    Playwright `agenda.spec.ts` (móvil, escritorio y 360 px).
  - Siguiente: F5.4 (confirmaciones por correo, cancelar/reprogramar y recordatorios).
- **2026-09-26 — F5.4 terminada**, en "Lista para tu revisión".
  - **Enlace "gestiona tu reserva" firmado** (`<id>.<HMAC-SHA256>`, `@impulza/auth`
    `signBookingLinkToken`/`verifyBookingLinkToken`, comparación en tiempo constante) con el secreto
    `BOOKING_LINK_SECRET` (API y worker). La base no guarda nada del enlace; el worker lo vuelve a
    armar para el recordatorio. Se descartó guardar una huella del token: impedía poner el enlace en
    el recordatorio (la migración se corrigió antes de subirla).
  - Migración `20260926230000_f54_booking_manage`: `bookings.reminder_sent_at` + índice parcial.
  - Correos en texto (`@impulza/validation/bookings/messages`, compartidos API/worker, asuntos sin
    saltos de línea): confirmación con el pago del negocio y el enlace, cambio de hora,
    cancelación, recordatorio y aviso a los dueños. Nunca hacen fallar la operación.
  - API pública `public/bookings/:token` (ver, cancelar, cambiar hora): hasta la anticipación mínima
    del negocio; la hora nueva con el mismo cálculo bajo bloqueo por sitio, **sin contar la propia
    reserva**; reinicia el recordatorio. Auditoría `booking.cancelled_by_customer` y
    `booking.rescheduled_by_customer`.
  - Worker: `booking-reminders` cada 10 min; recuerda las confirmadas de las próximas 1–24 h hechas
    con más de un día de anticipación; reclama cada una con un `updateMany` condicional (nunca dos
    recordatorios) y la libera si el correo falla.
  - `apps/web`: página `/reserva/[token]` (tema del negocio, `noindex`, `no-referrer`, sin caché)
    con cancelar (confirmación en pantalla) y cambiar hora (mismo selector de día y hora que la
    reserva, exportado del renderer); ruta `api/booking-manage/[token]/[action]`. "reserva" y
    "reservas" pasan a slugs reservados (una ruta fija gana sobre `[siteSlug]`).
  - Entorno: `PUBLIC_SITE_BASE_URL` y `BOOKING_LINK_SECRET` en API, worker, `.env.example` y CI
    (valores de prueba). Sin ellos los correos lo dicen en vez de traer un enlace roto.
  - Pruebas: API (gestión 5, reservas 21 en total) con suite completa 401 — 4 dieron timeout de 5 s
    en la corrida completa con los servidores de desarrollo arriba y pasaron aisladas (5/5 y 4/4);
    worker 6 (contra la base real, incluida la carrera de dos ejecuciones); `@impulza/auth` y
    correos; Playwright `reserva-gestion.spec.ts` y `reserva-publica.spec.ts` (esta última ya no
    depende de la hora del día). Recorrido real en la demo: 6 correos, cambio de hora y cancelación.
  - **Aviso para la otra sesión (sitio comercial):** sus rutas nuevas `/planes`, `/plantillas` y
    `/producto` también ganan sobre `[siteSlug]`; convendría sumarlas a `RESERVED_SLUGS`.
  - Siguiente: F5.5 (catálogo y pedidos con pago externo).
- **2026-09-27 — F5.5 terminada**, en "Lista para tu revisión".
  - Migración `20260927010000_f55_catalog_orders` (con `down.sql`, aplicada, revertida y vuelta a
    aplicar): `product_categories`, `products` y `orders`, enums `ProductKind` y `OrderStatus`, y
    `CHECK` de precio y stock no negativos, cantidad 1–99 y total = precio × cantidad.
  - Permisos nuevos `catalog.manage` (OWNER, ADMIN, EDITOR) y `order.manage` (esos más SUPPORT).
    Slugs reservados: `catalogo`, `pedido`, `pedidos` y, por el aviso de F5.4, `planes`,
    `plantillas`, `producto`, `productos`, `precios`.
  - API: catálogo del panel (`organizations/:org/sites/:site/catalog/{categories,products}`),
    catálogo y pedido públicos (`public/sites/:slug/catalog`, `.../orders`: CSRF, límite de tasa
    10/10 min, campo trampa, consentimiento, contacto con evento `PURCHASE`, `order_created` y
    `lead_created`) y pedidos (`organizations/:org/orders`: lista paginada con conteo por estado,
    cambio de estado con `order.manage`). Precio, moneda y enlace de pago salen siempre del
    producto guardado. El stock se descuenta con un `updateMany` condicional (`stock >= cantidad`):
    tres pedidos simultáneos por la última unidad dan 201/409/409 (verificado también contra el
    código sin la condición: 201/500/500). Cancelar devuelve el stock; reabrir lo vuelve a
    reservar o da 409; un entregado no se reabre. Cada cambio es condicional al estado leído.
  - Correos en texto (`@impulza/validation/catalog/messages`): pedido recibido (con "paga aquí" si
    hay enlace del negocio), pagado, entregado, cancelado y aviso de pedido nuevo a los dueños.
  - Página pública: bloque `catalog` ("Tienda"): **cada producto es un botón de la pila** (miniatura
    o ícono, nombre, "$12.990 · Pedir" o "Agotado") que despliega cantidad, datos (dirección solo si
    es físico), consentimiento y la confirmación con "Pagar ahora". Sin productos, el bloque no
    ocupa lugar. Rutas `apps/web/app/api/catalog/[siteSlug]` (archivos nuevos, sin tocar el sitio
    comercial). Las piezas comunes del flujo de reservas pasaron a `blocks-renderer/src/ui/flow.tsx`.
  - Panel: `Sitios → Catálogo` (productos con foto de la biblioteca, tipo, precio, stock, categoría,
    enlace de pago, pausar/activar; categorías en línea) y `Pedidos` en el menú (pestañas por estado
    con conteo, datos del cliente, WhatsApp, dirección y acciones). Bloque "Tienda" en el
    constructor.
  - Pruebas: validación 5, renderer 2, web 3, API e2e 8 + caso central de aislamiento; suite
    completa de la API 410/410; OpenAPI regenerado (115 rutas). Playwright `tienda.spec.ts` 6/6
    (móvil y escritorio: pedido, pedidos, catálogo, sin desplazamiento horizontal, también a 360 px).
  - Demo: `demo-tienda` tiene 5 productos (uno agotado) y el bloque "Tienda" publicado.
  - 2026-09-27, a pedido del propietario: "Catálogo" también en el menú del panel (`/catalogo`, con
    selector de sitio), además de Sitios → Catálogo. Playwright `tienda.spec.ts` 8/8.
  - Siguiente: F5.6 (campañas de email con consentimiento y bajas).
- **2026-09-27 — F5.6 terminada**, en "Lista para tu revisión".
  - **Consentimiento de marketing aparte** del de gestión: aceptar que el negocio guarde los datos
    de una reserva o un pedido no es aceptar publicidad. Casilla opcional y no premarcada ("Quiero
    recibir novedades…") en la reserva y el pedido públicos; se guarda fuente, versión del texto
    (`marketing-v1`) y fecha. El panel no puede declarar consentimiento ajeno. Los contactos de
    formularios todavía no tienen esta casilla (pendiente: sumarla al constructor de formularios).
  - Migración `20260927030000_f56_campaigns` (con `down.sql`, aplicada, revertida y vuelta a
    aplicar): columnas de marketing en `contacts`, tablas `campaigns` y `campaign_recipients`.
    Permiso `campaign.manage` solo para OWNER y ADMIN. Límite de plan nuevo `emailsPerHour`
    (provisorio, decisión #4: 50/300/1.000/5.000; un plan viejo sin el dato vale 50).
  - API: campañas (borrador, audiencia en vivo, opciones de segmento por etiqueta/estado/origen,
    prueba al autor con límite de tasa, envío que congela destinatarios, una campaña a la vez por
    organización con bloqueo, detener) y baja pública `public/unsubscribe/:token` (enlace HMAC con
    propósito propio, idempotente, auditada). Cuerpo saneado en el servidor.
  - Worker `campaign-dispatch` cada minuto: respeta el límite por hora congelado, reclama cada
    destinatario con `updateMany` condicional (nunca dos correos), revisa la baja justo antes de
    enviar, registra fallos y cierra la campaña. Cada correo lleva texto, HTML, pie con el porqué y
    el enlace de baja, y la cabecera `List-Unsubscribe` de un clic (RFC 8058).
  - "Rebotes": por ahora se cuentan los fallos al entregar al proveedor; los rebotes reales llegan
    cuando exista un proveedor de correo con avisos (decisión pendiente del propietario).
  - Web: `/baja/[token]` (noindex, sin caché, pide un clic: los escáneres de correo abren enlaces
    solos) y `api/unsubscribe/[token]`. Slugs reservados `baja` y `campanas`.
  - Panel: "Campañas" en el menú; lista con avance, editor con audiencia en vivo, filtros en
    botones, vista previa aislada (iframe sin scripts) y confirmación de envío; informe con
    métricas (destinatarios, enviados, pendientes, fallidos, bajas) que se refresca solo.
  - Pruebas: validación 4, auth 2, worker 5 (contra la base, verificado también contra el código
    sin la revisión de baja), API e2e 6 + caso central de aislamiento, web 2; suites completas: API
    417, worker 11, validación 489, auth 18, web 31. OpenAPI regenerado (123 rutas). Playwright
    `campanas.spec.ts` 4/4 (móvil y escritorio, baja con enlace firmado y enlace falso 404).
  - Siguiente: F5.7 (revisión de aislamiento y seguridad de toda la Fase 5).
- **2026-09-27 — F5.7 terminada**, en "Lista para tu revisión". Con ella la Fase 5 queda
  completa salvo lo bloqueado por la decisión #6 (cobros) y lo diferido a uso real.
  - Revisión de toda la superficie de la fase: cada endpoint con sesión ya tenía su caso en
    `multi-tenant-isolation.e2e.test.ts` (F5.1, F5.2, F5.3, F5.5, F5.6); los públicos tenían
    límite de tasa y antispam (campo trampa) pero **faltaba probarlo**, y los enlaces firmados de
    F5.4 (gestión de reserva) y F5.6 (baja) no tenían caso central.
  - Suite central, bloque nuevo "Superficie pública de Fase 5" (4 pruebas): el enlace de gestión de
    B solo alcanza su reserva (la firma de B pegada al id de A da 404 al ver, cancelar y
    reprogramar; una firma de baja no sirve para gestionar); la baja de una campaña de B **no da de
    baja al mismo correo en A** (verificada contra el código roto: dar de baja por correo en vez de
    por contacto hace fallar la prueba); las confirmaciones públicas de reserva y pedido y las
    respuestas de gestión y baja traen exactamente las claves del contrato y ningún id interno; y
    las 5 escrituras públicas de la fase devuelven 429 al pasar su límite por IP.
  - `packages/auth`: prueba unitaria del enlace de baja ampliada (id cambiado, firma alterada,
    basura, y ninguna firma sirve por la otra en **las dos** direcciones: baja↔reserva).
  - Sin cambios de rutas ni de modelo: OpenAPI y migraciones sin cambios.
  - Pruebas: suite central 58/58; auth 19/19 (antes 18); typecheck y lint de api y auth limpios. Suite completa
    de la API: 393 pasan y 7 fallan en la corrida completa (medios, analítica, organizaciones y
    temas, archivos no tocados); aislados, esos 4 archivos pasan 61/61: carga de la máquina, no
    regresión.
  - Siguiente: tu revisión de F5.1–F5.7. Lo que sigue depende de decisiones tuyas (#6 cobros,
    #4 límites por plan, hosting de F4.8, proveedor de correo).

---

### F5.1 — Servicios reservables y disponibilidad
**Criterios de aceptación:**
- Modelo `BookableService` por sitio (nombre, descripción, duración en minutos, precio opcional
  `(monto, moneda)`, enlace de pago externo opcional, activo, orden) y `BookingSettings` por sitio
  (zona horaria IANA, horario semanal por día con uno o más tramos, anticipación mínima, horizonte
  máximo en días, margen entre reservas) y `BookingBlackout` (bloqueos por fecha/rango: feriados,
  vacaciones). Migración aditiva.
- API CRUD con `site.update`, validación de servidor (tramos sin solaparse, duración 5–480 min,
  zona horaria válida, enlace de pago con `safeUrlSchema`), auditoría y límite por plan si aplica.
- **Cálculo de horarios libres en el servidor**, en la zona horaria del sitio (incluye cambios de
  horario de verano), descontando bloqueos, reservas existentes, anticipación y margen. Función
  pura con pruebas exhaustivas.
- Panel: sección "Reservas" del sitio con servicios y horario; estados de carga/vacío/error/éxito;
  responsive.

### F5.2 — Reserva pública desde la página
**Criterios de aceptación:**
- Bloque `booking` (PL5: "un botón más de la misma pila… su acción es abrir el flujo interno de
  reservas"): botón de la pila que abre, dentro del sitio, servicio → día → hora → datos (nombre,
  email, teléfono opcional, nota) → consentimiento → confirmar. Accesible por teclado, móvil primero.
- `POST /public/sites/:slug/bookings`: sin sesión, límite de tasa, anti-spam (mismo criterio que
  formularios F3.2), **sin doble reserva** garantizado por la base (restricción de exclusión o
  bloqueo transaccional, no una comprobación previa). Crea o actualiza el `Contact` del mini-CRM
  (fuente "reserva") y un evento analítico `booking_created`.
- Si el servicio tiene enlace de pago externo, la confirmación lo muestra ("Paga tu seña aquí"):
  Impulza no cobra ni confirma pagos (decisión #6).

### F5.3 — Agenda del negocio en el panel
**Criterios de aceptación:**
- Vista de lista y de calendario (día/semana) de las reservas del sitio, con filtros por estado;
  estados `CONFIRMED`, `CANCELLED`, `COMPLETED`, `NO_SHOW`; crear una reserva a mano; ver la ficha
  del contacto.
- Aislamiento por organización; permisos por rol.

### F5.4 — Confirmaciones, cancelación/reprogramación y recordatorios
**Criterios de aceptación:**
- Email de confirmación al visitante con archivo `.ics` y enlace firmado para cancelar o
  reprogramar (token de un solo propósito, vencible). Aviso al negocio.
- Recordatorio por cola (BullMQ en `apps/worker`) antes de la cita; idempotente.
- Cancelar/reprogramar respeta las mismas reglas de disponibilidad y la ventana mínima del sitio.

### F5.5 — Catálogo y pedidos con pago externo
**Criterios de aceptación:**
- Productos físicos, digitales y servicios con categorías, precio, imagen de la biblioteca, stock
  opcional y enlace de pago externo. Bloque de catálogo en la pila (PL6: botones, no tarjetas).
- Pedido como **solicitud**: el visitante deja sus datos; el negocio lo gestiona en el panel
  (nuevo → pagado → entregado/cancelado) y marca el pago a mano. Nada se cobra en Impulza.

### F5.6 — Campañas de email con consentimiento y bajas
**Criterios de aceptación:**
- Solo a contactos con consentimiento de marketing registrado (ADR-004); segmentos por etiqueta,
  fuente y estado; plantilla simple (texto enriquecido saneado); vista previa y envío de prueba.
- Envío por cola con límite por hora y por plan; enlace de baja firmado en cada email que se
  respeta de inmediato; métricas básicas (enviados, rebotes, bajas).

### F5.7 — Aislamiento y seguridad de Fase 5
**Criterios de aceptación:**
- Cada endpoint nuevo suma su caso a `multi-tenant-isolation.e2e.test.ts`.
- Endpoints públicos con límite de tasa, anti-spam y respuestas sin ids internos ni datos de otra
  organización.
