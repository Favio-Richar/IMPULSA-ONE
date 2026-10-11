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
