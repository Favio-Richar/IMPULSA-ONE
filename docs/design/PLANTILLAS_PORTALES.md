# Plantillas del editor de portales (2026-10-15)

41 plantillas en el catálogo: las 13 base y 28 nuevas. Cada una es un portal de **inicio + 2 páginas internas** (el máximo de
`TEMPLATE_MAX_COMPANION_PAGES`, lo que admite el plan Gratis). El inicio es perfil + botones; cada botón importante lleva a una
página interna (`page:<slug>`). En **todas**, justo debajo del perfil van las vistas y el «me gusta» (`engagement`).

Reglas verificadas por `packages/validation/src/templates/portales.test.ts` (y en la página pública real por
`packages/e2e/tests/plantillas-portales.spec.ts`).

## Suscripción

Botón «Suscribirme» (`subscribe`) solo en rubros que viven de una comunidad. En servicios y negocios locales no se fuerza: ahí
las vistas y «me gusta» son lo que corresponde.

- **Base con suscripción:** creador-personal, fotografia-moda, portada-minimal, academia-talleres, fitness-entrenamiento,
  musico-banda.
- **Base sin suscripción (se quitó el 2026-10-15):** profesional-servicios, cafe-gastronomia, comercio-tienda, salud-bienestar,
  eventos-turismo, belleza-barberia, restaurante-menu.

## Plantillas nuevas

| # | Rubro | Código | Página interna 1 (bloques) | Página interna 2 (bloques) | Suscripción |
|---|---|---|---|---|---|
| 1 | Barbería y estética masculina | `barberia-equipo` | `equipo`: vitrina en grilla (una tarjeta por barbero → reservas), reseñas, WhatsApp | `reservas`: booking, servicios con precio, mapa, FAQ | No: negocio local |
| 2 | Streaming y gaming | `streaming-gaming` | `horarios`: events, video, FAQ | `apoyo`: pricing (niveles), subscribe, catalog (merch) | Sí: comunidad |
| 3 | Video corto (TikTok/Reels) | `video-corto-creador` | `colecciones`: vitrina **índice con portada**, feature | `exclusivo`: pricing, subscribe, FAQ | Sí: contenido exclusivo |
| 4 | YouTuber | `youtuber-canal` | `videos`: video, vitrina en grilla, newsletter | `colaboraciones`: stats, pricing (patrocinios), WhatsApp | Sí: miembros |
| 5 | Contenido por suscripción | `contenido-suscripcion` | `planes`: pricing, subscribe, FAQ | `adelanto`: galería **esfera 3D**, texto, subscribe | Sí: es el negocio |
| 6 | Docencia y clases particulares | `clases-particulares` | `clases`: servicios con precio, events (talleres), reseñas | `reservar`: booking, pasos, FAQ | Sí: material para alumnos |
| 7 | Fotografía de bodas y eventos | `fotografia-bodas` | `portafolio`: álbum con filtros, reseñas | `reservas`: pricing (paquetes), booking, FAQ | No: servicio |
| 8 | Música y podcast | `musica-podcast` | `episodios`: music, video, newsletter | `fechas`: events, WhatsApp | Sí: club de oyentes |
| 9 | Fitness y coaching | `coaching-fitness` | `planes`: pricing, reseñas (5★), pasos | `reservas`: booking, mapa, FAQ | Sí: rutinas online |
| 10 | Abogado / estudio jurídico | `estudio-juridico` | `areas`: 4 servicios, pasos | `consulta`: booking, FAQ, mapa | No: servicio |
| 11 | Contador / asesor financiero | `asesor-financiero` | `servicios`: servicios, feature | `consulta`: booking, contacto, FAQ | No: servicio |
| 12 | Clínica dental o estética | `clinica-dental` | `tratamientos`: servicios, álbum antes/después, reseñas | `reservas`: booking, mapa, FAQ | No: salud |
| 13 | Veterinaria | `veterinaria` | `servicios`: servicios, reseñas | `reservas`: booking, mapa, FAQ (vacunas, urgencias) | No: salud |
| 14 | Inmobiliaria / corredor | `corredor-propiedades` | `propiedades`: catalog, vitrina **índice con portada**, WhatsApp | `oficina`: WhatsApp, mapa, pasos | No: servicio |
| 16 | Evento único | `evento-unico` | `detalles`: pasos (programa), mapa, FAQ, WhatsApp (asistencia) | `fotos`: galería **esfera 3D**, WhatsApp | No: es un evento |
| 17 | Artesanía / hecho a mano | `artesania-hecho-a-mano` | `tienda`: catalog, productos, WhatsApp | `historia`: feature, álbum, redes | No: tienda |
| 18 | Academia deportiva | `academia-deportiva` | `horarios`: events, mapa | `inscripciones`: pricing, booking, FAQ | Sí: noticias para familias |
| 19 | Spa / bienestar | `spa-bienestar` | `tratamientos`: servicios, reseñas | `reservas`: booking, mapa, FAQ | No: servicio |
| 21 | Cerrajero / gásfiter / electricista | `servicio-tecnico-domicilio` | `servicios`: servicios, reseñas | `cobertura`: WhatsApp, mapa (zona), FAQ | No: oficio |
| 22 | Freelancer de diseño o desarrollo | `freelancer-diseno` | `proyectos`: vitrina en grilla, reseñas | `paquetes`: pricing, WhatsApp, contacto | No: servicio |
| 23 | Tienda de moda | `tienda-moda` | `tienda`: catalog, mapa, WhatsApp | `colecciones`: álbum por temporada | No: tienda |
| 24 | Chef privado / catering | `chef-catering` | `menus`: pricing (por invitados), catalog, galería **esfera 3D** | `reservas`: booking, pasos, FAQ | No: servicio |
| 25 | Peluquería / maquillaje a domicilio | `belleza-domicilio` | `servicios`: servicios, álbum | `reservas`: booking, mapa (cobertura), FAQ | No: servicio |
| 26 | Yoga y meditación | `yoga-meditacion` | `clases`: events, pricing, booking | `comunidad`: reseñas, feature, subscribe | Sí: comunidad de práctica |
| 27 | Estudio de tatuajes | `estudio-tatuajes` | `portafolio`: galería **esfera 3D**, álbum con filtros por estilo | `reservas`: booking, FAQ (cuidados, precios), mapa | No: servicio |
| 28 | Taller mecánico | `taller-mecanico` | `servicios`: servicios, reseñas | `reservas`: booking, mapa, FAQ | No: servicio |
| 29 | Corredor de seguros | `corredor-seguros` | `seguros`: 4 servicios | `asesoria`: booking, FAQ, contacto | No: servicio |
| 30 | Consultor de negocios | `consultor-negocios` | `programas`: pricing, pasos, reseñas | `sesion`: booking, feature, contacto | No: servicio |

## Decisiones y lo que no se hizo con bloques existentes

- **Rubros 15 (restaurante con delivery) y 20 (agencia de viajes):** ya los cubren `restaurante-menu`/`cafe-gastronomia` y
  `eventos-turismo`; no se duplicaron. Los cupos sugeridos para reasignarlos (rubros 28, 29 y 30) ya estaban en la lista, por eso
  son 28 plantillas nuevas y no 30. Rubro 1 sí se creó: `belleza-barberia` no tiene página de profesionales y ya usa sus 2 páginas.
- **Máximo 2 páginas internas por plantilla** (no 4): lo fija el esquema por el límite del plan Gratis.
- **Confirmación de asistencia (evento único):** no hay bloque de RSVP; se usa WhatsApp, como indicaba el prompt.
- **Planes reales de membresía (rubro 5):** una plantilla no puede traer planes de una organización; muestra un `pricing` de
  ejemplo y el botón `subscribe` a la página de suscripción, donde el negocio configura sus planes reales.
- **Calificación de testimonios:** las reseñas de ejemplo van con 5★ (`rating`); el promedio lo calcula el bloque.
- **Industrias:** las 28 caben en `TEMPLATE_INDUSTRIES` existentes; no se agregó ninguna.
