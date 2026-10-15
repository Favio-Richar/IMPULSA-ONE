import type { TemplateDefinition } from "./index.js";
import {
  album,
  booking,
  contactActions,
  engagement,
  faq,
  feature,
  header,
  map,
  music,
  newsletter,
  profile,
  PROMISE,
  service,
  showcase,
  social,
  stats,
  steps,
  subscribe,
  testimonials,
  text,
  video,
  whatsapp,
} from "./portal-content.js";
import { eventsTo, go, portalTemplate, pricingTo, shop, sphere } from "./portal-extra-helpers.js";

// Plantillas del editor de portales — tanda 1: barbería con equipo, creadores (streaming, video corto, YouTube, suscripción),
// docencia, fotografía de bodas, música y podcast, y coaching. Suscripción solo donde el rubro vive de una comunidad.

export const PORTAL_TEMPLATES_CREADORES: TemplateDefinition[] = [
  // 1 · Barbería y estética masculina (con página de profesionales; `belleza-barberia` no la tiene)
  portalTemplate(
    {
      code: "barberia-equipo",
      name: "Barbería con equipo",
      description: "Para barberías con varios profesionales: cada barbero con su especialidad, cortes con precio, reservas y ubicación.",
      industryTags: ["barberia-estetica", "belleza-bienestar"],
      objectiveTags: ["reservar", "captar"],
      themeCode: "ejecutivo-grafito",
      family: "ejecutivo",
      sortOrder: 200,
    },
    [
      profile("Tu Barbería", "Cortes, barba y estética masculina", `${PROMISE} Tu estilo, tu equipo y tu horario.`, { key: "barber", alt: "barbero afeitando a un cliente" }, "banner"),
      engagement(),
      go("Reserva tu hora", "reservas", "Elige corte, profesional y horario", true),
      showcase("Conoce la barbería", [
        { title: "Nuestro equipo", subtitle: "Cada barbero y su especialidad", badge: "3 profesionales", photo: "manPortrait", alt: "retrato de un barbero", page: "equipo" },
        { title: "Cortes y precios", subtitle: "Reserva en línea en un minuto", photo: "barber", alt: "barbero trabajando", page: "reservas" },
      ]),
      stats([["+3.000", "cortes al año"], ["4,9", "nota promedio"], ["15 min", "de espera máxima"]]),
      testimonials([["El mejor degradado que me han hecho, y puntuales. Reseña de ejemplo.", "Cliente de ejemplo"]]),
      social(["instagram", "tiktok"]),
    ],
    [
      {
        slug: "equipo",
        blocks: [
          header("Equipo", "Elige a tu barbero", "Cada profesional con su especialidad. Nombres y fotos de ejemplo: reemplázalos por tu equipo."),
          showcase(
            "Profesionales",
            [
              { title: "Tu barbero 1", subtitle: "Degradados y diseños", badge: "Fade", photo: "manPortrait", alt: "retrato de barbero", page: "reservas" },
              { title: "Tu barbero 2", subtitle: "Barba clásica y toalla caliente", badge: "Barba", photo: "manSmile", alt: "barbero sonriendo", page: "reservas" },
              { title: "Tu barbero 3", subtitle: "Cortes clásicos y tijera", badge: "Clásico", photo: "manDark", alt: "barbero de perfil", page: "reservas" },
            ],
            "grid",
          ),
          testimonials([
            ["Siempre salgo igual a la foto que le muestro. Reseña de ejemplo.", "Cliente de ejemplo"],
            ["La barba quedó perfecta. Reseña de ejemplo.", "Otro cliente de ejemplo"],
          ]),
          whatsapp("Pregunta por WhatsApp", "Hola, quiero preguntar por un barbero."),
        ],
      },
      {
        slug: "reservas",
        blocks: [
          header("Reservas", "Cortes, barba y precios", "Precios de ejemplo: ajústalos a los tuyos."),
          booking("Reservar mi hora"),
          service("Corte clásico (ejemplo)", "Lavado, corte y peinado.", 12000, "Reservar", "reservas"),
          service("Corte + barba (ejemplo)", "Corte completo y perfilado de barba con toalla caliente.", 18000, "Reservar", "reservas"),
          service("Diseño y degradado (ejemplo)", "Degradado a máquina con diseño.", 15000, "Reservar", "reservas"),
          map("Av. Providencia 1234, Providencia, Santiago", "La barbería (ejemplo)", "Lunes a sábado, de 10:00 a 20:00."),
          faq([["¿Atienden sin hora?", "Respuesta de ejemplo: sí, si hay espacio; con hora no esperas."], ["¿Cómo cancelo?", "Respuesta de ejemplo: desde el enlace de tu confirmación, hasta 2 horas antes."]]),
        ],
      },
    ],
  ),

  // 2 · Streaming y gaming
  portalTemplate(
    {
      code: "streaming-gaming",
      name: "Streaming y gaming",
      description: "Para streamers y gamers: horario de directos, formas de apoyarte, merch y tus redes, sobre fondo oscuro.",
      industryTags: ["streaming", "creador"],
      objectiveTags: ["fidelizar", "donaciones", "compartir"],
      themeCode: "oscuro-indigo",
      family: "oscuro",
      sortOrder: 210,
    },
    [
      profile("Tu Nombre Gamer", "Directos de estrategia, risas y comunidad", `${PROMISE} Qué juegas, cuándo transmites y cómo es tu comunidad.`, { key: "streamer", alt: "streamer frente a su micrófono y pantallas" }),
      engagement(),
      go("Horario de directos", "horarios", "Te avisamos antes de cada stream", true),
      subscribe("Únete a la comunidad", "Directos exclusivos y sorteos"),
      showcase(
        "Explora",
        [
          { title: "Próximos directos", subtitle: "Juegos, horarios y eventos especiales", photo: "gamingSetup", alt: "escritorio gamer con luces", page: "horarios" },
          { title: "Apóyame", subtitle: "Niveles de apoyo y merch oficial", photo: "gamingPad", alt: "control de videojuegos", page: "apoyo" },
        ],
        "grid",
      ),
      stats([["+12 mil", "seguidores"], ["4 días", "de directo a la semana"], ["+300", "horas este año"]]),
      social(["youtube", "tiktok", "instagram"]),
    ],
    [
      {
        slug: "horarios",
        blocks: [
          header("Directos", "Horario de streams", "Fechas y juegos de ejemplo: actualízalos cada semana."),
          eventsTo("apoyo", "Esta semana", [
            { name: "Noche de estrategia (ejemplo)", start: "2026-12-01T21:00", venue: "En directo", description: "Partidas largas con la comunidad.", label: "Apoyar el stream" },
            { name: "Torneo de la comunidad (ejemplo)", start: "2026-12-03T20:00", venue: "En directo", description: "Inscripciones abiertas en el chat.", label: "Apoyar el stream" },
            { name: "Domingo relajado (ejemplo)", start: "2026-12-06T18:00", venue: "En directo", description: "Juegos indie y conversación.", label: "Apoyar el stream" },
          ]),
          video("Mejores momentos (ejemplo)"),
          faq([["¿Dónde transmites?", "Respuesta de ejemplo: en tu plataforma de directos favorita; los enlaces están en el inicio."], ["¿Cómo participo en los torneos?", "Respuesta de ejemplo: escribe «!torneo» en el chat durante el directo."]]),
          go("Apoya el stream", "apoyo", "Niveles de apoyo y merch"),
        ],
      },
      {
        slug: "apoyo",
        blocks: [
          header("Apóyame", "Ayuda a que el stream siga creciendo", "Niveles de apoyo y productos de ejemplo."),
          pricingTo("apoyo", "Niveles de apoyo", [
            { name: "Fan", price: 2000, period: "month", description: "Para darle una mano al canal.", features: ["Emotes exclusivos", "Nombre en los créditos"], cta: "Quiero apoyar" },
            { name: "Leyenda", price: 5000, period: "month", description: "El favorito de la comunidad.", features: ["Todo lo anterior", "Directos solo para miembros", "Sorteos mensuales"], badge: "Más elegido", highlighted: true, cta: "Quiero apoyar" },
          ]),
          subscribe("Suscríbete", "Directos exclusivos y sorteos"),
          shop("Merch oficial"),
        ],
      },
    ],
  ),

  // 3 · Creador de video corto (TikTok/Reels)
  portalTemplate(
    {
      code: "video-corto-creador",
      name: "Creador de video corto",
      description: "Para creadores de video vertical: tus colecciones de contenido, colaboraciones con marcas y contenido exclusivo.",
      industryTags: ["tiktok-video-corto", "creador"],
      objectiveTags: ["compartir", "fidelizar", "captar"],
      themeCode: "oscuro-ciruela",
      family: "oscuro",
      sortOrder: 220,
    },
    [
      profile("Tu Nombre", "Videos cortos de humor, viajes y vida diaria", `${PROMISE} De qué tratan tus videos y por qué seguirte.`, { key: "filming", alt: "persona grabando con su teléfono" }),
      engagement(),
      go("Mis colecciones", "colecciones", "Series y formatos favoritos", true),
      subscribe("Contenido exclusivo", "Lo que no publico en redes"),
      showcase(
        "Lo más visto",
        [
          { title: "Series", subtitle: "Formatos que se repiten cada semana", badge: "Nuevo", photo: "filming", alt: "grabación de video vertical", page: "colecciones" },
          { title: "Exclusivo", subtitle: "Detrás de cámara y adelantos", photo: "camera", alt: "cámara profesional", page: "exclusivo" },
        ],
        "grid",
      ),
      social(["tiktok", "instagram", "youtube"]),
    ],
    [
      {
        slug: "colecciones",
        blocks: [
          header("Colecciones", "Mis series de contenido", "Formatos de ejemplo: cámbialos por los tuyos."),
          showcase(
            "Series",
            [
              { title: "Un día en…", subtitle: "Ciudades contadas en 60 segundos", badge: "24 videos", photo: "city", alt: "ciudad al atardecer", page: "exclusivo" },
              { title: "Recetas rápidas", subtitle: "Platos en menos de 10 minutos", badge: "18 videos", photo: "cooking", alt: "manos cocinando", page: "exclusivo" },
              { title: "Detrás de cámara", subtitle: "Cómo grabo y edito", badge: "9 videos", photo: "camera", alt: "cámara sobre una mesa", page: "exclusivo" },
            ],
            "index",
          ),
          feature("filming", "grabación de un video corto", "Colaboraciones", "Trabajemos juntos", "<p>Texto de ejemplo: cuéntales a las marcas qué tipo de campañas haces y tus cifras de alcance.</p>", "right", { label: "Ver contenido exclusivo", page: "exclusivo" }),
          go("Ver el contenido exclusivo", "exclusivo", "Planes desde $3.000 al mes (ejemplo)"),
        ],
      },
      {
        slug: "exclusivo",
        blocks: [
          header("Exclusivo", "Lo que no publico en redes", "Planes de ejemplo."),
          pricingTo("exclusivo", "Únete", [
            { name: "Mensual", price: 3000, period: "month", description: "Acceso a todo el contenido exclusivo.", features: ["Videos sin cortes", "Adelantos de cada serie"], highlighted: true, cta: "Suscribirme" },
            { name: "Anual", price: 30000, period: "year", description: "Dos meses de regalo.", features: ["Todo lo mensual", "Saludo personalizado"], cta: "Suscribirme" },
          ]),
          subscribe("Suscríbete", "Acceso inmediato"),
          faq([["¿Puedo cancelar cuando quiera?", "Respuesta de ejemplo: sí, desde tu correo de suscripción."]]),
          go("Volver a las colecciones", "colecciones"),
        ],
      },
    ],
  ),

  // 4 · YouTuber y creador de video
  portalTemplate(
    {
      code: "youtuber-canal",
      name: "Canal de video",
      description: "Para YouTubers y creadores de video largo: tus videos y series, patrocinios y colaboraciones, y tu comunidad.",
      industryTags: ["youtube", "creador"],
      objectiveTags: ["compartir", "captar", "fidelizar"],
      themeCode: "vibrante-violeta",
      family: "vibrante",
      sortOrder: 230,
    },
    [
      profile("Tu Canal", "Videos de tecnología explicados sin rodeos", `${PROMISE} De qué trata tu canal y cada cuánto publicas.`, { key: "camera", alt: "cámara de video" }, "banner"),
      engagement(),
      go("Ver mis videos", "videos", "Series y lo más visto", true),
      subscribe("Únete a los miembros", "Videos anticipados y comunidad"),
      showcase("Explora el canal", [
        { title: "Videos y series", subtitle: "Lo más visto y lo último", photo: "filming", alt: "creador grabando", page: "videos" },
        { title: "Marcas y colaboraciones", subtitle: "Paquetes de patrocinio", photo: "meeting", alt: "reunión de trabajo", page: "colaboraciones" },
      ]),
      stats([["+85 mil", "suscriptores"], ["2 videos", "por semana"], ["+6 M", "de vistas"]]),
      social(["youtube", "instagram", "tiktok"]),
    ],
    [
      {
        slug: "videos",
        blocks: [
          header("Videos", "Lo más visto del canal", "Videos de ejemplo: cámbialos por los tuyos."),
          video("Último video (ejemplo)"),
          showcase(
            "Series del canal",
            [
              { title: "Reseñas honestas", subtitle: "Probamos antes de recomendar", badge: "32 episodios", photo: "laptopCode", alt: "computador portátil", page: "colaboraciones" },
              { title: "Tutoriales", subtitle: "Paso a paso y sin rodeos", badge: "21 episodios", photo: "designDesk", alt: "escritorio de trabajo", page: "colaboraciones" },
            ],
            "grid",
          ),
          newsletter("Aviso de cada video nuevo", "Déjanos tu correo y te avisamos cuando salga un video.", "Avísame"),
        ],
      },
      {
        slug: "colaboraciones",
        blocks: [
          header("Colaboraciones", "Trabajemos juntos", "Paquetes de patrocinio de ejemplo."),
          stats([["68 %", "audiencia de 18 a 34 años"], ["9 %", "tasa de interacción"], ["Chile", "país principal"]], "Audiencia (ejemplo)"),
          pricingTo("colaboraciones", "Paquetes", [
            { name: "Mención", price: 250000, period: "once", description: "Mención de 60 segundos en un video.", features: ["Enlace en la descripción"], cta: "Cotizar" },
            { name: "Video dedicado", price: 900000, period: "once", description: "Un video completo sobre tu producto.", features: ["Guion aprobado por tu marca", "Publicación en redes"], highlighted: true, badge: "Recomendado", cta: "Cotizar" },
          ]),
          whatsapp("Escribir por WhatsApp", "Hola, quiero cotizar una colaboración."),
          contactActions(),
        ],
      },
    ],
  ),

  // 5 · Creador de contenido por suscripción
  portalTemplate(
    {
      code: "contenido-suscripcion",
      name: "Contenido por suscripción",
      description: "Para quien vive de su comunidad: planes de suscripción, una vista previa del contenido y preguntas frecuentes.",
      industryTags: ["contenido-suscripcion", "creador"],
      objectiveTags: ["fidelizar", "vender"],
      themeCode: "oscuro-atelier",
      family: "oscuro",
      sortOrder: 240,
    },
    [
      profile("Tu Nombre", "Contenido exclusivo para mi comunidad", `${PROMISE} Qué publicas, cada cuánto y qué recibe quien se suscribe.`, undefined, "cutout"),
      engagement(),
      go("Ver los planes", "planes", "Elige cómo acompañarme", true),
      subscribe("Suscribirme", "Acceso inmediato al contenido"),
      showcase("Antes de suscribirte", [
        { title: "Planes", subtitle: "Precios claros, cancelas cuando quieras", photo: "pinkWall", alt: "retrato frente a una pared rosada", page: "planes" },
        { title: "Un adelanto", subtitle: "Mira el estilo del contenido", photo: "portraitWoman", alt: "retrato editorial", page: "adelanto" },
      ]),
      testimonials([["Vale cada peso: contenido nuevo todas las semanas. Reseña de ejemplo.", "Suscriptora de ejemplo"]]),
      social(["instagram", "tiktok"]),
    ],
    [
      {
        slug: "planes",
        blocks: [
          header("Planes", "Elige tu plan", "Planes de ejemplo: los reales los configuras en Suscripciones."),
          pricingTo("planes", "Suscripción", [
            { name: "Básico", price: 4990, period: "month", description: "Todo el contenido nuevo.", features: ["Publicaciones semanales", "Comunidad privada"], cta: "Elegir" },
            { name: "Completo", price: 9990, period: "month", description: "La experiencia completa.", features: ["Todo lo básico", "Archivo completo", "Mensajes directos"], badge: "Más elegido", highlighted: true, cta: "Elegir" },
          ]),
          subscribe("Suscribirme", "Pago seguro, cancelas cuando quieras"),
          faq([
            ["¿Cómo cancelo?", "Respuesta de ejemplo: desde el enlace de tu correo de suscripción, cuando quieras."],
            ["¿Qué medios de pago aceptas?", "Respuesta de ejemplo: tarjetas de débito y crédito."],
            ["¿El contenido se puede descargar?", "Respuesta de ejemplo: no, es solo para ver dentro de la página."],
          ]),
          go("Mira un adelanto", "adelanto"),
        ],
      },
      {
        slug: "adelanto",
        blocks: [
          header("Adelanto", "Así es el contenido", "Fotos de ejemplo: muestra tu estilo sin regalar lo exclusivo."),
          sphere([
            ["portraitWoman", "retrato editorial"],
            ["pinkWall", "retrato frente a pared rosada"],
            ["womanSmile", "mujer sonriendo"],
            ["whiteDress", "vestido blanco"],
            ["sunglasses", "persona con lentes de sol"],
            ["redSmile", "sonrisa con labial rojo"],
          ]),
          text("<p>Texto de ejemplo: cuenta qué encontrará cada persona al suscribirse y con qué frecuencia publicas.</p>"),
          subscribe("Quiero ver todo", "Acceso inmediato"),
          go("Comparar los planes", "planes"),
        ],
      },
    ],
  ),

  // 6 · Docencia y clases particulares
  portalTemplate(
    {
      code: "clases-particulares",
      name: "Clases particulares",
      description: "Para docentes y tutores: ramos y precios, horarios disponibles, reservas de clase y testimonios de alumnos.",
      industryTags: ["docencia", "educacion"],
      objectiveTags: ["reservar", "educar", "captar"],
      themeCode: "claro-profesional",
      family: "clasico",
      sortOrder: 250,
    },
    [
      profile("Tu Nombre, Docente", "Clases de matemática y física para escolares y universitarios", `${PROMISE} Tu formación, tu método y a quién enseñas.`, { key: "classroom", alt: "sala de clases" }, "banner"),
      engagement(),
      go("Reserva tu clase", "reservar", "Presencial u online", true),
      subscribe("Material gratuito", "Guías y ejercicios cada semana"),
      showcase("Cómo te ayudo", [
        { title: "Ramos y horarios", subtitle: "Precios por clase y por paquete", photo: "study", alt: "cuadernos y lápices", page: "clases" },
        { title: "Reserva", subtitle: "Elige día y hora en un minuto", photo: "classroom", alt: "sala de clases", page: "reservar" },
      ]),
      stats([["+400", "alumnos"], ["98 %", "aprueba su ramo"], ["10 años", "enseñando"]]),
      testimonials([["Pasé de un 3,5 a un 6,2 en un semestre. Reseña de ejemplo.", "Alumno de ejemplo"]]),
      social(["instagram", "youtube"]),
    ],
    [
      {
        slug: "clases",
        blocks: [
          header("Clases", "Ramos, precios y horarios", "Valores y horarios de ejemplo."),
          service("Matemática escolar (ejemplo)", "Clase de 60 minutos, presencial u online.", 15000, "Reservar", "reservar"),
          service("Cálculo universitario (ejemplo)", "Clase de 90 minutos con ejercicios resueltos.", 22000, "Reservar", "reservar"),
          service("Preparación de prueba (ejemplo)", "Paquete de 4 clases antes de tu examen.", 70000, "Reservar", "reservar"),
          eventsTo("reservar", "Talleres grupales", [
            { name: "Repaso intensivo (ejemplo)", start: "2026-12-05T10:00", venue: "Online", description: "Dos horas de ejercicios tipo prueba.", label: "Reservar cupo" },
            { name: "Técnicas de estudio (ejemplo)", start: "2026-12-12T11:00", venue: "Online", description: "Cómo organizar tu semana de estudio.", label: "Reservar cupo" },
          ]),
          testimonials([
            ["Explica con paciencia y ejemplos claros. Reseña de ejemplo.", "Apoderada de ejemplo"],
            ["Por fin entendí derivadas. Reseña de ejemplo.", "Estudiante de ejemplo"],
          ]),
        ],
      },
      {
        slug: "reservar",
        blocks: [
          header("Reservar", "Agenda tu clase", "Elige el servicio y el horario que te acomode."),
          booking("Reservar clase"),
          steps("Cómo funciona", [
            ["Reserva", "Eliges día y hora disponibles."],
            ["Cuéntame tu objetivo", "Me envías la materia o la prueba que preparas."],
            ["Clase", "Nos vemos presencial u online."],
          ]),
          faq([["¿Hacen clases online?", "Respuesta de ejemplo: sí, por videollamada con pizarra compartida."], ["¿Puedo cambiar la hora?", "Respuesta de ejemplo: sí, hasta 12 horas antes."]]),
          contactActions(),
        ],
      },
    ],
  ),

  // 7 · Fotografía y video de bodas y eventos
  portalTemplate(
    {
      code: "fotografia-bodas",
      name: "Fotografía de bodas y eventos",
      description: "Para fotógrafos y videógrafos de bodas: portafolio por categoría, paquetes con precio, reservas de sesión y testimonios.",
      industryTags: ["fotografia-video", "eventos"],
      objectiveTags: ["mostrar", "reservar", "captar"],
      themeCode: "minimal-perla",
      family: "minimal",
      sortOrder: 260,
    },
    [
      profile("Tu Estudio de Fotografía", "Bodas, eventos y retratos con mirada documental", `${PROMISE} Tu estilo y cómo acompañas a cada pareja.`, { key: "wedding", alt: "pareja de novios" }),
      engagement(),
      go("Agenda tu sesión", "reservas", "Consulta disponibilidad para tu fecha", true),
      showcase(
        "Portafolio",
        [
          { title: "Bodas", subtitle: "Historias completas, de la preparación a la fiesta", badge: "2026", photo: "wedding", alt: "novios abrazados", page: "portafolio" },
          { title: "Eventos", subtitle: "Cumpleaños, lanzamientos y celebraciones", badge: "2025", photo: "party", alt: "celebración con luces", page: "portafolio" },
          { title: "Retratos", subtitle: "Sesiones individuales y en pareja", badge: "2025", photo: "womanOutdoor", alt: "retrato al aire libre", page: "portafolio" },
        ],
        "index",
      ),
      testimonials([["Revivimos la boda cada vez que vemos las fotos. Reseña de ejemplo.", "Pareja de ejemplo"]]),
      social(["instagram", "facebook"]),
    ],
    [
      {
        slug: "portafolio",
        blocks: [
          header("Portafolio", "Historias reales", "Fotos de ejemplo: reemplázalas por tus trabajos."),
          album("Trabajos recientes", "Filtra por categoría.", [
            ["wedding", "novios abrazados", "Boda en el campo", "Bodas"],
            ["weddingRings", "anillos de boda", "Detalles", "Bodas"],
            ["party", "fiesta con luces", "Cumpleaños 30", "Eventos"],
            ["festival", "público en un evento", "Lanzamiento", "Eventos"],
            ["womanOutdoor", "retrato al aire libre", "Sesión de otoño", "Retratos"],
            ["manPortrait", "retrato masculino", "Retrato corporativo", "Retratos"],
          ]),
          testimonials([
            ["Nos sentimos cómodos todo el día. Reseña de ejemplo.", "Pareja de ejemplo"],
            ["Entregó antes de lo prometido. Reseña de ejemplo.", "Cliente de ejemplo"],
          ]),
          go("Ver paquetes y reservar", "reservas"),
        ],
      },
      {
        slug: "reservas",
        blocks: [
          header("Paquetes", "Paquetes y reservas", "Precios de ejemplo."),
          pricingTo("reservas", "Paquetes", [
            { name: "Civil", price: 450000, period: "once", description: "Ceremonia civil y sesión de pareja.", features: ["4 horas de cobertura", "150 fotos editadas"], cta: "Consultar fecha" },
            { name: "Boda completa", price: 1200000, period: "once", description: "Del vestido a la fiesta.", features: ["10 horas de cobertura", "500 fotos editadas", "Video resumen"], badge: "Más elegido", highlighted: true, cta: "Consultar fecha" },
          ]),
          booking("Reservar reunión"),
          faq([["¿Viajas a otras ciudades?", "Respuesta de ejemplo: sí, con viático según destino."], ["¿Cuándo entregas las fotos?", "Respuesta de ejemplo: en 4 a 6 semanas, en una galería privada."]]),
        ],
      },
    ],
  ),

  // 8 · Música y podcast
  portalTemplate(
    {
      code: "musica-podcast",
      name: "Música y podcast",
      description: "Para músicos y podcasters: episodios o canciones destacadas en un índice con portada, próximas fechas y redes.",
      industryTags: ["musica-podcast", "creador"],
      objectiveTags: ["compartir", "fidelizar", "mostrar"],
      themeCode: "oscuro-noche",
      family: "oscuro",
      sortOrder: 270,
    },
    [
      profile("Tu Podcast", "Conversaciones sobre música, cultura y creatividad", `${PROMISE} De qué hablas y cada cuánto sale un episodio.`, { key: "podcast", alt: "estudio de podcast con micrófonos" }),
      engagement(),
      go("Escucha el último episodio", "episodios", "Nuevo cada jueves", true),
      subscribe("Únete al club", "Episodios extra y adelantos"),
      showcase(
        "Discografía y episodios",
        [
          { title: "Ep. 48 · Hacer música en casa", subtitle: "Con invitada de ejemplo", badge: "2026", photo: "microphone", alt: "micrófono de estudio", page: "episodios" },
          { title: "Ep. 47 · Giras pequeñas", subtitle: "Con invitado de ejemplo", badge: "2026", photo: "concertOrange", alt: "concierto con luces", page: "episodios" },
          { title: "Sencillo · Ciudad nocturna", subtitle: "Lanzamiento de ejemplo", badge: "2025", photo: "guitars", alt: "guitarras colgadas", page: "episodios" },
          { title: "En vivo · Sesión acústica", subtitle: "Grabación de ejemplo", badge: "2025", photo: "performer", alt: "músico en escenario", page: "fechas" },
        ],
        "index",
      ),
      social(["spotify", "youtube", "instagram"]),
    ],
    [
      {
        slug: "episodios",
        blocks: [
          header("Escuchar", "Episodios y canciones", "Contenido de ejemplo: enlaza tus episodios reales."),
          music("Último lanzamiento (ejemplo)"),
          video("Episodio en video (ejemplo)"),
          newsletter("Aviso de cada episodio", "Te escribimos cuando salga uno nuevo.", "Avísame"),
        ],
      },
      {
        slug: "fechas",
        blocks: [
          header("En vivo", "Próximas fechas", "Fechas y lugares de ejemplo."),
          eventsTo("fechas", "Agenda", [
            { name: "Grabación en vivo (ejemplo)", start: "2026-12-10T20:30", venue: "Sala de ejemplo, Santiago", description: "Episodio con público.", label: "Más información" },
            { name: "Sesión acústica (ejemplo)", start: "2026-12-18T21:00", venue: "Bar de ejemplo, Valparaíso", description: "Canciones y conversación.", label: "Más información" },
          ]),
          whatsapp("Contrataciones", "Hola, quiero contratar una presentación."),
          contactActions(),
        ],
      },
    ],
  ),

  // 9 · Fitness y coaching personal
  portalTemplate(
    {
      code: "coaching-fitness",
      name: "Coaching de fitness",
      description: "Para entrenadores personales y coaches: planes con precio, reservas de sesión y testimonios con calificación.",
      industryTags: ["fitness-coaching", "salud"],
      objectiveTags: ["reservar", "vender", "fidelizar"],
      themeCode: "vibrante-coral",
      family: "vibrante",
      sortOrder: 280,
    },
    [
      profile("Tu Nombre, Coach", "Entrenamiento personalizado y nutrición", `${PROMISE} Tu enfoque y tus certificaciones.`, { key: "gym", alt: "gimnasio con pesas" }),
      engagement(),
      go("Reserva tu sesión", "reservas", "Primera evaluación sin costo", true),
      subscribe("Rutinas semanales", "Plan online y comunidad"),
      showcase("Entrena conmigo", [
        { title: "Planes", subtitle: "Presencial, online o híbrido", photo: "barbell", alt: "persona levantando una barra", page: "planes" },
        { title: "Reservas", subtitle: "Elige tu horario", photo: "exercise", alt: "persona entrenando", page: "reservas" },
      ]),
      stats([["+150", "alumnos"], ["-8 kg", "promedio en 12 semanas"], ["5,0", "en reseñas"]]),
      social(["instagram", "youtube", "tiktok"]),
    ],
    [
      {
        slug: "planes",
        blocks: [
          header("Planes", "Elige tu plan", "Planes y precios de ejemplo."),
          pricingTo("reservas", "Planes mensuales", [
            { name: "Online", price: 39990, period: "month", description: "Rutina y seguimiento por app.", features: ["Rutina personalizada", "Revisión semanal"], cta: "Empezar" },
            { name: "Presencial", price: 89990, period: "month", description: "Dos sesiones por semana.", features: ["8 sesiones al mes", "Plan de alimentación"], badge: "Más elegido", highlighted: true, cta: "Empezar" },
          ]),
          testimonials([
            ["Bajé 10 kilos y gané fuerza. Reseña de ejemplo.", "Alumna de ejemplo"],
            ["Me cambió la forma de entrenar. Reseña de ejemplo.", "Alumno de ejemplo"],
          ]),
          steps("Cómo empezamos", [
            ["Evaluación", "Medimos tu punto de partida."],
            ["Plan", "Diseño tu rutina y alimentación."],
            ["Seguimiento", "Ajustamos cada semana."],
          ]),
          go("Reserva tu primera sesión", "reservas"),
        ],
      },
      {
        slug: "reservas",
        blocks: [
          header("Reservas", "Agenda tu sesión", "La primera evaluación es sin costo (ejemplo)."),
          booking("Reservar sesión"),
          map("Av. Las Condes 9000, Las Condes, Santiago", "Gimnasio (ejemplo)", "Lunes a sábado, de 07:00 a 21:00."),
          faq([["¿Necesito experiencia?", "Respuesta de ejemplo: no, adaptamos el plan a tu nivel."]]),
        ],
      },
    ],
  ),
];
