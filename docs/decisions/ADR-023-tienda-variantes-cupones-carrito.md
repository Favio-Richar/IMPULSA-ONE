# ADR-023: Tienda — variantes, cupones y carrito con líneas de pedido

- **Estado:** Aceptado
- **Fecha:** 2026-10-01
- **Fuente:** F7.8 (`docs/BACKLOG_FASE_7.md`), plan maestro §9.10 (tienda: variantes, cupones,
  carrito), F5.5 (catálogo y pedidos), F5.9 y ADR-013 (cobro con Mercado Pago a nombre del negocio),
  F5.11 y ADR-015 (reembolsos y descargas), ADR-021 (eventos del servidor y su sujeto). Aprobado por
  el propietario al pedir continuar con el desarrollo completo en el orden del backlog.

## Contexto

Hoy un pedido es **un producto por una cantidad** (F5.5): el pedido copia nombre, tipo, precio y
cantidad del producto, y todo lo que viene después (cobro en Mercado Pago, avisos por correo,
webhooks, descargas, reembolsos, panel de pedidos, embudos) lee esas columnas. La historia pide tres
cosas que rompen esa forma: **variantes** (talla, color: cada una con su stock y, a veces, su precio),
**cupones** (descuento que el servidor tiene que calcular y respetar al cobrar) y **carrito** (varios
productos en un pedido). Hay que decidir el modelo sin dañar los cobros, las descargas ni los pedidos
que ya existen.

## Decisión

1. **Variantes como filas propias** (`product_variants`): nombre visible ("M / Rojo"), precio
   opcional (sin él, el del producto), stock opcional (sin él, sin control), SKU opcional, orden y
   activa. Hasta 30 por producto. Un producto con al menos una variante activa **exige** elegir una
   al pedir, y entonces el stock que cuenta es el de la variante (el del producto se ignora). Una
   variante borrada no rompe pedidos: el pedido guarda su nombre y precio (copia, como hoy).
2. **Líneas de pedido** (`order_items`): cada pedido nuevo tiene una o más líneas con la copia de
   producto, variante, tipo, precio unitario, cantidad, total de la línea y **dónde reservó stock**
   (`product`, `variant` o ninguno) para devolverlo exacto al cancelar. Los pedidos existentes reciben
   su línea con una migración **que solo inserta** (copia de las columnas actuales); ninguna columna
   se borra.
3. **Las columnas del pedido se conservan como resumen**, para que el código que ya las lee siga
   correcto: con una sola línea son exactamente lo que eran; con varias, `product_id` va nulo,
   `product_name` es un resumen ("Polera — M y 2 productos más"), `quantity` es el total de unidades y
   `unit_price_amount` es el subtotal (precio de "1 pedido"). `total_amount` es siempre lo que se
   cobra: subtotal menos descuento. Columnas nuevas: `subtotal_amount`, `discount_amount`,
   `coupon_id` (SET NULL) y `coupon_code` (copia).
4. **Cobro**: la preferencia de Mercado Pago lleva un solo ítem por el **total a cobrar** (título =
   resumen, cantidad 1) cuando hay varias líneas o descuento; con una sola línea sin descuento sigue
   igual que hoy. La verificación del pago ya compara monto y moneda contra `total_amount`, así que no
   cambia. Webpay Oneclick (suscripciones de la plataforma) no se toca.
5. **Carrito en el navegador del visitante** (por sitio, sin cookies de terceros ni datos personales,
   ADR-004): se guarda solo `productId`, `variantId` y cantidad. Al pedir, el servidor recalcula
   **todo** (precios, disponibilidad, moneda, descuento) desde la base; lo que diga el navegador solo
   elige qué y cuánto. Hasta 20 líneas por pedido, una sola moneda por pedido. **Un producto digital
   se compra solo** (no se mezcla en un carrito con otros): las descargas y su reembolso (ADR-015)
   siguen funcionando por pedido sin cambios; se puede levantar más adelante con descargas por línea.
6. **Stock sin carreras**: cada línea descuenta con una actualización condicional (`stock >=
   cantidad`) dentro de una sola transacción; si una falla, se revierte el pedido entero (409 con la
   línea que no alcanzó). Cancelar devuelve cada línea a su fuente; reabrir vuelve a reservar todas o
   ninguna.
7. **Cupones** (`coupons`, por sitio): código (mayúsculas, único por sitio), porcentaje (1–100) o
   monto fijo (en la moneda del cupón), mínimo de compra opcional, ventana opcional (inicio/fin), tope
   de usos opcional y activo. El descuento lo calcula el servidor sobre el subtotal (nunca deja el
   total bajo cero; el porcentaje se redondea a la unidad mínima hacia abajo). El uso se cuenta con una
   actualización condicional (`redemption_count < max_redemptions`) en la misma transacción del
   pedido: dos pedidos simultáneos no pasan el tope. Cancelar un pedido **no** devuelve el uso (evita
   abusar del tope cancelando y repitiendo). La página pública valida un código sin revelar cuáles
   existen más allá de "no es válido" (con tope por IP).
8. **Eventos**: `order_created` sigue con sujeto = producto cuando hay una línea y sin sujeto con
   varias (los embudos por producto siguen igual; la clave de idempotencia sigue siendo
   `order_created:<pedido>`, que es lo que cruza el pago en ADR-021). Los webhooks y automatizaciones
   agregan las líneas al payload sin quitar campos.
9. **Entrega por partes** (cada una un commit con su Definición de Terminado): **F7.8a** variantes y
   líneas de pedido; **F7.8b** cupones; **F7.8c** carrito en la página pública.

## Consecuencias

- Todo lo que lee el pedido sigue funcionando sin tocarlo; el panel y los correos muestran las líneas
  cuando existen.
- Un carrito no puede incluir un producto digital junto con otros (limitación conocida, explicada en
  la página pública).
- El descuento de un cupón no se reparte por línea: un reembolso parcial sigue siendo por monto sobre
  el total cobrado (ADR-015), igual que hoy.
- Las columnas resumen del pedido duplican información de las líneas a propósito; la fuente de verdad
  del detalle son las líneas.
