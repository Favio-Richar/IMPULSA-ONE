# ADR-030 — Webpay Plus como segundo medio de cobro del negocio

- **Estado:** Aceptado (2026-10-11). Origen: instrucción explícita de Favio — en Chile se usa Webpay, no solo Mercado Pago.
- **Relacionados:** ADR-012 (cobro de la suscripción de Impulza: Webpay Oneclick y Mercado Pago), ADR-013 (cada negocio cobra con su
  propia cuenta de Mercado Pago), ADR-029 (membresías).

## Contexto
Hoy el negocio cobra a **sus** clientes (pedidos F5.9, señas de reservas F5.10, membresías F10.2) solo con Mercado Pago. Webpay existe
únicamente para cobrarle la suscripción al negocio (Oneclick). En Chile, buena parte de los compradores espera pagar con Webpay.

## Decisiones

1. **Webpay Plus, con las credenciales del propio negocio.** Cada comercio tiene su **código de comercio** y su **llave secreta** de
   Transbank. El negocio las ingresa en Cobros (cifradas con la misma clave que los tokens de Mercado Pago, nunca devueltas ni
   registradas). Así el dinero va **directo a la cuenta del negocio** y Impulza **no custodia ni cobra comisión** (regla dura de
   `CLAUDE.md`). Se descarta una «tienda hija» de Impulza que reciba el dinero y lo reparta: sería custodiar dinero de terceros.
2. **Dos medios, el comprador elige.** Si el negocio conectó ambos, el visitante ve «Pagar con Mercado Pago» y «Pagar con Webpay». Si
   solo tiene uno, solo ese. Sin ninguno, no se ofrece cobro en línea (comportamiento actual).
3. **Reutiliza `PaymentAccount`:** una cuenta por pasarela por organización (`WEBPAY_PLUS` se suma a `MERCADO_PAGO`). El código de
   comercio va en `provider_user_id`, la llave cifrada en `access_token_encrypted`, y `live_mode` distingue producción de integración.
4. **Confirmación sin webhooks.** Webpay Plus no avisa por webhook: el comprador vuelve a una URL nuestra con un `token_ws` y **el
   servidor confirma** (`PUT /transactions/{token}`). Nunca se acepta lo que diga la URL: se exige que el token sea el que se creó para
   esa compra, que `status = AUTHORIZED`, `response_code = 0` y que monto y orden de compra coincidan. La confirmación es idempotente
   (se asigna el pago de forma condicional; confirmar dos veces el mismo token no cambia nada). Un comprador que cierra la ventana deja la
   compra pendiente y Transbank la anula sola: no se cobra nada.
5. **Solo CLP** por ahora (lo que cobra el comercio estándar).
6. **Lo que Webpay Plus NO da** y se declara: no hay aviso automático de reembolsos o contracargos (Mercado Pago sí). La devolución se
   registra desde el panel (anulación vía API de Transbank) y el negocio puede revocar a un miembro a mano. Cuando exista, queda
   documentado en el backlog de cada consumidor.
7. **Consumidores, en este orden:** membresías (F10.2c), pedidos de la tienda (F10.2d), señas de reservas (F10.2e). Cada uno guarda el
   proveedor con que se pagó.

## Consecuencias
- Un adaptador `WebpayPlus` (+ `FakeWebpayPlus` para CI) en `@impulza/payments`, junto al de Oneclick.
- Credenciales reales de Transbank las pone el propietario al final; todo se prueba con el adaptador simulado y el ambiente de
  integración público de Transbank.
- Cada negocio debe contratar Webpay Plus con Transbank (proceso comercial suyo, fuera del producto); la pantalla de Cobros lo explica.

## Addendum — pedidos de la tienda (F10.2d, 2026-10-11)

- La transacción de un pedido se crea **al pulsar «Pagar»** (no al hacer el pedido): cada intento necesita la suya y solo la última se confirma al volver; Transbank revierte sola la que nunca se confirma.
- Pedido y membresía comparten el criterio: monto y orden de compra salen de lo guardado, el servidor confirma, asignar el pago es condicional.
- **Devolución:** un pedido pagado con Webpay no pasa por la API de Mercado Pago; la API lo rechaza con 422 y el panel indica hacerlo en Transbank. La acción «anular compra» desde el panel (API de reversa/anulación
  de Transbank) queda como seguimiento de este ADR.
- **CSP:** `form-action` de `apps/web` debe incluir `https://*.transbank.cl`; sin eso el navegador bloquea el envío a Webpay.

## Addendum — señas de reservas (F10.2e, 2026-10-11)

- Mismo criterio que pedidos y membresías: la transacción se crea al pulsar «Pagar» en «Tu reserva» (el enlace firmado de la reserva es la credencial), el monto es la seña **guardada**, el servidor confirma la
  transacción guardada y confirma la reserva de forma condicional (una sola vez), verificando orden de compra y monto.
- La hora sigue tomada hasta el plazo de pago; si vence y el worker la libera, un pago tardío reutiliza la rutina existente (confirma si la hora sigue libre; si no, avisa al negocio con constancia).
- **Devolución:** una seña pagada con Webpay no pasa por Mercado Pago; la API responde 422 y el panel indica el portal de Transbank. Con esto, los tres consumidores previstos (membresías, pedidos, reservas)
  quedan cubiertos; sigue pendiente la acción «anular compra» desde el panel.
