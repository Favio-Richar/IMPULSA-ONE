# ADR-015: Descargas pagadas con almacenamiento privado y enlaces firmados de corta vida

- **Estado:** Aceptado
- **Fecha:** 2026-09-30
- **Fuente:** F5.11 (`docs/BACKLOG_FASE_5.md`: "productos digitales con enlace de descarga firmado que
  solo se entrega tras el pago"), ADR-006 (almacenamiento de medios), ADR-013 (cobros de los
  negocios). Aprobado por el propietario al pedir continuar con F5.11b tras la propuesta del
  2026-09-30.

## Contexto

La biblioteca de medios (ADR-006) vive en un bucket **público**: cualquier objeto se lee con su URL
del dominio de medios, sin firma. Sirve para las fotos de una página, pero no para vender un
archivo: quien tenga la URL lo descarga para siempre, haya pagado o no.

## Decisión

1. **Bucket privado aparte** (`STORAGE_PRIVATE_BUCKET`), mismo proveedor, credenciales y endpoint
   que el de medios, **sin dominio público ni política de lectura**. Debe ser distinto del bucket
   público (se valida al arrancar). Sin esa variable, la venta de archivos no se ofrece y nada más
   cambia.
2. **Solo archivos de productos digitales** van ahí: un archivo por producto (`ProductFile`), clave
   decidida por el servidor (`org/{org}/products/{producto}/{archivo}`), subida con URL prefirmada
   (tipo y tamaño firmados, 10 min) y confirmación que verifica tamaño exacto y tipo real por bytes
   mágicos. Tipos admitidos: PDF, ZIP, EPUB, MP3, MP4, PNG y JPEG; hasta 200 MB por archivo.
   **Cuentan para la cuota de almacenamiento del plan** (la misma de ADR-006).
3. **Entrega solo tras el pago:** el comprador recibe un enlace firmado (HMAC con
   `BOOKING_LINK_SECRET` y propósito propio, como "gestiona tu reserva" y la baja de campañas) a
   `/pedido/descarga/{token}`. Esa página pide a la API una **URL prefirmada de lectura de 5
   minutos** con `Content-Disposition: attachment`, nueva en cada visita. La API la entrega solo si
   el pedido está pagado o entregado, no cancelado, sin devolución total ni contracargo, y el
   producto tiene su archivo listo.
4. **Tope de 20 descargas por pedido** (contador en el pedido) y límite de tasa por visitante: un
   enlace compartido públicamente se agota; el negocio ve el contador y puede ayudar al comprador.
5. Reemplazar el archivo de un producto entrega el nuevo a todos sus compradores; borrar el producto
   borra su archivo (las descargas de sus pedidos dejan de estar disponibles, y el panel lo avisa
   antes).

## Alternativas consideradas

- **Mismo bucket con claves impredecibles:** cualquier URL filtrada sirve para siempre y el bucket
  público no se puede restringir por prefijo en R2. Descartada.
- **Servir el archivo a través de la API (proxy):** control total, pero la API cargaría con el ancho
  de banda de archivos grandes. Descartada: la URL prefirmada de pocos minutos da el mismo control.
- **Enlace aleatorio guardado como hash** (como "Tu pedido" de F5.9): el enlace no se puede volver a
  armar para el correo de "pago confirmado". Se usa firma HMAC para poder incluirlo en cada correo.

## Consecuencias

- Positivas: venta de archivos sin que Impulza toque el dinero (ADR-013) y sin exponerlos; el
  mismo contrato de almacenamiento (ADR-006) sirve para ambos buckets.
- Negativas: un bucket más que crear y respaldar; quien descargó el archivo puede compartirlo (ningún
  sistema de descargas lo evita), solo se limita el enlace.
- Seguimiento: revisar el tope de descargas y el tamaño máximo con uso real; límites por plan si
  aparecen negocios que venden archivos muy pesados.

## Restricciones asociadas

- Nunca se expone la URL del bucket privado fuera de una URL prefirmada de lectura de ≤ 5 minutos.
- Nunca se entrega un archivo sin verificar en el servidor el estado de pago del pedido.
- `STORAGE_PRIVATE_BUCKET` no puede ser igual a `STORAGE_BUCKET`.
