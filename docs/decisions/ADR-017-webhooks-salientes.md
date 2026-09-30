# ADR-017: Webhooks salientes firmados, con protección SSRF al conectar

- **Estado:** Aceptado
- **Fecha:** 2026-09-30
- **Fuente:** F7.2 (`docs/BACKLOG_FASE_7.md`), plan maestro §9.15 ("Webhooks", "Estado, permisos y
  registros de sincronización"), ST §15 (webhooks firmados, prevención de SSRF), ADR-004 (datos
  personales y retención). Aprobado por el propietario al pedir continuar con F7.2.

## Contexto

Los negocios quieren que sus contactos, reservas y pedidos lleguen solos a otras herramientas
(Zapier, Make, su planilla, su CRM). La forma estándar es un webhook: Impulza hace un `POST` a una
URL del negocio cuando algo pasa. Es la primera vez que el servidor hace peticiones a URLs que
escribe un cliente, lo que abre la puerta a **SSRF**: usar el servidor para llegar a su red interna o
a la metadata de la nube (`169.254.169.254`), incluso con un dominio que resuelve a una IP privada o
que cambia de IP entre la validación y el envío (*DNS rebinding*).

## Decisión

1. **Solo `https`, sin redirecciones, y la IP se valida al conectar.** Al guardar se rechazan URLs
   con usuario/contraseña, puertos no estándar, IPs literales y dominios reservados. Al enviar, la
   resolución DNS pasa por un `lookup` propio que rechaza toda dirección no pública (loopback, redes
   privadas, link-local, CGNAT, multicast, reservadas, IPv4 mapeada en IPv6, ULA): la conexión usa
   exactamente la IP que se validó, así que un cambio de DNS no la burla. Tiempo máximo 10 s y
   respuesta leída hasta 4 KB.
2. **Firma HMAC-SHA256 con marca de tiempo:** cabecera `Impulza-Signature: t=<unix>,v1=<hex>` sobre
   `<t>.<cuerpo>`. El secreto (`whsec_…`) se genera en el servidor, se guarda cifrado
   (`AUTH_ENCRYPTION_KEY`), se muestra **una sola vez** y se puede rotar. Se recomienda rechazar
   firmas de más de 5 minutos.
3. **Entrega en el worker, con reintentos:** 8 intentos en ~1 día (1 min, 5 min, 30 min, 2 h, 6 h,
   12 h…). 2xx = entregado. `410 Gone` desactiva el destino al tiro. **15 fallas seguidas**
   desactivan el destino y avisan al dueño. Cada evento tiene un id estable: el receptor puede
   descartar duplicados.
4. **Registro de entregas** para el negocio (estado, código de respuesta, duración, error, intentos)
   con reenvío manual. El cuerpo enviado incluye datos personales de sus propios clientes (el negocio
   es el responsable): las entregas se **borran a los 30 días** (ADR-004, minimización).
5. **Eventos:** `contact.created`, `booking.created`, `booking.cancelled`, `order.created`,
   `order.paid` y `ping` (prueba). Carga útil versionada (`apiVersion`), con los datos ya
   resueltos al momento del evento.
6. **Permiso nuevo `webhooks.manage`** (OWNER y ADMIN): ver URLs (pueden llevar tokens), crear,
   editar, rotar, probar y reenviar. Tope de 10 destinos por organización.
7. **Zapier y Make** se conectan con sus receptores genéricos ("Catch Hook", "Custom webhook"); el
   panel trae la guía, ejemplos de cada evento y cómo verificar la firma. Una app propia en el
   directorio de Zapier queda para cuando el propietario tenga cuenta de desarrollador ahí.

## Alternativas consideradas

- **Validar la IP solo al guardar la URL:** vulnerable a *DNS rebinding*. Descartada.
- **Proxy de salida dedicado (tipo Smokescreen):** más robusto en infraestructura grande; queda como
  mejora de producción. El `lookup` propio cubre el mismo riesgo sin otro servicio.
- **Firmar sin marca de tiempo:** permite reenviar un aviso capturado indefinidamente. Descartada.

## Consecuencias

- Positivas: integraciones con cualquier herramienta sin custodiar credenciales de terceros; el
  servidor no puede usarse para llegar a su red interna.
- Negativas: el negocio tiene que verificar la firma para estar protegido (se le explica cómo); los
  reintentos agregan carga al worker (acotada por los topes).
- Seguimiento: app propia en Zapier y Make; proxy de salida en producción si el volumen lo pide.

## Restricciones asociadas

- Nunca se conecta a una dirección no pública, ni siguiendo una redirección.
- Nunca se registra ni se devuelve el secreto después de crearlo o rotarlo.
- Toda entrega vieja de más de 30 días se borra.
