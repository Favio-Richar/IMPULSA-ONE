# Backlog — Fase 7 (Crecimiento: integraciones, bloques, embudos) y fases siguientes

Fuente: `PLAN_MAESTRO_PLATAFORMA_IDENTIDAD_DIGITAL.md` §7, §9.3, §9.10–9.15, §12, §14 y §18–19;
`02_STACK_ARQUITECTURA_E_INSTRUCCIONES_CLAUDE.md` §9–§13. Creado el 2026-09-30 al cruzar el plan
maestro con lo construido. Cada historia usa la Definición de Terminado de `CLAUDE.md`.

## Estado

| Historia | Estado |
|---|---|
| F7.1 — Integraciones de medición: Google Analytics 4 y píxel de Meta (con consentimiento) | Lista para tu revisión (ADR-016; capturas en `docs/design/capturas/f71/`) |
| F7.2 — Webhooks salientes firmados (contacto, reserva, pedido) y conector para Zapier/Make | Pendiente |
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
