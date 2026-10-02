export interface SolucionRubro {
  id: string;
  slug: string;
  nombre: string;
  tagline: string;
  descripcion: string;
  problemas: string[];
  beneficios: string[];
  /** Nombres de bloques del constructor (`BLOCK_TYPES` en `@impulza/validation`) que de verdad existen. */
  bloquesRecomendados: Array<{ nombre: string; motivo: string }>;
  /** `nombre` es el de una plantilla real del catálogo (se comprueba en `marketing-pages.test.ts`). */
  plantillaRecomendada: {
    nombre: string;
    descripcion: string;
  };
}

// Todo lo que se promete aquí tiene que existir en el producto (ver `docs/decisions/ADR-025`): nada de
// cupos con aforo, reservas por número de comensales ni emisión automática de boletas.
export const SOLUCIONES_RUBROS: SolucionRubro[] = [
  {
    id: "salud-bienestar",
    slug: "salud-bienestar",
    nombre: "Salud y Bienestar",
    tagline: "Agenda citas sin llamadas ni cruces de horarios",
    descripcion:
      "Diseñado para psicólogos, kinesiólogos, nutricionistas, médicos y terapeutas independientes o clínicas que necesitan un flujo profesional de reservas y seguimiento de pacientes.",
    problemas: [
      "Pérdida de horas de consulta por cancelaciones de último minuto y ausencias sin aviso.",
      "Interrupciones constantes por WhatsApp para coordinar citas mientras atiendes a un paciente.",
      "Cruces de agenda cuando atiendes en más de una sucursal o con otros profesionales.",
    ],
    beneficios: [
      "Agenda pública 24/7 con disponibilidad en tiempo real y bloqueo anti-solapamiento.",
      "Cobro de seña anticipada con Mercado Pago para reducir el ausentismo.",
      "Varios profesionales y sucursales, cada uno con su propio horario.",
      "Suscripción de tus citas a Google Calendar, Apple Calendar u Outlook mediante un enlace iCal.",
    ],
    bloquesRecomendados: [
      { nombre: "Reservas", motivo: "Tus pacientes eligen día, hora, servicio y profesional disponible en segundos." },
      { nombre: "Formulario de contacto", motivo: "Recibe el motivo de consulta y los datos del paciente, con su consentimiento." },
      { nombre: "Ubicación y mapa", motivo: "Dirección clara de tu consulta o box de atención." },
    ],
    plantillaRecomendada: {
      nombre: "Salud y bienestar",
      descripcion: "Plantilla pensada para consultas y terapias, lista para personalizar con tus servicios y horarios.",
    },
  },
  {
    id: "gastronomia-local",
    slug: "gastronomia-local",
    nombre: "Gastronomía y Locales",
    tagline: "Carta digital, reservas y presencia en tu barrio",
    descripcion:
      "Para cafeterías de especialidad, restaurantes, pastelerías, bares y locales de barrio que quieren digitalizar su carta, coordinar reservas y vender directo sin pagar comisiones de intermediarios.",
    problemas: [
      "Cartas en PDF pesadas y lentas que los clientes no quieren descargar en su teléfono.",
      "Comisiones altas en apps de delivery que se comen el margen de tu cocina.",
      "Clientes que llegan y no encuentran mesa en horas punta sin poder reservar antes.",
    ],
    beneficios: [
      "Carta interactiva rápida, optimizada para teléfonos y para escanear con código QR.",
      "Pedidos directos desde tu página, sin comisión de Impulza One sobre tus ventas.",
      "Reservas por horario para tus mesas o servicios.",
      "Códigos QR listos para imprimir en mesas, vitrinas y servilleteros.",
    ],
    bloquesRecomendados: [
      { nombre: "Catálogo", motivo: "Muestra platos, postres y promociones con fotos y precios." },
      { nombre: "Reservas", motivo: "Tus clientes reservan su hora sin llamar." },
      { nombre: "Ubicación y mapa", motivo: "Informa cómo llegar a tu local." },
    ],
    plantillaRecomendada: {
      nombre: "Café y gastronomía",
      descripcion: "Plantilla pensada para locales de comida y café, con WhatsApp y reservas a mano.",
    },
  },
  {
    id: "creadores-marca",
    slug: "creadores-marca",
    nombre: "Creadores y Marca Personal",
    tagline: "Monetiza tu comunidad desde tu propio dominio",
    descripcion:
      "Para influencers, podcasters, artistas, autores y creadores de contenido que superaron el link-in-bio básico y buscan vender productos digitales, captar suscriptores y tener su propia identidad.",
    problemas: [
      "Dependencia total de algoritmos de redes sociales que cambian y reducen tu alcance orgánico.",
      "Uso de múltiples herramientas externas inconexas para enlaces, descargas y newsletters.",
      "Pérdida de la base de seguidores al no tener un canal directo propio.",
    ],
    beneficios: [
      "Venta directa de descargas digitales (ebooks, audios, plantillas) con entrega segura.",
      "Newsletter con suscripción de doble confirmación para construir tu lista de correos propia.",
      "Bloques de música, video y eventos para presentar tus últimos lanzamientos.",
      "Analítica propia sin cookies que muestra qué enlaces convierten mejor.",
    ],
    bloquesRecomendados: [
      { nombre: "Catálogo", motivo: "Vende o regala tus recursos digitales con enlaces protegidos." },
      { nombre: "Newsletter", motivo: "Capta suscriptores directamente a tu lista sin intermediarios." },
      { nombre: "Música y video", motivo: "Muestra tu último podcast de Spotify o video de YouTube." },
    ],
    plantillaRecomendada: {
      nombre: "Creador y marca personal",
      descripcion: "Plantilla pensada para creadores, enfocada en enlaces destacados, boletín y descargas.",
    },
  },
  {
    id: "tiendas-comercio",
    slug: "tiendas-comercio",
    nombre: "Tiendas y E-commerce",
    tagline: "Vende productos con variantes, cupones y carrito de compra",
    descripcion:
      "Para marcas emergentes, boutiques, tiendas de ropa, artesanía y productos exclusivos que buscan una tienda online rápida, sin la complejidad de plataformas pesadas.",
    problemas: [
      "Plataformas de e-commerce complejas con altos costos mensuales fijos y comisiones ocultas.",
      "Falta de soporte para medios de pago locales como Mercado Pago.",
      "Carritos abandonados por procesos de compra lentos con registro obligatorio.",
    ],
    beneficios: [
      "Catálogo con variantes de talla, color o material y control de stock.",
      "Carrito con varios productos y cupones de descuento que se validan al instante.",
      "Pagos con Mercado Pago directo a tu cuenta, sin intermediación de Impulza One.",
      "Aviso por correo cuando entra un pedido nuevo.",
    ],
    bloquesRecomendados: [
      { nombre: "Catálogo", motivo: "Grilla de productos con variantes, stock y carrito." },
      { nombre: "Cuenta regresiva", motivo: "Genera urgencia en ofertas y lanzamientos de temporada." },
      { nombre: "Preguntas frecuentes", motivo: "Resuelve dudas de envíos, cambios y pagos." },
    ],
    plantillaRecomendada: {
      nombre: "Tienda y comercio",
      descripcion: "Plantilla pensada para vender productos, con catálogo y carrito listos para tus fotos y precios.",
    },
  },
  {
    id: "servicios-b2b",
    slug: "servicios-b2b",
    nombre: "Servicios y Consultorías",
    tagline: "Convierte visitas en propuestas comerciales calificadas",
    descripcion:
      "Para abogados, consultores estratégicos, contadores, agencias creativas y firmas de servicios que necesitan proyectar seriedad y capturar prospectos calificados.",
    problemas: [
      "Sitios web corporativos estáticos que no generan oportunidades reales de venta.",
      "Prospectos que se pierden en el correo sin un seguimiento estructurado ni trazabilidad.",
      "Dificultad para medir el retorno de inversión en publicidad y campañas de marketing.",
    ],
    beneficios: [
      "Formularios de contacto con los campos que necesitas para filtrar prospectos.",
      "Mini-CRM integrado con embudos de conversión para ver en qué paso se pierde cada visita.",
      "Webhooks salientes para conectar tus contactos en tiempo real con Zapier, Make o tu propio sistema.",
      "Pruebas A/B para optimizar el mensaje comercial y aumentar la tasa de conversión.",
    ],
    bloquesRecomendados: [
      { nombre: "Formulario de contacto", motivo: "Recibe cada consulta con los datos que necesitas antes de la primera llamada." },
      { nombre: "Tabla de precios", motivo: "Presenta tus planes y alcances de servicio con transparencia." },
      { nombre: "Testimonios", motivo: "Construye autoridad y confianza con clientes previos." },
    ],
    plantillaRecomendada: {
      nombre: "Profesional de servicios",
      descripcion: "Plantilla sobria pensada para profesionales y firmas, con captura de contactos y testimonios.",
    },
  },
  {
    id: "educacion-talleres",
    slug: "educacion-talleres",
    nombre: "Educación y Talleres",
    tagline: "Da a conocer tus clases y talleres y recibe consultas sin fricción",
    descripcion:
      "Para profesores particulares, escuelas de oficio, academias de baile, entrenadores y oradores que imparten clases, talleres presenciales o programas en línea.",
    problemas: [
      "Consultas e inscripciones manuales por chat que te quitan tiempo.",
      "Cobros desordenados mediante transferencias bancarias que exigen verificación manual.",
      "Falta de comunicación automatizada antes del inicio de la clase o evento.",
    ],
    beneficios: [
      "Bloque de eventos con fecha, hora y lugar o enlace de acceso de cada clase o taller.",
      "Formulario de contacto para recibir inscripciones e interesados.",
      "Secuencias de correo automatizadas para enviar material de bienvenida y seguimiento.",
      "Cobro online con Mercado Pago si vendes tus clases o materiales como producto.",
    ],
    bloquesRecomendados: [
      { nombre: "Eventos", motivo: "Calendario claro de tus próximas clases y talleres." },
      { nombre: "Newsletter", motivo: "Mantén informados a tus alumnos e interesados." },
      { nombre: "Preguntas frecuentes", motivo: "Resuelve dudas sobre requisitos, nivel y horarios." },
    ],
    plantillaRecomendada: {
      nombre: "Eventos y turismo",
      descripcion: "Plantilla pensada para eventos y actividades, con fechas y llamadas a la acción destacadas.",
    },
  },
];
