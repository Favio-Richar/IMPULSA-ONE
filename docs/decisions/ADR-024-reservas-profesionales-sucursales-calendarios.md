# ADR-024: Reservas — profesionales, sucursales y sincronización con calendarios (iCal y Google Calendar)

- **Estado:** Aceptado
- **Fecha:** 2026-10-01
- **Fuente:** F7.9 (`docs/BACKLOG_FASE_7.md`), plan maestro §9.9 (reservas: profesionales, sucursales,
  disponibilidad, bloqueos, integración con calendario), F5.1–F5.4 (reservas básicas y agenda),
  F5.10 y ADR-013 (seña con Mercado Pago), ADR-017 y ADR-021 (webhooks y embudos de conversión).
  Aprobado por el propietario para continuar con el desarrollo completo en el orden del backlog.

## Contexto

Hoy el módulo de reservas (F5.1–F5.4) asume un único calendario por sitio: la restricción de
exclusión `bookings_no_overlap` sobre Postgres (`EXCLUDE USING gist (site_id WITH =, tstzrange(starts_at, ends_at) WITH &&)`)
impide que dos personas reserven a la misma hora en el mismo sitio. Sin embargo, salones, clínicas,
centros de estética, consultorios y academias operan con **múltiples profesionales** (atendiendo en
paralelo a la misma hora) y/o **múltiples sucursales** (locales o salas independientes). Además, los
profesionales gestionan su día a día en Google Calendar u otros calendarios móviles, por lo que
necesitan sincronizar sus citas sin depender exclusivamente de entrar al panel de Impulza.

## Decisión

1. **Sucursales (`booking_branches`)**:
   - Cada sitio puede registrar hasta 20 sucursales con nombre, dirección opcional, teléfono e
     indicaciones, orden y estado activo.
   - Si un sitio no tiene sucursales activas (o tiene solo 1), la reserva pública no pide elegir sede.
     Con 2 o más sucursales activas, el visitante puede filtrar o seleccionar la sucursal deseada.
   - En la reserva (`bookings`) se guardan `branch_id` (FK SET NULL) y `branch_name` (copia histórica).

2. **Profesionales / Prestadores (`booking_staff`)**:
   - Cada sitio puede registrar profesionales con nombre visible ("Dra. Paula Rojas"), título o
     especialidad ("Odontóloga"), correo, teléfono, avatar opcional, orden y estado activo.
   - Horario semanal opcional (`weekly_hours`): si está presente, el profesional atiende según sus
     propias ventanas; si es nulo, hereda el horario semanal general del sitio (`BookingSettings`).
   - Sucursal opcional (`branch_id`): vincula al profesional con una sucursal principal.
   - En la reserva (`bookings`) se guardan `staff_id` (FK SET NULL) y `staff_name` (copia histórica).

3. **Asignación Servicio–Profesional (`service_staff`)**:
   - Relación N:M entre `bookable_services` y `booking_staff`.
   - Si un servicio no tiene profesionales asignados explícitamente en la tabla intermedia, se
     considera habilitado para **todos los profesionales activos** del sitio. Si tiene filas, solo
     los profesionales asignados y activos pueden atenderlo.

4. **Bloqueos de agenda (`booking_blackouts`)**:
   - Se agrega la columna opcional `staff_id` (FK SET NULL) a `booking_blackouts`.
   - Un bloqueo con `staff_id = NULL` aplica a todo el sitio (feriado general, cierre de local).
   - Un bloqueo con `staff_id` asignado aplica únicamente a ese profesional (vacaciones, consulta
     médica, día libre), dejando disponibles a los demás miembros del equipo.

5. **Exclusión de no-solapamiento en PostgreSQL (`bookings_no_overlap`)**:
   - Se actualiza la restricción de exclusión mediante:
     ```sql
     ALTER TABLE "bookings" DROP CONSTRAINT "bookings_no_overlap";
     ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
         "site_id" WITH =,
         COALESCE("staff_id", '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
         tstzrange("starts_at", "ends_at", '[)') WITH &&
     ) WHERE ("status" IN ('CONFIRMED', 'PENDING_PAYMENT'));
     ```
   - **Garantía matemática y compatibilidad**:
     - Sitios tradicionales (sin profesionales): `staff_id` es NULL, por lo que evalúa a
       `00000000-0000-0000-0000-000000000000`. Dos reservas en el mismo sitio y horario colisionan (cero dobles reservas).
     - Sitios con profesionales: cada profesional tiene su propio UUID. Dos reservas simultáneas
       con distintos profesionales (`staff_A` vs `staff_B`) tienen claves diferentes y **se permiten en paralelo**.
       Dos reservas simultáneas con el mismo profesional colisionan en la base a nivel transaccional.

6. **Disponibilidad (`/availability`) y opción "Cualquier profesional"**:
   - El endpoint público acepta parámetros opcionales `staffId` y `branchId`.
   - Si se selecciona un profesional concreto, se calculan sus intervalos libres considerando su
     horario, bloqueos (del sitio y propios) y sus reservas confirmadas/pendientes.
   - Si se elige "Cualquiera" (o no se especifica y el servicio tiene múltiples profesionales), un
     slot de hora está disponible si **al menos un** profesional calificado está libre en ese horario.
   - Al reservar con "Cualquiera", el servidor asigna atómicamente a uno de los profesionales libres
     (priorizando el que tenga menor carga de reservas el día de la cita), garantizando que la reserva
     quede asociada a un profesional concreto y evitando carreras.

7. **Sincronización de calendarios (iCal y Google Calendar)**:
   - **Feed iCal seguro (.ics)**: cada profesional y el sitio disponen de un token de acceso secreto
     (`calendar_feed_token`) para suscribirse mediante URL en Google Calendar, Apple Calendar o
     Outlook (`GET /api/v1/public/bookings/calendar-feed/:token.ics`). No requiere ninguna cuenta de
     desarrollador de terceros y funciona de inmediato en local y producción.
   - **Google Calendar OAuth**: tabla `google_calendar_connections` para almacenar tokens cifrados
     (`access_token`, `refresh_token`, `calendar_id`, `staff_id`). Se implementa la interfaz
     adaptadora `GoogleCalendarProvider`. La sincronización real con la API de Google se activa en
     cuanto el propietario suministre las credenciales OAuth en las variables de entorno; en ausencia
     de credenciales, el sistema no falla y registra la operación en modo pendiente.

8. **Entrega por partes**:
   - **F7.9a**: Sucursales, profesionales, asignación a servicios, actualización de `bookings_no_overlap`,
     disponibilidad combinada y selector en panel y página pública.
   - **F7.9b**: Horarios semanales por profesional y bloqueos personales.
   - **F7.9c**: Feed iCal universal y sincronización con Google Calendar.

## Consecuencias

- Sitios existentes continúan funcionando idéntico sin requerir cambios de configuración.
- Los negocios pueden escalar su capacidad de atención sin riesgo de dobles reservas accidentales.
- Historial intacto: las reservas guardan copia de nombres de sucursal y profesional (`branch_name`, `staff_name`),
  incluso si estos se editan o borran posteriormente.
