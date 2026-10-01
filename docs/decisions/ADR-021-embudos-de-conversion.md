# ADR-021: Embudos de conversión ordenados por visita, calculados en SQL sobre los eventos

- **Estado:** Aceptado
- **Fecha:** 2026-10-01
- **Fuente:** F7.6 (`docs/BACKLOG_FASE_7.md`), plan maestro §9.12 ("Embudo") y §14.3 ("Embudo
  completo: visita → interacción → contacto/reserva/carrito → pago → recurrencia"), F3.6 (pipeline
  de analítica), ADR-004 (privacidad y retención). Aprobado por el propietario al pedir continuar con
  el desarrollo completo en el orden del backlog.

## Contexto

El panel de conversión (F3.7) muestra un "embudo" de cuatro **conteos sueltos** leídos de los
agregados diarios (visitantes, clics, envíos, contactos). No dice cuántas de las personas que vieron
la página hicieron clic **y después** escribieron: los números ni siquiera tienen por qué ser de las
mismas personas. Un embudo real necesita seguir a una misma visita paso a paso, en orden, y saber
dónde abandona. Hay que decidir qué identifica a "una misma visita", de dónde salen los datos, cómo
se cuenta el pago (que llega por otro camino) y qué se puede y no se puede medir sin romper ADR-004.

## Decisión

1. **La unidad es la visita anonimizada del día** (`anonymized_visitor_id`, hash con sal rotada por
   sitio y día, ADR-004). Un embudo cuenta personas-día que cumplen los pasos **en orden** (cada paso
   en el mismo instante o después del anterior). No se agrega ningún identificador estable entre
   días: la privacidad de ADR-004 no se relaja por esta función.
2. **Se calcula en SQL sobre `analytics_events`**, no sobre los agregados: un CTE por paso que toma,
   para cada visita que llegó al paso anterior, el primer evento del paso siguiente posterior a él.
   Solo salen totales por paso, nunca filas por visita. Con hasta 6 pasos y rango máximo de un año,
   la consulta usa un índice nuevo `(site_id, type, created_at)`.
3. **Sujeto del evento persistido.** `analytics_events` gana la columna `subject_id` (texto, nula),
   la misma que ya viajaba en el trabajo del pipeline (página de un `page_view`, bloque de un clic,
   producto de un pedido, servicio de una reserva). Así un paso puede ser "vio **esta** página" o
   "hizo clic en **este** bloque". Los eventos anteriores a la migración no la tienen: cuentan en los
   pasos sin filtro, no en los filtrados (se avisa en el panel).
4. **El pago no se instrumenta: se cruza.** El paso "Pago" son las visitas cuyo `order_created`
   corresponde a un pedido con `paid_at`, o cuyo `booking_created` corresponde a una reserva con
   `deposit_paid_at`. El cruce usa la clave de idempotencia que esos eventos ya guardan
   (`order_created:<pedido>`, `booking_created:<reserva>`), porque su sujeto es el producto o el
   servicio (lo usan los agregados por producto, F5.5). Cubre el cobro con Mercado Pago, la seña y el
   pago marcado a mano, sin tocar ningún código de cobro, catálogo ni reservas. El instante del paso
   es el del pago, aunque llegue días después.
5. **Pasos de un catálogo cerrado**, cada uno con uno o más eventos ("contacto, reserva o pedido"):
   vista de página, clic en bloque, clic en WhatsApp, envío de formulario, contacto nuevo, reserva,
   pedido y pago. De 2 a 6 pasos, hasta 10 embudos por sitio. Un embudo sugerido sigue el plan
   maestro §14.3.
6. **"Recurrencia" queda fuera.** Medir que una persona vuelve otro día exige un identificador
   estable entre días, que ADR-004 prohíbe. La recurrencia de clientes se ve en el mini-CRM (un
   contacto con varios pedidos o reservas), no en la analítica anónima.
7. **Mismos límites que el resto de la analítica**: el historial del plan (`analyticsHistoryDays`,
   402) y un año por consulta. Leer, cualquier miembro; crear, editar y borrar embudos,
   `page.manage` (el mismo de las pruebas A/B, F6.5). Cada cambio queda auditado.

## Alternativas consideradas

- **Sobre los agregados diarios**: rápido, pero no puede decir que el paso 2 lo hicieron las mismas
  personas del paso 1. Es justo el defecto del embudo de F3.7.
- **Identificador de visitante persistente (cookie)**: permitiría recurrencia y embudos de varios
  días, pero exige consentimiento y rompe la minimización de ADR-004. Descartado.
- **Emitir un evento `order_paid` desde los cobros**: obliga a tocar el webhook de Mercado Pago, la
  seña y el pago manual, y a recuperar la visita en cada uno. El cruce al consultar da lo mismo sin
  tocar código de pagos.

## Consecuencias

- Positivo: embudos reales (personas que avanzan en orden), con conversión, abandono y tiempo
  mediano entre pasos, hasta el pago; sin datos personales nuevos.
- Negativo: una visita que cruza la medianoche cuenta como dos (el hash rota por día); los pasos
  filtrados por página o bloque solo cuentan eventos desde la migración.
- Seguimiento: si un sitio grande hace lenta la consulta, materializar por día (no antes de medirlo).
