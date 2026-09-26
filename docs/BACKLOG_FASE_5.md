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
| F5.2 — Reserva pública desde la página (bloque "Reservar") | Pendiente |
| F5.3 — Agenda del negocio en el panel | Pendiente |
| F5.4 — Confirmaciones, cancelación/reprogramación y recordatorios | Pendiente |
| F5.5 — Catálogo y pedidos (productos físicos, digitales y servicios) con pago externo | Pendiente |
| F5.6 — Campañas de email con consentimiento y bajas | Pendiente |
| F5.7 — Aislamiento y seguridad de Fase 5 | Pendiente |
| — Seña cobrada, checkout, reembolsos, descargas pagadas, afiliados | Bloqueado (decisión #6) |
| — Profesionales y sucursales múltiples, integración de calendario externo/videollamada | Después de F5.4 (se diseña con uso real) |

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
