# ADR-012: Cobro de suscripciones con Webpay Oneclick y Mercado Pago, con cumplimiento de consumo chileno

- **Estado:** Aceptado
- **Fecha:** 2026-09-29
- **Fuente:** decisión #5 del propietario en el chat del 2026-09-29: "en pasarela de pago podemos
  integrar Mercado Pago, Webpay, la que se usa en Chile; recuerda, debemos seguir un criterio legal
  en este sistema. Sobre los planes, debe tener un plan free para atraer usuarios y que luego se
  animen a pagar una suscripción de acuerdo a sus necesidades". ST §12 (pagos), ARCHITECTURE §5
  (adaptadores), ADR-004 (datos personales).

## Contexto

F4.6 estaba bloqueada por la decisión #5 (pasarela de suscripción). El modelo freemium ya existe:
`PLAN_CATALOG` trae Gratis, Profesional y Negocio, y `PlansService.resolveEffectivePlan` ya da el
plan de una `Subscription` vigente. Lo que falta es crear y mantener esas suscripciones cobrando de
verdad.

Las dos pasarelas funcionan distinto:

- **Webpay Oneclick Mall (Transbank).** El cliente inscribe su tarjeta una vez en el sitio de
  Transbank; Transbank devuelve un `tbk_user` (referencia, no la tarjeta). **El comercio decide
  cuándo cobrar** (`POST /oneclick/v1.2/transactions`). No hay webhooks: la respuesta del cobro es
  síncrona. Requiere contrato Oneclick Mall con Transbank (código de comercio "mall" + tienda hija).
- **Mercado Pago Suscripciones (`/preapproval`).** El cliente autoriza en Mercado Pago; **Mercado
  Pago cobra cada período** y avisa por webhook firmado (`x-signature`, HMAC-SHA256 sobre
  `id`, `request-id` y `ts`).

Marco legal chileno que afecta el cobro (Ley 19.496, reformada por la Ley 21.398 "Pro Consumidor";
reglamento de exclusiones al retracto publicado en 2024; Ley 21.719 de datos personales):

1. Precio total informado con claridad, con IVA incluido, antes de pagar.
2. **Derecho a retracto de 10 días** en contratos por medios electrónicos (art. 3 bis b), que el
   proveedor debe informar de forma inequívoca **antes** de contratar y pagar.
3. El consumidor puede **terminar el contrato por el mismo medio** por el que lo contrató (acá: el
   panel), sin trámites adicionales.
4. Confirmación escrita de la contratación y de cada cobro.
5. Cada cobro de Impulza es una venta de servicio afecta a IVA y requiere **documento tributario
   electrónico** (boleta o factura) ante el SII. Ninguna de las dos pasarelas lo emite por nosotros.

## Decisión

1. **Paquete `packages/payments` (`@impulza/payments`)** con el puerto `SubscriptionGateway` y dos
   adaptadores por HTTP directo (`fetch`), sin SDK de terceros, igual que `packages/ai`:
   - `WEBPAY_ONECLICK`: `startEnrollment` → URL de Transbank; `finishEnrollment(token)` →
     referencia de inscripción; `charge(ref, buyOrder, amount)`; `refund`; `removeEnrollment`.
     Capacidad `recurrence: "merchant"`.
   - `MERCADO_PAGO`: `startEnrollment` crea un `preapproval` → `init_point`; `getSubscription`;
     `cancel`; `refund`; `verifyWebhook`. Capacidad `recurrence: "provider"`.
   Credenciales por variables de entorno validadas al iniciar; sin credenciales, esa pasarela no
   se ofrece en el panel (el sistema no se rompe: como la IA en ADR-010).
2. **Motor de facturación propio** (`apps/api` módulo `billing` + trabajo del worker):
   - `Subscription` se amplía con pasarela, ciclo (mensual/anual), `cancelAtPeriodEnd`,
     referencia cifrada del medio de pago (`tbk_user` o id de `preapproval`, con `encryptSecret`
     de `@impulza/auth`), y contadores de reintento.
   - `Payment`: un registro por cobro con `buyOrder` **único** derivado de
     `(suscripción, inicio de período, intento)` → un cobro nunca se ejecuta dos veces aunque el
     trabajo se repita (idempotencia no negociable).
   - `PaymentWebhookEvent`: único por `(proveedor, id de evento)`; el webhook se registra antes de
     procesarse y un duplicado responde 200 sin efecto.
   - Renovación: el worker cobra cada día las suscripciones Oneclick vencidas; Mercado Pago se
     sincroniza por webhook (y una conciliación diaria consultando `preapproval` por si se perdió
     un aviso).
   - Morosidad: cobro fallido → `PAST_DUE` con **gracia de 7 días** y reintentos a los días 1, 3 y
     6. Agotada la gracia → `CANCELED` y la organización vuelve a Gratis. **Nunca se borra
     contenido**: los límites de F4.2 ya impiden crear más allá del plan y lo existente se conserva.
3. **Cumplimiento legal en el flujo:**
   - Pantalla de pago con precio total "IVA incluido", ciclo, fecha del próximo cobro y renovación
     automática explícita.
   - Aceptación obligatoria de Términos (versión vigente) y aviso de retracto, guardada en
     `LegalAcceptance` (usuario, organización, documento, versión, fecha) para poder probarla.
   - **Retracto:** en los 10 días desde el primer cobro, "Cancelar y pedir reembolso" desde el panel
     devuelve el 100 % por la misma pasarela y la organización vuelve a Gratis. Se ofrece siempre,
     sin acogerse a exclusiones del reglamento: es más simple, más seguro legalmente y da confianza.
   - **Cancelación por el mismo medio:** un botón en el panel, sin llamadas ni correos; queda activa
     hasta el fin del período pagado y no se vuelve a cobrar.
   - Correos transaccionales: suscripción creada, cobro realizado (comprobante), cobro fallido,
     aviso 7 días antes de renovar un plan **anual**, cancelación y reembolso.
4. **Documentos tributarios:** puerto `TaxDocumentIssuer` con un adaptador inicial `MANUAL` que deja
   cada cobro aprobado como "documento pendiente de emitir" en la superadministración (con monto
   neto, IVA y total). Un proveedor de DTE (emisión automática ante el SII) es un adaptador más,
   cuando el propietario elija uno y tenga su certificado digital. **No bloquea construir; bloquea
   cobrar en producción** (ver "Seguimiento").
5. **Precios con IVA incluido.** `Plan.priceMonthly/priceYearly` se interpretan como precio final al
   consumidor; el neto y el IVA (19 %) se calculan al registrar el pago, con redondeo a peso entero.

## Alternativas consideradas

- **Solo Mercado Pago.** Una sola integración, recurrencia gestionada por ellos. Descartada como
  única opción: el propietario pidió Webpay, que es el medio que más usan los chilenos con tarjetas
  de débito (Redcompra), y depender de una sola pasarela es un punto único de falla.
- **Un agregador (Flow, Kushki, Reveniu) que ofrezca ambas.** Menos código, pero agrega comisión y un
  intermediario más con acceso al flujo de pago, y el propietario nombró las pasarelas directas. El
  puerto `SubscriptionGateway` permite sumarlo después como adaptador si conviene por costos.
- **Webpay Plus (pago único) renovado a mano cada mes.** Obliga al cliente a pagar manualmente cada
  período; mata la conversión. Descartada.
- **SDK oficiales (`transbank-sdk`, `mercadopago`).** Descartados por la misma razón que en
  ADR-010: las APIs usadas son pocas y REST simples; `fetch` + Zod en la frontera da control total de
  timeouts, registros sin datos sensibles y pruebas sin red.

## Consecuencias

- Positivas: el freemium queda completo de punta a punta; dos pasarelas locales; idempotencia y
  auditoría en cada cobro; la organización nunca pierde contenido por un pago fallido; el
  cumplimiento de retracto y cancelación queda en el producto, no en un proceso manual.
- Negativas: Oneclick obliga a que Impulza programe los cobros (más lógica propia que Mercado
  Pago). Mientras el emisor de DTE sea `MANUAL`, alguien debe emitir las boletas a mano desde la
  lista de pendientes.
- Seguimiento (bloquean **cobrar en producción**, no construir): contrato Oneclick Mall con
  Transbank y cuenta Mercado Pago de la empresa con sus credenciales; elección de proveedor de DTE y
  certificado digital (o emisión manual asumida por el propietario); texto final de Términos y
  Política de Privacidad revisado por un abogado. Revisar esta decisión si las comisiones de ambas
  pasarelas superan a las de un agregador en más de un 1 % del ingreso mensual.

## Restricciones asociadas

- Nunca datos de tarjeta en nuestros servidores, registros ni correos: solo referencias de la
  pasarela, y cifradas en reposo.
- Todo cobro pasa por `Payment` con `buyOrder` único; ningún cobro fuera del motor de facturación.
- Todo webhook se verifica por firma **antes** de leer su contenido y se registra por id único.
- El plan de una organización lo sigue decidiendo solo `PlansService.resolveEffectivePlan`.
- Ningún cambio de plan de pago sin aceptación de Términos registrada.
