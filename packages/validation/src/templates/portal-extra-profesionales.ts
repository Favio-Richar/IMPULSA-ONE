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
  profile,
  PROMISE,
  service,
  serviceInfo,
  showcase,
  social,
  stats,
  steps,
  subscribe,
  testimonials,
  text,
  whatsapp,
} from "./portal-content.js";
import { countdown, eventsTo, go, portalTemplate, pricingTo, shop, sphere } from "./portal-extra-helpers.js";

// Plantillas del editor de portales — tanda 2: profesionales, salud, inmobiliaria, evento único, artesanía, deporte, spa y
// servicio técnico. Son negocios de servicio: vistas y «me gusta» sí, botón «Suscribirme» solo en la academia deportiva
// (familias que siguen al equipo).

export const PORTAL_TEMPLATES_PROFESIONALES: TemplateDefinition[] = [
  // 10 · Abogado o estudio jurídico
  portalTemplate(
    {
      code: "estudio-juridico",
      name: "Estudio jurídico",
      description: "Para abogados y estudios: áreas de práctica, reserva de consulta, preguntas frecuentes y ubicación, con un tema sobrio.",
      industryTags: ["profesional"],
      objectiveTags: ["captar", "reservar"],
      themeCode: "ejecutivo-marino",
      family: "ejecutivo",
      sortOrder: 300,
    },
    [
      profile("Tu Estudio Jurídico", "Derecho de familia, laboral y civil", `${PROMISE} Tu experiencia y cómo acompañas cada caso.`, { key: "lawLibrary", alt: "biblioteca de derecho" }, "banner"),
      engagement(),
      go("Agenda una consulta", "consulta", "Primera orientación de 30 minutos", true),
      showcase("Cómo podemos ayudarte", [
        { title: "Áreas de práctica", subtitle: "Familia, laboral, civil y empresas", photo: "lawGavel", alt: "mazo de juez", page: "areas" },
        { title: "Consulta", subtitle: "Presencial o por videollamada", photo: "office", alt: "oficina", page: "consulta" },
      ]),
      stats([["+20 años", "de ejercicio"], ["+900", "casos atendidos"], ["48 h", "para responder"]]),
      testimonials([["Me explicaron cada paso con claridad. Reseña de ejemplo.", "Cliente de ejemplo"]]),
      social(["linkedin"]),
    ],
    [
      {
        slug: "areas",
        blocks: [
          header("Áreas de práctica", "En qué te podemos ayudar", "Áreas y honorarios de ejemplo."),
          service("Derecho de familia (ejemplo)", "Divorcios, pensiones de alimentos y cuidado personal.", 60000, "Agendar consulta", "consulta"),
          service("Derecho laboral (ejemplo)", "Despidos, finiquitos y tutela de derechos.", 50000, "Agendar consulta", "consulta"),
          service("Derecho civil (ejemplo)", "Contratos, arriendos y cobranzas.", 50000, "Agendar consulta", "consulta"),
          service("Empresas (ejemplo)", "Constitución de sociedades y asesoría permanente.", 90000, "Agendar consulta", "consulta"),
          steps("Cómo trabajamos", [
            ["Orientación", "Escuchamos tu caso y te decimos tus opciones."],
            ["Propuesta", "Honorarios y plazos por escrito."],
            ["Acompañamiento", "Te informamos de cada avance."],
          ]),
        ],
      },
      {
        slug: "consulta",
        blocks: [
          header("Consulta", "Agenda tu orientación", "Información de ejemplo."),
          booking("Reservar consulta"),
          faq([
            ["¿La primera consulta tiene costo?", "Respuesta de ejemplo: la orientación inicial de 30 minutos es sin costo."],
            ["¿Atienden en regiones?", "Respuesta de ejemplo: sí, por videollamada."],
          ]),
          map("Huérfanos 1160, Santiago Centro", "Oficina (ejemplo)", "Lunes a viernes, de 09:00 a 18:00, con cita previa."),
          contactActions(),
        ],
      },
    ],
  ),

  // 11 · Contador o asesor financiero
  portalTemplate(
    {
      code: "asesor-financiero",
      name: "Contador y asesor financiero",
      description: "Para contadores y asesores: servicios, cifras que respaldan tu trabajo, reserva de consulta y contacto directo.",
      industryTags: ["profesional", "emprendimiento"],
      objectiveTags: ["captar", "reservar"],
      themeCode: "ejecutivo-grafito",
      family: "ejecutivo",
      sortOrder: 310,
    },
    [
      profile("Tu Nombre, Contador", "Contabilidad, impuestos y finanzas para pymes", `${PROMISE} A quién ayudas y cómo ordenas sus números.`, { key: "finance", alt: "calculadora y documentos financieros" }, "banner"),
      engagement(),
      go("Agenda una reunión", "consulta", "Diagnóstico inicial sin costo", true),
      showcase("Servicios", [
        { title: "Lo que hacemos", subtitle: "Contabilidad, impuestos y planificación", photo: "finance", alt: "documentos financieros", page: "servicios" },
        { title: "Reunión", subtitle: "Presencial u online", photo: "meeting", alt: "reunión de trabajo", page: "consulta" },
      ]),
      stats([["+180", "empresas"], ["0", "multas en 2025"], ["24 h", "de respuesta"]]),
      social(["linkedin", "instagram"]),
    ],
    [
      {
        slug: "servicios",
        blocks: [
          header("Servicios", "Números claros, a tiempo", "Servicios y valores de ejemplo."),
          service("Contabilidad mensual (ejemplo)", "Declaraciones, libros y balance.", 69990, "Consultar", "consulta"),
          service("Declaración de renta (ejemplo)", "Personas y empresas.", 45000, "Consultar", "consulta"),
          service("Planificación financiera (ejemplo)", "Presupuesto, flujo de caja e indicadores.", 120000, "Consultar", "consulta"),
          feature("finance", "documentos y calculadora", "Por qué elegirnos", "Te explicamos tus números", "<p>Texto de ejemplo: cuenta tu experiencia y certificaciones.</p>", "left", { label: "Agendar reunión", page: "consulta" }),
        ],
      },
      {
        slug: "consulta",
        blocks: [
          header("Consulta", "Agenda tu reunión", "Información de ejemplo."),
          booking("Reservar reunión"),
          contactActions(),
          faq([["¿Trabajan con empresas nuevas?", "Respuesta de ejemplo: sí, te ayudamos desde el inicio de actividades."]]),
        ],
      },
    ],
  ),

  // 12 · Clínica dental o estética
  portalTemplate(
    {
      code: "clinica-dental",
      name: "Clínica dental",
      description: "Para clínicas dentales y estéticas: tratamientos con precio, reservas, antes y después, testimonios y ubicación.",
      industryTags: ["salud", "belleza-bienestar"],
      objectiveTags: ["reservar", "captar"],
      themeCode: "oceano",
      family: "clasico",
      sortOrder: 320,
    },
    [
      profile("Tu Clínica Dental", "Odontología general, ortodoncia y estética", `${PROMISE} Tu equipo, tus especialidades y tu forma de atender.`, { key: "dentalClinic", alt: "sillón de una clínica dental" }, "banner"),
      engagement(),
      go("Reserva tu hora", "reservas", "Evaluación inicial", true),
      showcase("Tu sonrisa", [
        { title: "Tratamientos", subtitle: "Precios claros y antes y después", photo: "dentist", alt: "dentista atendiendo", page: "tratamientos" },
        { title: "Reservas y ubicación", subtitle: "Agenda en línea", photo: "dentalClinic", alt: "clínica dental", page: "reservas" },
      ]),
      testimonials([["Atención impecable y sin dolor. Reseña de ejemplo.", "Paciente de ejemplo"]]),
      social(["instagram", "facebook"]),
    ],
    [
      {
        slug: "tratamientos",
        blocks: [
          header("Tratamientos", "Lo que hacemos", "Valores de ejemplo, referenciales."),
          service("Limpieza dental (ejemplo)", "Destartraje y pulido.", 35000, "Reservar", "reservas"),
          service("Blanqueamiento (ejemplo)", "Dos sesiones en clínica.", 180000, "Reservar", "reservas"),
          service("Ortodoncia (ejemplo)", "Evaluación y plan de tratamiento.", 45000, "Reservar", "reservas"),
          album("Antes y después", "Casos de ejemplo (fotos referenciales).", [
            ["dentist", "atención dental", "Blanqueamiento", "Estética"],
            ["dentalClinic", "box de atención", "Ortodoncia", "Ortodoncia"],
            ["womanSmile", "sonrisa", "Diseño de sonrisa", "Estética"],
            ["redSmile", "sonrisa con labial", "Carillas", "Estética"],
          ]),
          testimonials([["Mi sonrisa cambió por completo. Reseña de ejemplo.", "Paciente de ejemplo"]]),
        ],
      },
      {
        slug: "reservas",
        blocks: [
          header("Reservas", "Agenda tu evaluación", "Información de ejemplo."),
          booking("Reservar hora"),
          map("Av. Apoquindo 4500, Las Condes, Santiago", "Clínica (ejemplo)", "Lunes a sábado, de 09:00 a 19:00."),
          faq([["¿Atienden con convenio?", "Respuesta de ejemplo: sí, consulta por tu previsión."], ["¿Hay urgencias?", "Respuesta de ejemplo: sí, en horario de atención."]]),
        ],
      },
    ],
  ),

  // 13 · Veterinaria
  portalTemplate(
    {
      code: "veterinaria",
      name: "Veterinaria",
      description: "Para clínicas veterinarias: servicios, reserva de horas, ubicación y preguntas frecuentes sobre vacunas y urgencias.",
      industryTags: ["salud", "servicios-locales"],
      objectiveTags: ["reservar", "captar"],
      themeCode: "natural",
      family: "clasico",
      sortOrder: 330,
    },
    [
      profile("Tu Veterinaria", "Medicina preventiva, cirugía y urgencias", `${PROMISE} Tu equipo y cómo cuidan a cada mascota.`, { key: "vetDog", alt: "veterinaria atendiendo a un perro" }, "banner"),
      engagement(),
      go("Reserva una hora", "reservas", "Consulta, vacunas y control", true),
      showcase("Cuidamos a tu mascota", [
        { title: "Servicios", subtitle: "Consulta, vacunas, cirugía y peluquería", photo: "dog", alt: "perro feliz", page: "servicios" },
        { title: "Reservas y urgencias", subtitle: "Ubicación y horarios", photo: "vetDog", alt: "control veterinario", page: "reservas" },
      ]),
      stats([["+5.000", "mascotas atendidas"], ["24/7", "urgencias (ejemplo)"], ["4,9", "en reseñas"]]),
      social(["instagram", "facebook"]),
    ],
    [
      {
        slug: "servicios",
        blocks: [
          header("Servicios", "Todo para su salud", "Valores de ejemplo."),
          service("Consulta general (ejemplo)", "Examen completo y orientación.", 20000, "Reservar", "reservas"),
          service("Vacunas (ejemplo)", "Plan de vacunación para perros y gatos.", 15000, "Reservar", "reservas"),
          service("Esterilización (ejemplo)", "Cirugía con control postoperatorio.", 90000, "Reservar", "reservas"),
          testimonials([["Trataron a mi gata con mucho cariño. Reseña de ejemplo.", "Tutora de ejemplo"]]),
        ],
      },
      {
        slug: "reservas",
        blocks: [
          header("Reservas", "Agenda o llega por urgencia", "Información de ejemplo."),
          booking("Reservar hora"),
          map("Av. Grecia 2200, Ñuñoa, Santiago", "Clínica (ejemplo)", "Urgencias las 24 horas (ejemplo)."),
          faq([
            ["¿Cuándo vacuno a mi cachorro?", "Respuesta de ejemplo: desde las 6 semanas, según el plan que indique el veterinario."],
            ["¿Qué hago en una urgencia?", "Respuesta de ejemplo: llámanos camino a la clínica; te esperamos."],
          ]),
          contactActions(),
        ],
      },
    ],
  ),

  // 14 · Inmobiliaria o corredor de propiedades
  portalTemplate(
    {
      code: "corredor-propiedades",
      name: "Corredor de propiedades",
      description: "Para inmobiliarias y corredores: propiedades destacadas, contacto directo por WhatsApp y ubicación de la oficina.",
      industryTags: ["profesional", "servicios-locales"],
      objectiveTags: ["vender", "captar"],
      themeCode: "minimal-niebla",
      family: "minimal",
      sortOrder: 340,
    },
    [
      profile("Tu Corretaje", "Venta y arriendo de propiedades", `${PROMISE} Tu zona, tu experiencia y cómo acompañas cada compra.`, { key: "modernHouse", alt: "casa moderna" }),
      engagement(),
      whatsapp("Consultar por WhatsApp", "Hola, quiero consultar por una propiedad."),
      showcase(
        "Propiedades destacadas",
        [
          { title: "Casa en condominio", subtitle: "4 dormitorios · 3 baños · Peñalolén", badge: "Venta", photo: "modernHouse", alt: "casa moderna", page: "propiedades" },
          { title: "Departamento luminoso", subtitle: "2 dormitorios · Providencia", badge: "Arriendo", photo: "houseInterior", alt: "living luminoso", page: "propiedades" },
        ],
        "grid",
      ),
      stats([["+300", "propiedades vendidas"], ["15 años", "en el rubro"], ["48 h", "para publicar"]]),
      social(["instagram", "facebook"]),
    ],
    [
      {
        slug: "propiedades",
        blocks: [
          header("Propiedades", "Encuentra tu próximo hogar", "Propiedades de ejemplo: cárgalas en tu catálogo."),
          shop("Ver propiedades"),
          showcase(
            "Destacadas",
            [
              { title: "Casa en condominio", subtitle: "UF 12.500 (ejemplo)", badge: "Venta", photo: "modernHouse", alt: "casa moderna", page: "oficina" },
              { title: "Departamento", subtitle: "$650.000 al mes (ejemplo)", badge: "Arriendo", photo: "houseInterior", alt: "interior de departamento", page: "oficina" },
              { title: "Llaves en mano", subtitle: "Te acompañamos en la firma", photo: "houseKeys", alt: "entrega de llaves", page: "oficina" },
            ],
            "index",
          ),
          whatsapp("Agendar una visita", "Hola, quiero agendar una visita a una propiedad."),
        ],
      },
      {
        slug: "oficina",
        blocks: [
          header("Oficina", "Visítanos o escríbenos", "Información de ejemplo."),
          whatsapp("Escribir por WhatsApp", "Hola, quiero vender o arrendar mi propiedad."),
          map("Av. Vitacura 3500, Vitacura, Santiago", "Oficina (ejemplo)", "Lunes a viernes, de 09:00 a 19:00."),
          steps("Vende con nosotros", [
            ["Tasación", "Visitamos y valorizamos tu propiedad."],
            ["Publicación", "Fotos profesionales y difusión."],
            ["Cierre", "Te acompañamos hasta la firma."],
          ]),
          contactActions(),
        ],
      },
    ],
  ),

  // 16 · Evento único (boda, cumpleaños, lanzamiento)
  portalTemplate(
    {
      code: "evento-unico",
      name: "Evento único",
      description: "Para una boda, un cumpleaños o un lanzamiento: cuenta regresiva, ubicación, confirmación de asistencia y galería de fotos.",
      industryTags: ["eventos"],
      objectiveTags: ["compartir", "captar"],
      themeCode: "minimal-arena",
      family: "minimal",
      sortOrder: 350,
    },
    [
      profile("Tu Evento", "Celebremos juntos el 12 de diciembre", `${PROMISE} Qué celebran y por qué quieren que estés.`, { key: "weddingRings", alt: "anillos de boda" }),
      engagement(),
      whatsapp("Confirmar asistencia", "Hola, confirmo mi asistencia al evento."),
      countdown("Falta poco", "2026-12-12T18:00", "Ver los detalles", "detalles"),
      showcase("Todo sobre el evento", [
        { title: "Detalles", subtitle: "Lugar, horario y código de vestimenta", photo: "party", alt: "celebración", page: "detalles" },
        { title: "Fotos", subtitle: "Recuerdos para compartir", photo: "wedding", alt: "pareja celebrando", page: "fotos" },
      ]),
      social(["instagram"]),
    ],
    [
      {
        slug: "detalles",
        blocks: [
          header("Detalles", "Lo que necesitas saber", "Información de ejemplo."),
          steps("Programa", [
            ["18:00 · Ceremonia", "En el jardín principal."],
            ["19:30 · Cóctel", "Música en vivo."],
            ["21:00 · Cena y fiesta", "Hasta que el cuerpo aguante."],
          ]),
          map("Camino a Farellones 1234, Lo Barnechea", "Lugar del evento (ejemplo)", "Estacionamiento en el recinto."),
          faq([["¿Hay código de vestimenta?", "Respuesta de ejemplo: formal de verano."], ["¿Puedo ir con acompañante?", "Respuesta de ejemplo: indícalo al confirmar."]]),
          whatsapp("Confirmar asistencia", "Hola, confirmo mi asistencia al evento."),
        ],
      },
      {
        slug: "fotos",
        blocks: [
          header("Fotos", "Nuestros momentos", "Fotos de ejemplo: después del evento, sube las de la celebración."),
          sphere([
            ["wedding", "pareja celebrando"],
            ["weddingRings", "anillos"],
            ["party", "fiesta con luces"],
            ["festival", "invitados bailando"],
            ["diners", "brindis en la mesa"],
            ["terrace", "terraza decorada"],
          ]),
          text("<p>Texto de ejemplo: invita a tus invitados a compartir sus fotos contigo.</p>"),
          whatsapp("Envíanos tus fotos", "Hola, quiero compartir fotos del evento."),
        ],
      },
    ],
  ),

  // 17 · Artesano o tienda de productos hechos a mano
  portalTemplate(
    {
      code: "artesania-hecho-a-mano",
      name: "Artesanía y hecho a mano",
      description: "Para artesanos y marcas de productos hechos a mano: catálogo, historia de la marca y redes.",
      industryTags: ["comercio", "emprendimiento"],
      objectiveTags: ["vender", "mostrar"],
      themeCode: "editorial",
      family: "clasico",
      background: { kind: "gradient", gradient: "arena" },
      sortOrder: 360,
    },
    [
      profile("Tu Taller", "Cerámica y objetos hechos a mano", `${PROMISE} Qué haces, con qué materiales y desde dónde.`, { key: "pottery", alt: "manos trabajando cerámica" }),
      engagement(),
      go("Ver el catálogo", "tienda", "Piezas únicas y por encargo", true),
      showcase("Del taller a tu casa", [
        { title: "Tienda", subtitle: "Piezas disponibles y por encargo", photo: "handmade", alt: "objetos hechos a mano", page: "tienda" },
        { title: "Nuestra historia", subtitle: "Cómo nace cada pieza", photo: "pottery", alt: "taller de cerámica", page: "historia" },
      ]),
      social(["instagram", "facebook", "tiktok"]),
    ],
    [
      {
        slug: "tienda",
        blocks: [
          header("Tienda", "Piezas hechas a mano", "Productos de ejemplo: cárgalos en tu catálogo."),
          shop("Comprar"),
          serviceInfo("Taza esmaltada (ejemplo)", "Cerámica de alta temperatura, apta para lavavajillas.", 14900),
          serviceInfo("Set de platos (ejemplo)", "Cuatro platos de distintos esmaltes.", 39900),
          whatsapp("Pedir por encargo", "Hola, quiero encargar una pieza."),
        ],
      },
      {
        slug: "historia",
        blocks: [
          header("Historia", "Hecho con las manos", "Texto de ejemplo."),
          feature("pottery", "torno de cerámica", "El taller", "Cada pieza es única", "<p>Texto de ejemplo: cuenta cómo empezaste, tus técnicas y tus materiales.</p>", "left", { label: "Ver la tienda", page: "tienda" }),
          album("Proceso", "Del barro a la mesa.", [
            ["pottery", "torno", "Modelado", "Proceso"],
            ["handmade", "piezas terminadas", "Esmaltado", "Proceso"],
            ["product", "producto terminado", "Terminación", "Piezas"],
          ]),
          social(["instagram"]),
        ],
      },
    ],
  ),

  // 18 · Academia deportiva (equipos)
  portalTemplate(
    {
      code: "academia-deportiva",
      name: "Academia deportiva",
      description: "Para escuelas y academias deportivas: horarios de entrenamiento, inscripciones y ubicación de la cancha.",
      industryTags: ["educacion", "fitness-coaching"],
      objectiveTags: ["reservar", "educar", "fidelizar"],
      themeCode: "vibrante-turquesa",
      family: "vibrante",
      sortOrder: 370,
    },
    [
      profile("Tu Academia Deportiva", "Fútbol formativo para niñas, niños y jóvenes", `${PROMISE} Tu metodología, tus entrenadores y tus categorías.`, { key: "soccer", alt: "niños jugando fútbol" }),
      engagement(),
      go("Inscripciones abiertas", "inscripciones", "Categorías de 5 a 16 años", true),
      subscribe("Noticias del club", "Partidos, resultados y avisos"),
      showcase("La academia", [
        { title: "Horarios", subtitle: "Entrenamientos por categoría", photo: "stadium", alt: "cancha de fútbol", page: "horarios" },
        { title: "Inscripciones", subtitle: "Planes mensuales", photo: "soccer", alt: "partido de fútbol", page: "inscripciones" },
      ]),
      stats([["+200", "deportistas"], ["8", "categorías"], ["12", "entrenadores"]]),
      social(["instagram", "facebook"]),
    ],
    [
      {
        slug: "horarios",
        blocks: [
          header("Horarios", "Entrenamientos", "Horarios de ejemplo."),
          eventsTo("inscripciones", "Esta semana", [
            { name: "Sub-8 (ejemplo)", start: "2026-12-01T17:00", venue: "Cancha 1", description: "Coordinación y juego.", label: "Inscribirme" },
            { name: "Sub-12 (ejemplo)", start: "2026-12-02T18:00", venue: "Cancha 2", description: "Técnica y táctica.", label: "Inscribirme" },
            { name: "Sub-16 (ejemplo)", start: "2026-12-03T19:00", venue: "Cancha 1", description: "Preparación competitiva.", label: "Inscribirme" },
          ]),
          map("Av. Departamental 5000, La Florida, Santiago", "Cancha (ejemplo)", "Estacionamiento en el recinto."),
          go("Inscribir a mi hijo o hija", "inscripciones"),
        ],
      },
      {
        slug: "inscripciones",
        blocks: [
          header("Inscripciones", "Súmate al equipo", "Valores de ejemplo."),
          pricingTo("inscripciones", "Planes", [
            { name: "Dos veces por semana", price: 35000, period: "month", description: "Entrenamiento formativo.", features: ["2 entrenamientos semanales", "Seguro deportivo"], cta: "Inscribirme" },
            { name: "Competitivo", price: 55000, period: "month", description: "Para quienes juegan torneos.", features: ["3 entrenamientos semanales", "Torneos y partidos"], highlighted: true, badge: "Más elegido", cta: "Inscribirme" },
          ]),
          booking("Reservar clase de prueba"),
          faq([["¿Desde qué edad?", "Respuesta de ejemplo: desde los 5 años."], ["¿Necesitan equipo?", "Respuesta de ejemplo: zapatillas de fútbol y canilleras."]]),
        ],
      },
    ],
  ),

  // 19 · Spa o centro de bienestar
  portalTemplate(
    {
      code: "spa-bienestar",
      name: "Spa y centro de bienestar",
      description: "Para spas y centros de bienestar: tratamientos con precio, reservas, ubicación y testimonios.",
      industryTags: ["belleza-bienestar", "salud"],
      objectiveTags: ["reservar", "vender"],
      themeCode: "minimal-arena",
      family: "minimal",
      sortOrder: 380,
    },
    [
      profile("Tu Spa", "Masajes, faciales y rituales de relajación", `${PROMISE} Tu espacio y tu filosofía de bienestar.`, { key: "spaStones", alt: "piedras de spa" }),
      engagement(),
      go("Reserva tu tratamiento", "reservas", "Masajes, faciales y circuitos", true),
      showcase("Bienestar", [
        { title: "Tratamientos", subtitle: "Masajes, faciales y rituales", photo: "spaMassage", alt: "masaje relajante", page: "tratamientos" },
        { title: "Reservas", subtitle: "Ubicación y horarios", photo: "spaStones", alt: "piedras de spa", page: "reservas" },
      ]),
      testimonials([["Salí renovada. Reseña de ejemplo.", "Clienta de ejemplo"]]),
      social(["instagram"]),
    ],
    [
      {
        slug: "tratamientos",
        blocks: [
          header("Tratamientos", "Elige tu momento", "Valores de ejemplo."),
          service("Masaje descontracturante (ejemplo)", "60 minutos con aceites esenciales.", 38000, "Reservar", "reservas"),
          service("Facial hidratante (ejemplo)", "Limpieza profunda e hidratación.", 32000, "Reservar", "reservas"),
          service("Ritual en pareja (ejemplo)", "Masaje y circuito de aguas para dos.", 95000, "Reservar", "reservas"),
          testimonials([["El ritual en pareja es increíble. Reseña de ejemplo.", "Cliente de ejemplo"]]),
        ],
      },
      {
        slug: "reservas",
        blocks: [
          header("Reservas", "Agenda tu visita", "Información de ejemplo."),
          booking("Reservar tratamiento"),
          map("Av. Kennedy 7000, Vitacura, Santiago", "Spa (ejemplo)", "Martes a domingo, de 10:00 a 20:00."),
          faq([["¿Venden gift cards?", "Respuesta de ejemplo: sí, escríbenos para regalar una experiencia."]]),
        ],
      },
    ],
  ),

  // 21 · Cerrajero, gásfiter o electricista (servicio técnico a domicilio)
  portalTemplate(
    {
      code: "servicio-tecnico-domicilio",
      name: "Servicio técnico a domicilio",
      description: "Para cerrajeros, gásfiter y electricistas: servicios con precio, zona de cobertura, WhatsApp directo y reseñas.",
      industryTags: ["servicios-locales"],
      objectiveTags: ["captar", "reservar"],
      themeCode: "carbon",
      family: "clasico",
      sortOrder: 390,
    },
    [
      profile("Tu Servicio Técnico", "Electricidad, gasfitería y cerrajería a domicilio", `${PROMISE} Tu experiencia, tus certificaciones y tu zona.`, { key: "electrician", alt: "electricista trabajando" }, "banner"),
      engagement(),
      whatsapp("Pedir visita por WhatsApp", "Hola, necesito una visita técnica."),
      showcase("Cómo te ayudo", [
        { title: "Servicios y precios", subtitle: "Valores claros antes de ir", photo: "plumbing", alt: "reparación de cañerías", page: "servicios" },
        { title: "Zona de cobertura", subtitle: "Comunas y horarios", photo: "electrician", alt: "tablero eléctrico", page: "cobertura" },
      ]),
      testimonials([["Llegó en una hora y dejó todo funcionando. Reseña de ejemplo.", "Vecina de ejemplo"]]),
      social(["facebook", "instagram"]),
    ],
    [
      {
        slug: "servicios",
        blocks: [
          header("Servicios", "Precios claros", "Valores de ejemplo, sin incluir materiales."),
          service("Visita técnica (ejemplo)", "Diagnóstico en tu domicilio.", 15000, "Pedir visita", "cobertura"),
          service("Cambio de chapa (ejemplo)", "Chapa estándar instalada.", 25000, "Pedir visita", "cobertura"),
          service("Reparación eléctrica (ejemplo)", "Enchufes, interruptores y automáticos.", 20000, "Pedir visita", "cobertura"),
          testimonials([["Honesto y rápido. Reseña de ejemplo.", "Cliente de ejemplo"]]),
        ],
      },
      {
        slug: "cobertura",
        blocks: [
          header("Cobertura", "Dónde atiendo", "Comunas de ejemplo."),
          whatsapp("Pedir visita", "Hola, necesito una visita técnica."),
          map("Ñuñoa, Providencia, La Reina y Macul, Santiago", "Zona de cobertura (ejemplo)", "Urgencias de lunes a domingo, de 08:00 a 22:00."),
          faq([["¿Cobras la visita?", "Respuesta de ejemplo: sí, y se descuenta si realizas el trabajo."], ["¿Das boleta?", "Respuesta de ejemplo: sí, boleta de honorarios."]]),
        ],
      },
    ],
  ),
];
