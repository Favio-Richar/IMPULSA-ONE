# ADR-004: Privacidad y retención de datos para conversión y analítica (Ley 21.719)

- **Estado:** Aceptado
- **Fecha:** 2026-09-22
- **Fuente:** `REQUIREMENTS_TRACEABILITY.md` §15 decisión #10; Ley N° 21.719 (Chile) que modifica la
  Ley 19.628 sobre protección de la vida privada y crea la Agencia de Protección de Datos
  Personales — publicada en diciembre de 2024 con una vacancia legal de 24 meses, por lo que rige
  desde diciembre de 2026; `docs/architecture/ERD.md` §5 y §7 (Contact, ContactEvent,
  FormSubmission, AnalyticsEvent, AnalyticsAggregate).

## Contexto

Fase 3 introduce el primer módulo que trata datos personales de terceros ajenos a la cuenta que
paga el servicio: contactos captados por formularios (nombre, email, teléfono) y eventos de
analítica ligados a visitantes del sitio público. `REQUIREMENTS_TRACEABILITY.md` marca
explícitamente que la política de privacidad y retención debe resolverse **antes** de construir la
analítica de Fase 3 — no es una decisión de producto pospostergable, es la que fija qué campos
existen, cuánto se guardan y qué endpoints de borrado hacen falta desde el primer commit del
módulo.

Chile promulgó en diciembre de 2024 la Ley 21.719, que reemplaza el régimen de la Ley 19.628 con
un modelo cercano al RGPD europeo: base de licitud para tratar datos, principio de minimización y
limitación de finalidad, plazos de conservación acotados a la finalidad, derechos ARCO+ (acceso,
rectificación, cancelación, oposición, y portabilidad/bloqueo), deber de informar brechas de
seguridad, y una Agencia de Protección de Datos Personales con potestad fiscalizadora. Tiene una
vacancia legal de 24 meses desde su publicación, por lo que entra en vigor en diciembre de 2026 —
antes de que Impulza One tenga lanzamiento comercial (decisiones #1/#2/#4/#5 de la traceability
siguen abiertas), pero mientras el producto está en desarrollo activo ahora es exactamente cuando
hay que fijar el modelo de datos para no reescribirlo bajo presión de cumplimiento después.

No existe todavía una política de privacidad publicada por el propietario del producto (decisión
de negocio, no técnica) ni un DPO designado. Esta ADR fija el **mínimo técnico exigible por diseño
y por defecto** (privacy by design/default, que la propia ley recoge como principio) para que el
modelo de datos de Fase 3 sea compatible con la ley desde que se crea, no una decisión de negocio
sobre textos legales o comunicación al usuario.

## Decisión

1. **Minimización en `AnalyticsEvent`**: nunca se guarda la IP cruda. Se deriva país/ciudad
   aproximados en el momento de recibir el evento y se descarta el octeto/IP original de inmediato;
   no hay columna `ip_address`. El identificador de visitante (`anonymized_visitor_id`) es un hash
   con sal rotada por sitio y por día — nunca un identificador estable entre días ni un valor
   reversible a IP/dispositivo real. No se usa fingerprinting de dispositivo.
2. **Exclusión de bots**: el pipeline de ingestión (F3.6) descarta tráfico de user-agents conocidos
   de bots/crawlers antes de persistir el evento — ya lo exige ST §10; esta ADR lo hace criterio de
   aceptación obligatorio, no opcional.
3. **Base de licitud y consentimiento en `Contact`**: `consent_status` no es un campo decorativo.
   Todo `Contact` creado desde un `FormSubmission` público exige que el formulario tenga al menos un
   campo de consentimiento explícito (checkbox no premarcado) antes de poder enviarse; se persiste
   `consent_source`, `consent_text_version` y `consent_at` junto al contacto (auditoría de qué
   texto aceptó y cuándo). Un formulario sin campo de consentimiento configurado no puede crear
   `Contact`s con marketing/seguimiento asociado — solo registra la `FormSubmission` cruda si el
   dueño del sitio decide no pedir consentimiento (a su propio riesgo, documentado en la UI del
   constructor de formularios).
4. **Retención por defecto** (ajustable por el propietario del producto cuando publique su política
   real, pero nunca "indefinida" por omisión):
   - `AnalyticsEvent` (evento crudo, con `anonymized_visitor_id`): 14 meses desde `created_at`.
     Vencido el plazo, un job programado lo purga; solo sobrevive en `AnalyticsAggregate`
     (agregados sin dato personal, sin límite de retención por no ser identificables).
   - `Contact` y su `ContactEvent`/`FormSubmission` asociados: se conservan mientras exista
     relación comercial activa; sin ninguna interacción nueva en 36 meses, el job de retención los
     marca para revisión (no borrado automático silencioso — un dato de contacto de negocio no se
     purga sin que el propietario de la organización lo confirme, a diferencia del evento anónimo
     de analítica).
   - Estos números viven en configuración (no hardcodeados en el código de negocio) para que el
     propietario los ajuste cuando fije la política de privacidad pública, sin migración de schema.
5. **Derechos ARCO+ — soporte mínimo desde Fase 3**: aunque el portal de autoservicio para
   titulares es explícitamente posterior (Fase 4/6, superadministración/soporte), Fase 3 debe dejar
   **operable por API/administración** — no solo "posible con una consulta SQL manual" — el borrado
   completo de un `Contact` (cascada a `ContactEvent`/`FormSubmission` vinculados) y la exportación
   de sus datos en un formato legible, con auditoría de quién ejecutó el borrado/exportación
   (reutilizando `AuditLog` de F1.7). Es el mínimo para poder atender una solicitud ARCO+ real sin
   una tarea de emergencia cuando llegue la primera.
6. **Brechas de seguridad**: no se diseña un flujo nuevo en Fase 3 — se apoya en la observabilidad
   ya existente (F1.10: logs estructurados, Sentry) más el `AuditLog`. Queda anotado como deuda
   declarada para cuando exista una política de privacidad pública: falta el procedimiento formal
   de notificación de brechas a la Agencia y a los titulares que exige la ley: **no bloquea Fase 3**
   porque es un proceso operativo/legal, no una entidad de datos nueva.
7. **Nada de esto sustituye una política de privacidad publicada ni asesoría legal formal**: esta
   ADR fija el mínimo técnico para no construir en la dirección contraria a la ley; el texto legal
   público, el nombramiento de un DPO si corresponde por volumen de datos, y el registro ante la
   Agencia son decisiones de negocio/legales explícitamente fuera del alcance de esta ADR y deben
   resolverse antes de un lanzamiento comercial (decisión #10 sigue "recomendada, no obligatoria
   para seguir construyendo" en ese sentido — lo que esta ADR resuelve es el modelo de datos, no el
   trámite legal completo).

## Alternativas consideradas

- **Posponer toda la analítica hasta que exista política de privacidad publicada**: descartado —
  bloquearía F3.6/F3.7 indefinidamente por una decisión de negocio/legal que no depende de
  ingeniería, cuando el riesgo real (guardar de más, guardar para siempre, no poder borrar) se
  puede neutralizar con minimización y retención acotada desde el diseño.
- **Guardar IP completa "por si acaso" para analítica/fraude**: descartado — es exactamente el tipo
  de dato que la ley obliga a minimizar; geolocalización aproximada sin IP cruda cubre el caso de
  uso real (país/ciudad en el dashboard) sin el riesgo.
- **Retención indefinida de `AnalyticsEvent` crudo** (como muchos SaaS hacen por defecto):
  descartado — contradice el principio de limitación de conservación; los agregados sin dato
  personal ya cubren el valor de negocio a largo plazo.
- **Borrado de `Contact` como tarea manual de soporte (ticket → SQL)**: descartado como único
  mecanismo — no es operable a escala ni auditable; se requiere una vía de API/administración desde
  el inicio, aunque la UI de autoservicio llegue después.

## Consecuencias

- Positivas: el modelo de datos de Fase 3 nace compatible con la ley que rige desde diciembre de
  2026, sin deuda técnica de "rediseñar Contact/AnalyticsEvent bajo presión regulatoria" más
  adelante. Los agregados sin caducidad siguen dando valor de negocio (dashboard histórico) aunque
  el detalle crudo se purgue.
- Negativas: exige un job de retención (BullMQ, nuevo) desde F3.6 y campos adicionales en `Contact`
  (consentimiento) que no estaban en la lista mínima original de PM §9.7 — más superficie que
  probar (incluida una prueba de purga y una de borrado en cascada).
- Seguimiento: cuando el propietario defina la política de privacidad pública real (nombre/dominio
  y lanzamiento comercial, decisiones #1/#2), revisar los plazos de retención de esta ADR contra el
  texto publicado y ajustarlos si difieren — es un cambio de configuración, no de schema, por el
  punto 4.

## Restricciones asociadas

- Ningún endpoint nuevo de Fase 3 persiste IP cruda ni identificador de visitante estable entre
  días.
- Ningún `Contact` con seguimiento/marketing se crea desde un formulario sin consentimiento
  explícito capturado y auditado.
- Ninguna historia de F3.6/F3.7 se da por terminada sin el job de purga por retención probado
  (incluye prueba de que el agregado sobrevive y el evento crudo no).
- El borrado de un `Contact` debe ser operable por API/administración con auditoría, no solo por
  acceso directo a base de datos.
