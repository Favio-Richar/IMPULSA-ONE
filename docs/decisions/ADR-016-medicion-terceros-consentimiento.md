# ADR-016: Medición de terceros (GA4 y píxel de Meta) solo con consentimiento, y CSP en la página pública

- **Estado:** Aceptado
- **Fecha:** 2026-09-30
- **Fuente:** F7.1 (`docs/BACKLOG_FASE_7.md`), plan maestro §9.15 ("Analítica y píxeles") y §9 punto
  10 ("Footer legal y cookies"), ADR-004 (Ley 21.719), ST §15 (CSP desde el primer commit),
  `CLAUDE.md` ("nada de HTML/JS arbitrario en páginas públicas"). Aprobado por el propietario al
  pedir continuar con Fase 7 ("aplica buen desarrollo completo").

## Contexto

Los negocios quieren medir sus campañas con Google Analytics 4 y con el píxel de Meta. Esas
herramientas envían datos del visitante a terceros, con cookies y fines publicitarios: bajo la Ley
21.719 (ADR-004) eso requiere una base de licitud, y la única razonable para publicidad y
analítica de terceros es el **consentimiento previo, libre e informado**. Por otro lado, `CLAUDE.md`
prohíbe HTML o JavaScript arbitrario en las páginas públicas, y `apps/web` no tenía una política
CSP (deuda de ST §15).

## Decisión

1. **Solo identificadores, nunca código:** el negocio guarda un ID de GA4 (`G-` más 4 a 15
   caracteres alfanuméricos) y un ID de píxel de Meta (10 a 20 dígitos). El script que se carga es
   siempre el oficial del proveedor, armado por Impulza. No hay campo de "código personalizado".
2. **Consentimiento previo por categoría:** analítica (GA4) y publicidad (Meta). Sin elección, o
   con "Rechazar", no se carga ni se contacta a ningún tercero. Aceptar y rechazar tienen el mismo
   peso visual. La elección se guarda **en el navegador del visitante** (por sitio y versión del
   aviso, 6 meses), se reabre con "Preferencias de cookies" y retirarla detiene la medición. El
   aviso solo aparece si el sitio tiene alguna integración activa.
3. **Minimización:** a los proveedores se envían eventos (vista, clic en WhatsApp, formulario,
   reserva, pedido con valor y moneda) **sin datos personales**; GA4 con señales de Google y
   personalización de anuncios desactivadas. La analítica propia de Impulza (ADR-004, anónima y
   sin cookies) no cambia y no depende del aviso.
4. **CSP en `apps/web`:** `default-src 'self'`; scripts propios más los dos proveedores (con
   `'unsafe-inline'`, que Next.js necesita para hidratar sin un nonce que obligaría a renderizar
   cada página sin caché); imágenes `https:` (las que eligen los negocios); iframes solo de
   YouTube (sin cookies) y Vimeo; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
   `frame-ancestors 'self'`. Más `X-Content-Type-Options`, `Referrer-Policy`,
   `Permissions-Policy` y HSTS en producción.

## Alternativas consideradas

- **Campo de "código de seguimiento" libre:** cubre cualquier herramienta, pero es exactamente el
  JavaScript arbitrario que `CLAUDE.md` prohíbe (XSS a un clic del negocio). Descartada.
- **Google Tag Manager:** permite al negocio inyectar cualquier cosa desde fuera. Descartada por la
  misma razón; se puede reconsiderar con una lista cerrada de etiquetas.
- **Consent Mode v2 cargando GA4 antes del consentimiento (en modo "denegado"):** igual contacta a
  Google antes de que el visitante decida. Descartada: nada de terceros sin consentimiento.
- **CSP con nonce:** más estricta con los scripts en línea, pero obliga a renderizar cada página en
  cada visita (sin la caché de F2.7). Queda como mejora cuando se mida su costo.

## Consecuencias

- Positivas: los negocios miden sus campañas sin romper la ley ni la seguridad de la página; la
  página pública gana una CSP que antes no tenía.
- Negativas: los visitantes que rechazan no aparecen en GA4 ni en Meta (es el comportamiento
  correcto); `'unsafe-inline'` en scripts deja la CSP menos estricta que una con nonce.
- Seguimiento: API de conversiones de Meta y Measurement Protocol de GA4 desde el servidor (compras
  confirmadas) cuando haya una decisión sobre enviar datos del lado del servidor; si esto se
  restringe por plan, lo decide el propietario (decisión #4).

## Restricciones asociadas

- Nunca se carga un script de terceros que no esté en la lista cerrada de este ADR.
- Nunca se envía a un tercero un dato personal del visitante (nombre, correo, teléfono, dirección).
- Todo origen nuevo que cargue la página pública se agrega a la CSP en el mismo cambio, con su prueba.
