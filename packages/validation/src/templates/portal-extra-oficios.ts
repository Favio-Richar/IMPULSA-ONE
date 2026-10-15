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
  showcase,
  social,
  stats,
  steps,
  subscribe,
  testimonials,
  whatsapp,
} from "./portal-content.js";
import { eventsTo, go, portalTemplate, pricingTo, shop, sphere } from "./portal-extra-helpers.js";

// Plantillas del editor de portales — tanda 3: freelance, moda, chef, belleza a domicilio, yoga, tatuajes, taller mecánico,
// seguros y consultoría. «Suscribirme» solo en yoga (alumnas y alumnos que siguen las clases); el resto son servicios.

export const PORTAL_TEMPLATES_OFICIOS: TemplateDefinition[] = [
  // 22 · Freelancer de diseño o desarrollo
  portalTemplate(
    {
      code: "freelancer-diseno",
      name: "Freelancer de diseño y desarrollo",
      description: "Para diseñadores y desarrolladores independientes: portafolio de proyectos, paquetes con precio y contacto.",
      industryTags: ["profesional", "creador"],
      objectiveTags: ["mostrar", "captar", "vender"],
      themeCode: "oscuro-monocromo",
      family: "oscuro",
      sortOrder: 400,
    },
    [
      profile("Tu Nombre", "Diseño de marcas y sitios web", `${PROMISE} Qué haces, para quién y cómo trabajas.`, undefined, "cutout"),
      engagement(),
      go("Ver mi portafolio", "proyectos", "Marcas, sitios y productos digitales", true),
      showcase(
        "Proyectos recientes",
        [
          { title: "Identidad · Café de ejemplo", subtitle: "Marca y empaques", badge: "2026", photo: "designDesk", alt: "escritorio de diseño", page: "proyectos" },
          { title: "Sitio web · Estudio de ejemplo", subtitle: "Diseño y desarrollo", badge: "2025", photo: "laptopCode", alt: "código en un portátil", page: "proyectos" },
          { title: "App · Producto de ejemplo", subtitle: "Diseño de interfaz", badge: "2025", photo: "office", alt: "equipo trabajando", page: "proyectos" },
        ],
        "index",
      ),
      social(["linkedin", "instagram"]),
    ],
    [
      {
        slug: "proyectos",
        blocks: [
          header("Portafolio", "Proyectos seleccionados", "Proyectos de ejemplo: muestra los tuyos."),
          showcase(
            "Casos",
            [
              { title: "Identidad de marca", subtitle: "De la estrategia al logotipo", photo: "designDesk", alt: "bocetos de diseño", page: "paquetes" },
              { title: "Sitio web", subtitle: "Rápido, accesible y medible", photo: "laptopCode", alt: "desarrollo web", page: "paquetes" },
            ],
            "grid",
          ),
          testimonials([["Entendió la marca a la primera. Reseña de ejemplo.", "Cliente de ejemplo"]]),
          go("Ver paquetes y precios", "paquetes"),
        ],
      },
      {
        slug: "paquetes",
        blocks: [
          header("Paquetes", "Trabajemos juntos", "Precios de ejemplo."),
          pricingTo("paquetes", "Paquetes", [
            { name: "Marca", price: 450000, period: "once", description: "Identidad visual completa.", features: ["Logotipo y variantes", "Paleta y tipografías", "Manual básico"], cta: "Cotizar" },
            { name: "Sitio web", price: 900000, period: "once", description: "Sitio a medida.", features: ["Hasta 6 páginas", "Diseño responsive", "Capacitación"], highlighted: true, badge: "Más pedido", cta: "Cotizar" },
          ]),
          whatsapp("Cotizar por WhatsApp", "Hola, quiero cotizar un proyecto."),
          contactActions(),
        ],
      },
    ],
  ),

  // 23 · Tienda de ropa o moda
  portalTemplate(
    {
      code: "tienda-moda",
      name: "Tienda de moda",
      description: "Para tiendas de ropa y marcas de moda: catálogo, colecciones por temporada, redes y local físico.",
      industryTags: ["comercio", "emprendimiento"],
      objectiveTags: ["vender", "mostrar"],
      themeCode: "vibrante-coral",
      family: "vibrante",
      sortOrder: 410,
    },
    [
      profile("Tu Tienda de Moda", "Ropa de diseño independiente", `${PROMISE} Tu estilo, tus materiales y tus envíos.`, { key: "boutique", alt: "perchero de una boutique" }),
      engagement(),
      go("Comprar la colección", "tienda", "Envíos a todo el país", true),
      showcase(
        "Colecciones",
        [
          { title: "Verano 2027", subtitle: "Lino y colores claros", badge: "Nueva", photo: "whiteDress", alt: "vestido blanco", page: "colecciones" },
          { title: "Básicos", subtitle: "Prendas para todos los días", photo: "knitwear", alt: "prendas tejidas", page: "colecciones" },
        ],
        "grid",
      ),
      social(["instagram", "tiktok", "facebook"]),
    ],
    [
      {
        slug: "tienda",
        blocks: [
          header("Tienda", "Compra en línea", "Productos de ejemplo: cárgalos en tu catálogo."),
          shop("Ver productos"),
          map("Av. Italia 1300, Providencia, Santiago", "Local (ejemplo)", "Martes a domingo, de 11:00 a 20:00."),
          whatsapp("Consultar tallas", "Hola, quiero consultar por una talla."),
        ],
      },
      {
        slug: "colecciones",
        blocks: [
          header("Colecciones", "Temporadas", "Fotos de ejemplo."),
          album("Lookbook", "Filtra por colección.", [
            ["whiteDress", "vestido blanco", "Vestido lino", "Verano"],
            ["jumpsuit", "enterito", "Enterito", "Verano"],
            ["knitwear", "prendas tejidas", "Sweater", "Básicos"],
            ["blueHoodie", "polerón azul", "Polerón", "Básicos"],
            ["sunglasses", "lentes de sol", "Accesorios", "Accesorios"],
          ]),
          go("Ir a la tienda", "tienda"),
        ],
      },
    ],
  ),

  // 24 · Chef privado o catering
  portalTemplate(
    {
      code: "chef-catering",
      name: "Chef privado y catering",
      description: "Para chefs privados y servicios de catering: menú de eventos, paquetes por invitados, reserva de fecha y galería.",
      industryTags: ["gastronomia", "eventos"],
      objectiveTags: ["reservar", "vender", "mostrar"],
      themeCode: "editorial",
      family: "clasico",
      sortOrder: 420,
    },
    [
      profile("Tu Cocina Privada", "Chef a domicilio y catering para eventos", `${PROMISE} Tu cocina, tu formación y los eventos que haces.`, { key: "catering", alt: "mesa de catering" }),
      engagement(),
      go("Reserva tu fecha", "reservas", "Cenas privadas y eventos", true),
      showcase("Experiencias", [
        { title: "Menús y paquetes", subtitle: "Por número de invitados", photo: "dishes", alt: "platos servidos", page: "menus" },
        { title: "Reserva", subtitle: "Consulta disponibilidad", photo: "cooking", alt: "chef cocinando", page: "reservas" },
      ]),
      testimonials([["La cena de aniversario fue perfecta. Reseña de ejemplo.", "Cliente de ejemplo"]]),
      social(["instagram"]),
    ],
    [
      {
        slug: "menus",
        blocks: [
          header("Menús", "Cocina de temporada", "Menús y precios de ejemplo."),
          pricingTo("reservas", "Paquetes por invitados", [
            { name: "Cena íntima", price: 45000, period: "once", description: "Por persona, de 2 a 8 invitados.", features: ["Menú de 4 tiempos", "Servicio en tu casa"], cta: "Reservar fecha" },
            { name: "Evento", price: 28000, period: "once", description: "Por persona, desde 20 invitados.", features: ["Cóctel y fondos", "Garzones incluidos"], highlighted: true, badge: "Más pedido", cta: "Reservar fecha" },
          ]),
          shop("Productos para llevar"),
          sphere([
            ["dishes", "platos servidos"],
            ["plate", "plato de fondo"],
            ["catering", "mesa de catering"],
            ["cooking", "chef cocinando"],
            ["bakery", "panadería"],
          ]),
        ],
      },
      {
        slug: "reservas",
        blocks: [
          header("Reservas", "Agenda tu evento", "Información de ejemplo."),
          booking("Reservar fecha"),
          steps("Cómo funciona", [
            ["Conversamos", "Me cuentas el evento y tus gustos."],
            ["Propuesta", "Te envío el menú y el presupuesto."],
            ["El día", "Cocino y sirvo; tú disfrutas."],
          ]),
          faq([["¿Atiendes alergias?", "Respuesta de ejemplo: sí, adapto el menú a cada invitado."]]),
        ],
      },
    ],
  ),

  // 25 · Peluquería o maquillaje a domicilio
  portalTemplate(
    {
      code: "belleza-domicilio",
      name: "Peluquería y maquillaje a domicilio",
      description: "Para estilistas y maquilladoras a domicilio: servicios con precio, reservas, portafolio y zona de cobertura.",
      industryTags: ["belleza-bienestar", "servicios-locales"],
      objectiveTags: ["reservar", "mostrar"],
      themeCode: "vibrante-violeta",
      family: "vibrante",
      sortOrder: 430,
    },
    [
      profile("Tu Nombre, Estilista", "Peinados y maquillaje para novias y eventos", `${PROMISE} Tu estilo y los eventos que atiendes.`, { key: "makeup", alt: "maquillaje profesional" }, "banner"),
      engagement(),
      go("Reserva tu hora", "reservas", "Atención a domicilio", true),
      showcase("Mi trabajo", [
        { title: "Portafolio y servicios", subtitle: "Novias, eventos y sesiones", photo: "hairStylist", alt: "estilista peinando", page: "servicios" },
        { title: "Reservas y cobertura", subtitle: "Comunas donde atiendo", photo: "hairSalon", alt: "salón de belleza", page: "reservas" },
      ]),
      social(["instagram", "tiktok"]),
    ],
    [
      {
        slug: "servicios",
        blocks: [
          header("Servicios", "Peinado y maquillaje", "Valores de ejemplo."),
          service("Maquillaje social (ejemplo)", "Para eventos y fiestas.", 30000, "Reservar", "reservas"),
          service("Peinado (ejemplo)", "Recogidos, ondas y trenzas.", 28000, "Reservar", "reservas"),
          service("Novia completa (ejemplo)", "Prueba, peinado y maquillaje el día de la boda.", 150000, "Reservar", "reservas"),
          album("Portafolio", "Trabajos de ejemplo.", [
            ["makeup", "maquillaje", "Maquillaje de noche", "Maquillaje"],
            ["hairStylist", "peinado", "Ondas", "Peinado"],
            ["womanBob", "corte bob", "Peinado corto", "Peinado"],
            ["redSmile", "labial rojo", "Clásico", "Maquillaje"],
          ]),
        ],
      },
      {
        slug: "reservas",
        blocks: [
          header("Reservas", "Agenda a domicilio", "Información de ejemplo."),
          booking("Reservar hora"),
          map("Providencia, Las Condes, Vitacura y Ñuñoa, Santiago", "Zona de cobertura (ejemplo)", "Fuera de la zona, consulta por recargo."),
          faq([["¿Hay recargo por traslado?", "Respuesta de ejemplo: dentro de la zona, no."]]),
        ],
      },
    ],
  ),

  // 26 · Instructor de yoga o meditación
  portalTemplate(
    {
      code: "yoga-meditacion",
      name: "Yoga y meditación",
      description: "Para instructores de yoga y meditación: horarios de clases, planes, reservas, testimonios y comunidad.",
      industryTags: ["salud", "fitness-coaching"],
      objectiveTags: ["reservar", "fidelizar", "educar"],
      themeCode: "natural",
      family: "clasico",
      sortOrder: 440,
    },
    [
      profile("Tu Espacio de Yoga", "Hatha, vinyasa y meditación guiada", `${PROMISE} Tu formación y tu forma de enseñar.`, { key: "yoga", alt: "persona practicando yoga" }),
      engagement(),
      go("Reserva tu clase", "clases", "Presencial y online", true),
      subscribe("Meditaciones semanales", "Audios y clases grabadas"),
      showcase("Practica", [
        { title: "Horarios y planes", subtitle: "Clases para todos los niveles", photo: "wellness", alt: "yoga al atardecer", page: "clases" },
        { title: "Comunidad", subtitle: "Retiros y talleres", photo: "pilates", alt: "clase de pilates", page: "comunidad" },
      ]),
      social(["instagram", "youtube"]),
    ],
    [
      {
        slug: "clases",
        blocks: [
          header("Clases", "Horarios y planes", "Horarios y valores de ejemplo."),
          eventsTo("clases", "Esta semana", [
            { name: "Hatha suave (ejemplo)", start: "2026-12-01T08:00", venue: "Sala principal", description: "Para todos los niveles.", label: "Reservar" },
            { name: "Vinyasa (ejemplo)", start: "2026-12-02T19:00", venue: "Sala principal", description: "Flujo dinámico.", label: "Reservar" },
            { name: "Meditación (ejemplo)", start: "2026-12-04T20:00", venue: "Online", description: "30 minutos guiados.", label: "Reservar" },
          ]),
          pricingTo("clases", "Planes", [
            { name: "4 clases", price: 32000, period: "month", description: "Una clase por semana.", features: ["Presencial u online"], cta: "Elegir" },
            { name: "Ilimitado", price: 55000, period: "month", description: "Todas las clases.", features: ["Presencial y online", "Clases grabadas"], highlighted: true, badge: "Más elegido", cta: "Elegir" },
          ]),
          booking("Reservar clase"),
        ],
      },
      {
        slug: "comunidad",
        blocks: [
          header("Comunidad", "Más que una clase", "Texto de ejemplo."),
          testimonials([
            ["Encontré calma y constancia. Reseña de ejemplo.", "Alumna de ejemplo"],
            ["Las meditaciones me ayudan a dormir. Reseña de ejemplo.", "Alumno de ejemplo"],
          ]),
          feature("wellness", "práctica al atardecer", "Retiros", "Retiro de fin de semana", "<p>Texto de ejemplo: cuenta tus próximos retiros y talleres.</p>", "right", { label: "Ver horarios", page: "clases" }),
          subscribe("Únete a la comunidad", "Meditaciones y clases grabadas"),
          social(["instagram"]),
        ],
      },
    ],
  ),

  // 27 · Tatuador o estudio de tatuajes
  portalTemplate(
    {
      code: "estudio-tatuajes",
      name: "Estudio de tatuajes",
      description: "Para tatuadores y estudios: portafolio por estilo en esfera y con filtros, reservas de sesión, cuidados y ubicación.",
      industryTags: ["belleza-bienestar", "creador"],
      objectiveTags: ["mostrar", "reservar"],
      themeCode: "oscuro-monocromo",
      family: "oscuro",
      sortOrder: 450,
    },
    [
      profile("Tu Estudio de Tatuajes", "Línea fina, blackwork y realismo", `${PROMISE} Tu estilo y cómo trabajas cada diseño.`, { key: "tattoo", alt: "tatuador trabajando" }),
      engagement(),
      go("Reserva tu sesión", "reservas", "Diseño propio o a pedido", true),
      showcase("El estudio", [
        { title: "Portafolio por estilo", subtitle: "Línea fina, blackwork y realismo", photo: "tattoo", alt: "tatuaje en proceso", page: "portafolio" },
        { title: "Reservas y cuidados", subtitle: "Precios por tamaño", photo: "manDark", alt: "retrato", page: "reservas" },
      ]),
      social(["instagram", "tiktok"]),
    ],
    [
      {
        slug: "portafolio",
        blocks: [
          header("Portafolio", "Trabajos por estilo", "Fotos de ejemplo."),
          // Esfera 3D: el portafolio se recorre girándolo; las fotos se abren en grande.
          sphere([
            ["tattoo", "tatuaje en proceso"],
            ["manDark", "brazo tatuado"],
            ["blueHoodie", "retrato urbano"],
            ["womanBob", "tatuaje fino"],
            ["jacketMan", "estilo urbano"],
          ]),
          album("Trabajos", "Filtra por estilo.", [
            ["tattoo", "tatuaje en proceso", "Rosa", "Línea fina"],
            ["womanBob", "tatuaje fino", "Constelación", "Línea fina"],
            ["manDark", "brazo tatuado", "Manga", "Blackwork"],
            ["jacketMan", "tatuaje urbano", "Letras", "Blackwork"],
            ["manPortrait", "retrato", "Retrato", "Realismo"],
          ]),
          go("Reservar una sesión", "reservas"),
        ],
      },
      {
        slug: "reservas",
        blocks: [
          header("Reservas", "Agenda tu sesión", "Valores de ejemplo."),
          booking("Reservar sesión"),
          faq([
            ["¿Cuánto cuesta un tatuaje?", "Respuesta de ejemplo: pequeño desde $40.000, mediano desde $90.000; grande por sesión."],
            ["¿Cómo cuido el tatuaje?", "Respuesta de ejemplo: lavar con jabón neutro, crema cicatrizante y nada de sol ni piscina por 2 semanas."],
            ["¿Necesito abono?", "Respuesta de ejemplo: sí, un abono que se descuenta del total."],
          ]),
          map("Av. Brasil 100, Barrio Brasil, Santiago", "Estudio (ejemplo)", "Martes a sábado, con hora."),
        ],
      },
    ],
  ),

  // 28 · Mecánico o taller automotriz
  portalTemplate(
    {
      code: "taller-mecanico",
      name: "Taller mecánico",
      description: "Para mecánicos y talleres: servicios con precio, reserva de hora, ubicación y reseñas.",
      industryTags: ["servicios-locales"],
      objectiveTags: ["reservar", "captar"],
      themeCode: "carbon",
      family: "clasico",
      sortOrder: 460,
    },
    [
      profile("Tu Taller Mecánico", "Mantención, frenos y diagnóstico", `${PROMISE} Tu experiencia y las marcas que atiendes.`, { key: "garage", alt: "taller mecánico" }, "banner"),
      engagement(),
      go("Reserva tu hora", "reservas", "Diagnóstico y mantención", true),
      showcase("El taller", [
        { title: "Servicios y precios", subtitle: "Valores claros antes de empezar", photo: "carRepair", alt: "mecánico trabajando", page: "servicios" },
        { title: "Reservas y ubicación", subtitle: "Agenda en línea", photo: "garage", alt: "taller", page: "reservas" },
      ]),
      stats([["+2.000", "autos atendidos"], ["6 meses", "de garantía"], ["4,8", "en reseñas"]]),
      social(["facebook", "instagram"]),
    ],
    [
      {
        slug: "servicios",
        blocks: [
          header("Servicios", "Mantención y reparación", "Valores de ejemplo, sin repuestos."),
          service("Cambio de aceite (ejemplo)", "Aceite y filtro.", 35000, "Reservar", "reservas"),
          service("Frenos (ejemplo)", "Cambio de pastillas delanteras.", 45000, "Reservar", "reservas"),
          service("Diagnóstico (ejemplo)", "Escáner y revisión general.", 25000, "Reservar", "reservas"),
          testimonials([
            ["Honestos y rápidos. Reseña de ejemplo.", "Cliente de ejemplo"],
            ["Me explicaron todo antes de cobrar. Reseña de ejemplo.", "Clienta de ejemplo"],
          ]),
        ],
      },
      {
        slug: "reservas",
        blocks: [
          header("Reservas", "Agenda tu hora", "Información de ejemplo."),
          booking("Reservar hora"),
          map("Av. Vicuña Mackenna 3000, San Joaquín, Santiago", "Taller (ejemplo)", "Lunes a sábado, de 08:30 a 18:30."),
          faq([["¿Dan garantía?", "Respuesta de ejemplo: sí, 6 meses en mano de obra."]]),
        ],
      },
    ],
  ),

  // 29 · Agente de seguros o corredor
  portalTemplate(
    {
      code: "corredor-seguros",
      name: "Corredor de seguros",
      description: "Para agentes y corredores de seguros: tipos de seguro, reserva de asesoría, preguntas frecuentes y contacto.",
      industryTags: ["profesional"],
      objectiveTags: ["captar", "reservar"],
      themeCode: "ejecutivo-borgona",
      family: "ejecutivo",
      sortOrder: 470,
    },
    [
      profile("Tu Nombre, Corredor de Seguros", "Seguros de vida, salud, auto y hogar", `${PROMISE} Tu experiencia y cómo comparas las opciones.`, { key: "signing", alt: "firma de documentos" }, "banner"),
      engagement(),
      go("Agenda una asesoría", "asesoria", "Comparamos opciones sin costo", true),
      showcase("Seguros", [
        { title: "Tipos de seguro", subtitle: "Vida, salud, auto y hogar", photo: "signing", alt: "firma de póliza", page: "seguros" },
        { title: "Asesoría", subtitle: "Presencial u online", photo: "meeting", alt: "reunión", page: "asesoria" },
      ]),
      social(["linkedin", "facebook"]),
    ],
    [
      {
        slug: "seguros",
        blocks: [
          header("Seguros", "Protección a tu medida", "Valores referenciales de ejemplo."),
          service("Seguro de vida (ejemplo)", "Desde UF 0,5 al mes, según edad y cobertura.", 20000, "Cotizar", "asesoria"),
          service("Seguro de salud (ejemplo)", "Complementario a tu previsión.", 25000, "Cotizar", "asesoria"),
          service("Seguro de auto (ejemplo)", "Daños propios y a terceros.", 30000, "Cotizar", "asesoria"),
          service("Seguro de hogar (ejemplo)", "Incendio, sismo y robo.", 15000, "Cotizar", "asesoria"),
        ],
      },
      {
        slug: "asesoria",
        blocks: [
          header("Asesoría", "Comparamos por ti", "Información de ejemplo."),
          booking("Reservar asesoría"),
          faq([
            ["¿La asesoría tiene costo?", "Respuesta de ejemplo: no, la comisión la paga la compañía."],
            ["¿Me ayudas en un siniestro?", "Respuesta de ejemplo: sí, te acompaño en todo el proceso."],
          ]),
          contactActions(),
        ],
      },
    ],
  ),

  // 30 · Consultor de negocios o mentor
  portalTemplate(
    {
      code: "consultor-negocios",
      name: "Consultor de negocios",
      description: "Para consultores y mentores: paquetes con precio, cifras que respaldan tu trabajo, reservas de sesión y testimonios.",
      industryTags: ["profesional", "emprendimiento"],
      objectiveTags: ["captar", "reservar", "vender"],
      themeCode: "ejecutivo-marino",
      family: "ejecutivo",
      sortOrder: 480,
    },
    [
      profile("Tu Nombre, Consultor", "Estrategia y crecimiento para pymes", `${PROMISE} Tu experiencia y los resultados que logras.`, { key: "conference", alt: "persona exponiendo" }, "banner"),
      engagement(),
      go("Agenda una sesión", "sesion", "Primera conversación sin costo", true),
      stats([["+120", "empresas"], ["x2", "ventas en 12 meses (promedio)"], ["15 años", "de experiencia"]]),
      showcase("Cómo trabajo", [
        { title: "Programas", subtitle: "Mentoría, estrategia y talleres", photo: "workshop", alt: "taller de trabajo", page: "programas" },
        { title: "Sesión", subtitle: "Online o presencial", photo: "meeting", alt: "reunión", page: "sesion" },
      ]),
      testimonials([["Ordenamos el negocio y duplicamos ventas. Reseña de ejemplo.", "Fundadora de ejemplo"]]),
      social(["linkedin"]),
    ],
    [
      {
        slug: "programas",
        blocks: [
          header("Programas", "Elige cómo avanzar", "Precios de ejemplo."),
          pricingTo("sesion", "Programas", [
            { name: "Sesión estratégica", price: 90000, period: "once", description: "Dos horas para destrabar un problema.", features: ["Diagnóstico", "Plan de acción"], cta: "Agendar" },
            { name: "Mentoría", price: 350000, period: "month", description: "Acompañamiento mensual.", features: ["4 sesiones", "Seguimiento por WhatsApp"], highlighted: true, badge: "Más elegido", cta: "Agendar" },
          ]),
          steps("Método", [
            ["Diagnóstico", "Entendemos dónde estás."],
            ["Plan", "Prioridades y metas medibles."],
            ["Ejecución", "Avanzamos juntos cada semana."],
          ]),
          testimonials([["Claridad y foco desde la primera sesión. Reseña de ejemplo.", "Emprendedor de ejemplo"]]),
          go("Agendar una sesión", "sesion"),
        ],
      },
      {
        slug: "sesion",
        blocks: [
          header("Sesión", "Conversemos", "Información de ejemplo."),
          booking("Reservar sesión"),
          feature("manSuit", "consultor", "Sobre mí", "Experiencia práctica", "<p>Texto de ejemplo: tu trayectoria y empresas con las que has trabajado.</p>", "left"),
          contactActions(),
        ],
      },
    ],
  ),
];
