# ADR-022: Modo campaña — página temporal con fechas, toma del inicio y vuelta automática

- **Estado:** Aceptado
- **Fecha:** 2026-10-01
- **Fuente:** F7.7 (`docs/BACKLOG_FASE_7.md`), plan maestro §14.5 ("Landing temporal con URL, QR,
  fechas, objetivo, UTM y reporte separado"), F2.7 (caché de la página pública), F3.5 (QR), F6.6
  (UTM en Smart CTA), ADR-021 (visitas del día). Aprobado por el propietario al pedir continuar con
  el desarrollo completo en el orden del backlog.

## Contexto

Un negocio quiere, por ejemplo, una página "Cyber" que se vea solo del 1 al 3 de noviembre, que
durante esos días **sea** lo primero que ve quien entra al sitio, y que después todo vuelva solo a
la normalidad, sin que nadie tenga que acordarse de despublicar nada. También quiere saber cuánto
rindió esa campaña por separado. Hay que decidir qué es una campaña, cómo se aplica el cambio en
la hora exacta si la página pública se cachea hasta la próxima publicación, y de dónde sale el
reporte.

## Decisión

1. **Una campaña es una página ya publicada del sitio con una ventana de fechas** (inicio y fin, en
   UTC; el panel las muestra en la zona del navegador), un nombre, un objetivo (captar, vender,
   reservar, mostrar, compartir) y un `utm_campaign`. No se duplica contenido: la página se edita y
   publica como cualquier otra. La página de inicio no puede ser una campaña.
2. **Página temporal de verdad**: fuera de su ventana, la página de una campaña no se sirve (404) ni
   aparece en el menú ni en el sitemap. Una campaña cancelada o borrada devuelve la página a ser una
   página normal.
3. **Tomar el inicio (opcional)**: durante la ventana, la raíz del sitio muestra la página de la
   campaña. Los metadatos de la raíz (canonical, Open Graph) siguen siendo los del inicio, para no
   enseñarle a un buscador una URL temporal. Al terminar, la raíz vuelve sola al inicio.
4. **Sin solapes que confundan**: una página no puede estar en dos campañas con ventanas que se
   crucen, y un sitio no puede tener dos campañas que tomen el inicio a la vez. Se comprueba en una
   transacción con bloqueo por sitio.
5. **La hora exacta se respeta invalidando la caché**: la API calcula siempre con la hora actual; el
   worker revisa cada minuto las campañas que empezaron o terminaron y no fueron avisadas, y pide a
   `apps/web` invalidar el sitio (mismo webhook firmado que publicar, F2.7). Cada aviso queda marcado
   (`start_revalidated_at`, `end_revalidated_at`) para no repetirlo. Crear, editar, cancelar o borrar
   una campaña también invalida al instante.
6. **URL, UTM y QR**: el panel arma la URL de la campaña con `utm_source`, `utm_medium` y
   `utm_campaign` y crea el QR con el módulo existente (URL directa, F3.5): sin código nuevo de QR.
7. **Reporte separado, mismo criterio que los embudos (ADR-021)**: visitas del día que vieron la
   página de la campaña dentro de la ventana, y cuántas de ellas después interactuaron, escribieron,
   reservaron, pidieron o pagaron; desglose por fuente (`utm_source` de la vista). Solo totales.
8. **Permisos y límites**: leer, cualquier miembro; crear, editar, cancelar y borrar, `site.update`
   (tomar el inicio cambia lo que ve todo visitante). Hasta 50 campañas por sitio. Auditoría.

## Alternativas consideradas

- **Copiar el contenido a una página nueva por campaña**: duplica trabajo y deja páginas huérfanas.
- **Revalidar la página pública por tiempo (`revalidate: 60`)**: la campaña podría empezar hasta un
  minuto tarde en cada sitio y multiplicaría las peticiones a la API de todos los sitios, tengan
  campañas o no. El aviso puntual del worker es exacto y solo toca los sitios que cambian.
- **Redirigir la raíz a la URL de la campaña**: cambia la URL que el visitante comparte y un 307 en
  la raíz confunde a los buscadores; mostrar el contenido en la raíz es lo que el negocio espera.

## Consecuencias

- Positivo: campañas con fecha que empiezan y terminan solas, con su enlace, su QR y su reporte.
- Negativo: la campaña empieza con hasta un minuto de diferencia (el ciclo del worker); sin worker
  ni `WEB_APP_URL` configurados, el cambio se ve recién en la próxima publicación o invalidación.
- Hallazgo relacionado: los **bloques programados** (F2) tienen el mismo problema de caché y hoy no
  cambian a la hora exacta en la página publicada. Queda anotado para resolverlo con este mismo
  mecanismo en una historia aparte.
