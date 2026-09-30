# ADR-013: Los negocios cobran a sus clientes con su propia cuenta de Mercado Pago conectada

- **Estado:** Aceptado
- **Fecha:** 2026-09-30
- **Fuente:** decisión #6 del propietario (chat del 2026-09-30): "sobre si los negocios pueden
  cobrar, creo que sí sería útil e innovador". Elegida la opción "cuenta propia conectada" y "sin
  comisión por venta, solo la suscripción". ST §12 (pagos: fase avanzada), `CLAUDE.md` (no custodiar
  tarjetas ni credenciales de terceros), ADR-012 (cobro de las suscripciones de Impulza).

## Contexto

Hasta ahora (F5.2, F5.5) la seña de una reserva y el pago de un pedido son un **enlace externo**
que el negocio pega a mano: Impulza no sabe si se pagó y el negocio marca "pagado" a mano. El
propietario decidió que el negocio pueda cobrar desde su página, con confirmación automática.

Tres formas posibles:

1. **Impulza recibe el dinero y lo reparte.** Impulza pasaría a ser un *operador de pagos* bajo la
   Ley Fintec (Ley 21.521) supervisado por la CMF: registro, capital, responsabilidad por
   contracargos y custodia de fondos de terceros. Descartada.
2. **Cada negocio pega sus propias llaves de API.** Credenciales permanentes, sin revocación ni
   alcance, copiadas a mano. Descartada.
3. **Cada negocio conecta su propia cuenta de Mercado Pago con OAuth** (con PKCE). El dinero va
   **directo a la cuenta del negocio**; Impulza solo crea el cobro a su nombre y recibe el aviso.

## Decisión

1. Se adopta la opción 3. **Impulza nunca recibe, retiene ni reparte dinero de un negocio**, y nunca
   ve datos de tarjeta: el comprador paga en el sitio de Mercado Pago (Checkout Pro).
2. **Excepción acotada** a la regla "no custodiar credenciales de terceros" de `CLAUDE.md`: se
   guarda **solo** el token OAuth que el negocio otorga al conectar (y su token de renovación),
   con estas salvaguardas obligatorias:
   - cifrado en reposo (AES-256-GCM, `AUTH_ENCRYPTION_KEY`), nunca en logs, respuestas ni auditoría;
   - el negocio puede **desconectar** en cualquier momento (se borra el token y se deja de cobrar);
   - conectar y desconectar exige el permiso `payments.connect` (solo el dueño) y queda auditado;
   - flujo OAuth con `state` firmado y de un solo uso y PKCE (`S256`);
   - renovación automática antes de los 180 días de validez; si falla, la cuenta queda
     "desconectada" y el negocio recibe aviso — nunca se cobra con un token vencido.
3. **Sin comisión por venta** (el ingreso de Impulza es la suscripción). La arquitectura admite
   `marketplace_fee` sin cambiar el modelo, si algún día se decide.
4. Cobro por **Checkout Pro**: una preferencia por pedido o seña, con `external_reference` = id del
   pedido o reserva, creada con el token del negocio. La confirmación llega por webhook y **se toma
   siempre del estado del pago consultado en la API de Mercado Pago con el token del negocio**,
   verificando que el pago pertenece a esa cuenta y a ese pedido y que el monto coincide. El cuerpo
   del aviso nunca es fuente de verdad.
5. Reembolsos y contracargos: el negocio reembolsa desde su panel (con su token); un contracargo
   informado por Mercado Pago marca el pedido y avisa al negocio. La relación comercial y
   tributaria con el comprador es **del negocio** (él emite su boleta), y así se lo dice el panel.
6. Los enlaces de pago externos (F5.2/F5.5) siguen disponibles para quien no conecte una cuenta.

## Alternativas consideradas

Ver "Contexto": recibir y repartir (regulado por la CMF, descartado) y llaves pegadas a mano
(inseguro, descartado). Webpay para negocios exige que cada uno tenga su contrato con Transbank:
queda como adaptador futuro sobre el mismo modelo de "cuenta conectada".

## Consecuencias

- Positivas: cobro con confirmación automática para cada negocio sin que Impulza sea intermediario
  financiero; seña de reservas y checkout de la tienda reales; el negocio controla y revoca el acceso.
- Negativas: Impulza guarda un token delegado por negocio (riesgo acotado por las salvaguardas de
  arriba); depende de la disponibilidad de Mercado Pago; el negocio necesita cuenta de Mercado Pago.
- Seguimiento: revisar si aparece un requisito regulatorio nuevo para plataformas que facilitan
  cobros sin custodiar fondos, o si el propietario decide cobrar comisión.

## Restricciones asociadas

- Ningún módulo usa el token de un negocio para algo distinto de crear, consultar y reembolsar los
  cobros de **ese** negocio.
- Toda confirmación de pago se valida contra la API de Mercado Pago con el token del mismo negocio.
- Un pedido o reserva solo se marca pagado si el monto y la moneda del pago coinciden con los suyos.
