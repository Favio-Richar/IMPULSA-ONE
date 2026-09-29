# ADR-011: Pruebas A/B con reparto en el servidor y variante calculada por la API

- **Estado:** Aceptado
- **Fecha:** 2026-09-28
- **Fuente:** `BACKLOG_FASE_6.md` F6.5 ("reparto estable por visitante anonimizado (ADR-004), sin
  cookies de terceros"; "se recomienda un ganador solo con muestra suficiente (prueba estadística
  documentada)"; "aplicar el ganador es una acción explícita del usuario"), PM §14.6, ADR-004.

## Contexto

Una prueba A/B necesita tres cosas que chocan con decisiones anteriores:

1. **Estabilidad**: la misma persona debe ver siempre la misma variante. El visitante anonimizado de
   ADR-004 rota **cada día** a propósito, así que no sirve para repartir.
2. **Sin parpadeo**: si el HTML llega con A y el navegador cambia a B, quien cae en B ve A un
   instante y la medición se contamina.
3. **Medición confiable**: si el navegador informara "vi la variante B", cualquiera podría inflar
   los resultados de otra persona con un `curl` (el mismo motivo por el que `lead_created` nunca se
   acepta desde el navegador, F3.6).

## Decisión

1. **Grupo del visitante, no identidad.** Una cookie propia del sitio (`imp_ab`) guarda un número al
   azar de 0 a 99. Lo comparten cientos de personas: no identifica a nadie, no se cruza con el
   visitante anonimizado y no es de terceros. Se crea **solo** cuando la página tiene una prueba en
   curso (sin pruebas no se lee ni se escribe ninguna cookie) y dura 180 días.
2. **Reparto exacto y estable.** `abVariantFor(clave, grupo) = (grupo + fnv1a(clave) mod 2) mod 2`:
   exactamente 50 grupos por variante, estable para siempre, y el desplazamiento por prueba evita
   que dos pruebas repartan igual. La clave es pública y opaca (no es el id).
3. **La variante se elige en el servidor.** `apps/web` renderiza la página por petición (las rutas
   del sitio ya eran dinámicas; los datos siguen en la caché por etiqueta), lee el grupo y aplica
   los cambios de B antes de pintar. Sin parpadeo. La API entrega por bloque solo `{ key, variantB }`:
   ni nombre, ni fechas, ni resultados.
4. **La API calcula la variante al contar.** `apps/web` reenvía el grupo a la API en la cabecera de
   visitante (`x-impulza-visitor-ab-bucket`), que solo se cree con el secreto compartido
   (`INTERNAL_PROXY_SECRET`). `AnalyticsService` busca las pruebas en curso del evento y calcula la
   variante con la misma función: exposición = vista de la página de la prueba; clic = clic en el
   bloque probado (en el encabezado de perfil, cualquier clic de esa página); conversión = envío de
   formulario, reserva o pedido del sitio. El navegador nunca declara una variante. Los conteos son
   métricas del agregado existente (`ab:<evento>:<prueba>:<a|b>`), sin tabla nueva de eventos.
5. **Qué se puede probar.** Solo texto y estilo de botones de acción (enlace, WhatsApp, reservas,
   tienda) y el subtítulo del encabezado de perfil (`AB_TEST_FIELD_SCHEMAS`). Nunca la URL, el
   teléfono ni el destino: se compara cómo se presenta la acción, no adónde lleva. A es la
   configuración **publicada** (se guarda una copia al empezar); B se valida con el mismo esquema en
   el panel, al crear y al leer.
6. **Estadística.** Prueba z de dos proporciones (clics por exposición, dos colas, clics acotados a
   las exposiciones). Ganador solo con **≥ 200 exposiciones por variante, ≥ 30 clics en total y
   p < 0,05**; con muestra y sin significación, "sin diferencia clara"; sin muestra, "sin resultado
   todavía" y cuánto falta. Las conversiones se informan pero no deciden (con los volúmenes de una
   página personal serían casi siempre insuficientes).
7. **Aplicar es explícito y no publica.** "Aplicar B" escribe los cambios sobre el **borrador actual**
   del bloque por la edición normal (validación, sanitización, versión); "Quedarme con A" solo cierra
   la prueba. En ambos casos llega a los visitantes al publicar.
8. **Límites.** A lo sumo una prueba en curso por bloque (índice único parcial) y `abTestsRunning`
   por organización en el plan (provisorio: 1 / 3 / 10 / 30; un plan guardado antes toma 1).

## Consecuencias

- Las páginas con una prueba en curso se sirven con la variante correcta desde el primer byte; las
  demás no cambian en nada (ni cookie ni lógica extra).
- Exposiciones = vistas de página, no personas únicas: quien recarga cuenta dos veces, igual en
  ambas variantes. Es el mismo criterio honesto de ADR-004 (sin identificador estable).
- Si la página se vuelve a publicar sin el bloque probado, las vistas siguen sumando exposiciones
  hasta que alguien termine la prueba: queda anotado para cuando exista una revisión automática de
  pruebas huérfanas.
- Alguien podría fijar su propia cookie en un grupo: solo cambia qué variante ve él, de forma
  coherente con lo que se cuenta. No permite atribuir eventos a otra variante ni a otro sitio.
