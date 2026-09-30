# Backlog — Fase 7 (Crecimiento: integraciones, bloques, embudos) y fases siguientes

Fuente: `PLAN_MAESTRO_PLATAFORMA_IDENTIDAD_DIGITAL.md` §7, §9.3, §9.10–9.15, §12, §14 y §18–19;
`02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` §9–§13. Creado el 2026-09-30 al cruzar el plan
maestro con lo construido. Cada historia usa la Definición de Terminado de `CLAUDE.md`.

## Estado

| Historia | Estado |
|---|---|
| F7.1 — Integraciones de medición: Google Analytics 4 y píxel de Meta (con consentimiento) | Lista para tu revisión (ADR-016; capturas en `docs/design/capturas/f71/`) |
| F7.2 — Webhooks salientes firmados (contacto, reserva, pedido) y conector para Zapier/Make | Lista para tu revisión (ADR-017; capturas en `docs/design/capturas/f72/`) |
| F7.3 — Bloques nuevos: cuenta regresiva, tabla de precios, mapa, video y música incrustados (lista cerrada, sin HTML libre), eventos | Pendiente |
| F7.4 — Suscripción a newsletter con doble confirmación | Pendiente |
| F7.5 — Secuencias de correo automáticas (bienvenida, seguimiento) sobre las automatizaciones | Pendiente |
| F7.6 — Embudos de conversión: pasos, tasas y abandono por paso | Pendiente |
| F7.7 — Modo campaña: página temporal con fecha de inicio/fin y vuelta automática | Pendiente |
| F7.8 — Tienda: variantes, cupones y carrito | Pendiente |
| F7.9 — Reservas: varios profesionales y sucursales; Google Calendar | Pendiente |
| F7.10 — Sitio comercial: Soluciones por rubro, Integraciones, Recursos, Política de privacidad | Pendiente |
| F7.11 — Superadministración: estado técnico, colas, feature flags, CMS de plantillas | Pendiente |
| F7.12 — Aislamiento y seguridad de Fase 7 | Pendiente |

## Historias

### F7.1 — Medición con Google Analytics 4 y píxel de Meta, con consentimiento (ADR-016)

Criterios de aceptación:
- En el panel, cada sitio configura su **ID de medición de GA4** (`G-…`) y su **ID de píxel de Meta**
  (solo dígitos); se validan en el servidor, se pueden quitar, exigen `site.update` y quedan
  auditados. Nunca se acepta un fragmento de código ni una URL: solo el identificador.
- La página pública **no carga nada de terceros sin consentimiento previo**. Si el sitio tiene una
  integración activa, el visitante ve un aviso con **Aceptar** y **Rechazar** con el mismo peso y
  **Configurar** (analítica y publicidad por separado). La elección se recuerda por sitio y
  versión; "Preferencias de cookies" al pie la reabre, y retirar el consentimiento deja de medir.
  La analítica propia anónima de Impulza (ADR-004) sigue igual: no necesita consentimiento.
- Con consentimiento se envían: vista de página, clic en WhatsApp, formulario enviado, reserva
  creada y pedido creado (con valor y moneda), **sin datos personales** (ni nombre, ni correo, ni
  teléfono). La vista previa del constructor nunca mide.
- **CSP y cabeceras de seguridad en `apps/web`** (faltaban, ST §15): la política permite solo los
  orígenes que la página usa de verdad más los dos proveedores, y se prueba que ninguna pantalla
  existente la viole.
- Pruebas: unitarias (validación, consentimiento, mapeo de eventos, cabeceras), e2e de API
  (permisos, validación, aislamiento, auditoría, respuesta pública) y Playwright (nada de terceros
  antes de aceptar; rechazar no carga nada; aceptar carga y mide conversiones; sin violaciones de
  CSP; teléfono y escritorio).

> **Estado (2026-09-30): F7.1 lista para revisión.**
> - Base: migración aditiva `20260930070000_f71_site_measurement` (dos columnas en `sites` con `CHECK`
>   de formato: la base rechaza `G-<script>`) y `down.sql` probado.
> - API: `GET`/`PUT /organizations/:org/sites/:site/measurement` (`site.update`; ANALYST solo lee),
>   validación de solo identificadores (GA4 normalizado a mayúsculas), auditoría **sin** los valores,
>   invalidación de la caché de la página. La respuesta pública lleva `measurement` (opcional en el
>   contrato: una respuesta en caché anterior sigue siendo válida). OpenAPI 164 rutas.
> - Web: aviso de consentimiento con los colores del tema (Aceptar y Rechazar con el mismo peso,
>   Configurar por categoría, "Preferencias de cookies" al pie, elección por sitio y versión en el
>   navegador, 6 meses; leída con `useSyncExternalStore`, sin diferencias de hidratación). GA4 con
>   señales de Google y personalización de anuncios apagadas; píxel de Meta con `consent grant/revoke`;
>   retirar el consentimiento apaga y borra sus cookies. Conversiones por un evento del navegador que
>   anuncian los bloques (formulario, reserva, pedido con valor y moneda) y el clic en WhatsApp, sin
>   datos personales; la vista previa del constructor no mide.
> - **CSP y cabeceras de seguridad en `apps/web` (deuda de ST §15):** política construida desde lo
>   que la página usa de verdad (inventario de orígenes), `form-action` incluye el almacenamiento para
>   la descarga pagada de F5.11b, HSTS y `upgrade-insecure-requests` solo con https. Zod en el
>   navegador sin compilar con `eval` (la prueba de CSP detectó el intento; la configuración ahora se
>   importa antes que cualquier esquema).
> - Panel: tarjeta "Medición" en el sitio con estado Activo/Apagado, dónde encontrar cada ID, aviso de
>   privacidad y validación con las mismas reglas del servidor.
> - Pruebas: validación +4, web +6 (cabeceras), API e2e 4 + casos en la suite central (la prueba de
>   "sin ids internos" en la respuesta pública pidió justificar el campo nuevo), Playwright
>   `medicion.spec.ts` 10/10: **ninguna petición a terceros antes de consentir**, rechazar no carga
>   nada, aceptar carga y mide la vista y el pedido sin datos personales, configurar por categoría y
>   retirar, sin violaciones de CSP. **Suite completa de Playwright 246/246** con la CSP activa; API
>   554/554.
> - Encontrado y corregido en el camino: el panel mostraba el ID tal como se escribió y no el guardado
>   (normalizado); la CSP habría bloqueado la redirección de la descarga pagada sin `form-action`.
> - Decisión abierta para el propietario: si la medición de terceros se restringe por plan
>   (decisión #4). Hoy está disponible en todos.

### F7.2 — Webhooks salientes firmados y conexión con Zapier/Make (ADR-017)

Criterios de aceptación:
- El dueño o un ADMIN (`webhooks.manage`) registra destinos (URL `https`, descripción, eventos) —
  hasta 10 —, los activa o pausa, los edita y los borra; el secreto de firma se muestra una sola
  vez y se puede rotar. Todo queda auditado.
- Eventos: contacto creado, reserva creada o cancelada, pedido creado o pagado, y un evento de
  prueba desde el panel. Cada envío va firmado (HMAC con marca de tiempo), con id de evento
  estable, y se entrega desde el worker con reintentos; nunca hace fallar la operación que lo
  originó.
- **Protección SSRF** probada: URLs a IPs privadas, loopback, metadata de la nube, IPv6 local o
  dominios que resuelven a ellas se rechazan, también si el DNS cambia después de guardar; sin
  redirecciones; tiempo máximo acotado.
- Registro de entregas con estado, código, duración, error e intentos; reenvío manual; `410` o 15
  fallas seguidas desactivan el destino y avisan al dueño; entregas borradas a los 30 días.
- Panel "Integraciones": lista, formulario, secreto con copiar, prueba, registro, y guía de Zapier y
  Make con ejemplos de cada evento y cómo verificar la firma. Estados de carga, vacío, error y éxito;
  teléfono y escritorio.
- Pruebas: unitarias (firma, SSRF, carga útil), e2e de API (permisos, validación, aislamiento,
  auditoría, emisión desde cada evento), worker contra un servidor HTTP real (entrega, reintentos,
  desactivación, retención) y Playwright del panel.

Implementación (2026-09-30):
- `packages/webhooks`: firma, `lookup` anti-SSRF (IPv4, IPv6 y mapeadas; IP literales revisadas antes
  de conectar), envío sin redirecciones (10 s, 4 KB), calendario de 8 intentos, creación y
  procesamiento de entregas (reclamo condicional: nunca dos envíos), mantenimiento y carga útil.
- API `organizations/:id/webhooks` (`webhooks.manage`): alta con el secreto una vez, edición,
  pausa/reanudación, rotación, prueba (`ping` o **ejemplo de cualquier evento** con `test: true`, para
  que Zapier o Make aprendan los campos), registro con filtro y detalle, y reenvío. Tope de 10, URL
  única por organización, todo auditado con el host (nunca la URL ni el secreto).
- Emisión en contactos (API y formularios), reserva pública y anotada, cancelación por el negocio,
  por el cliente y por seña vencida (worker), pedido público, y pago manual o por Mercado Pago.
- Worker: cola `webhook-deliveries` (concurrencia 10), aviso al dueño al desactivar, mantenimiento
  cada hora (reencola entregas colgadas y borra las de más de 30 días).
- Panel "Integraciones": destinos, secreto con copiar, envío de ejemplos, registro con motivo en
  palabras, y guía de Zapier/Make con la forma de cada evento y el código de verificación (probado
  contra el firmador real).
- Pruebas: 16 del paquete, 8 e2e de API + caso en `multi-tenant-isolation`, 9 del worker contra un
  servidor HTTP real, 4 de textos del panel y Playwright en teléfono y escritorio.
- Pendiente del propietario: app propia en el directorio de Zapier (requiere cuenta de desarrollador).

## Fases siguientes

| Fase | Contenido | Estado |
|---|---|---|
| Fase 8 — Experiencia | Animaciones y microinteracciones en sitio comercial, constructor y onboarding; más plantillas por rubro | Pendiente |
| Fase 9 — Agencia | Modo agencia, marca blanca | Bloqueada (decisión #8) |
| Fase 9 — Moderación | Reportes de abuso y moderación | Bloqueada (decisión #9) |
| Producción | Staging y producción, backups, monitoreo, correo real, R2 (F4.8) | Bloqueada (hosting) |
| Versión 2 | Membresías y cursos, marketplace, wallet y tarjeta digital, PWA | Después de lanzar |

## Pendientes transversales

- F4.6e — Cambiar de plan con uno activo (prorrateo).
- Deuda: timeouts bajo carga en la suite de la API (ya con base de pruebas propia).
