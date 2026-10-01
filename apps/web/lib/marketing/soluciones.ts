export interface SolucionRubro {
  id: string;
  slug: string;
  nombre: string;
  tagline: string;
  descripcion: string;
  problemas: string[];
  beneficios: string[];
  bloquesRecomendados: Array<{ nombre: string; motivo: string }>;
  plantillaRecomendada: {
    codigo: string;
    nombre: string;
    descripcion: string;
  };
}

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
      "Cobro de seña anticipada con Webpay o Mercado Pago para reducir el ausentismo a cero.",
      "Ficha de paciente en mini-CRM con consentimiento informado auditable (Ley 21.719).",
      "Sincronización con Google Calendar, Apple Calendar y Outlook mediante feed iCal universal.",
    ],
    bloquesRecomendados: [
      { nombre: "Reservas", motivo: "Tus pacientes eligen día, hora, servicio y profesional disponible en segundos." },
      { nombre: "Formulario clínico", motivo: "Captura antecedentes y motivos de consulta previo a la sesión." },
      { nombre: "Ubicación y mapa", motivo: "Dirección clara de tu consulta o box de atención." },
    ],
    plantillaRecomendada: {
      codigo: "salud-consulta",
      nombre: "Consulta Médica & Terapia",
      descripcion: "Diseño sobrio, tonos clínicos relajantes y selector de citas destacado.",
    },
  },
  {
    id: "gastronomia-local",
    slug: "gastronomia-local",
    nombre: "Gastronomía y Locales",
    tagline: "Menú digital, reservas de mesa y presencia en tu barrio",
    descripcion:
      "Para cafeterías de especialidad, restaurantes, pastelerías, bares y locales de barrio que quieren digitalizar su carta, coordinar reservas y vender directo sin pagar comisiones abusivas.",
    problemas: [
      "Cartas en PDF pesadas y lentas que los clientes no quieren descargar en su teléfono.",
      "Comisiones de hasta un 30 % en apps de delivery que se comen el margen de tu cocina.",
      "Clientes que llegan y no encuentran mesa en horas punta sin poder reservar antes.",
    ],
    beneficios: [
      "Menú interactivo ultra rápido optimizado para teléfonos y escaneo con código QR.",
      "Pedidos directos con pago anticipado o retiro en local sin comisiones de intermediarios.",
      "Módulo de reservas de mesa por horario y cantidad de comensales.",
      "Códigos QR listos para imprimir en mesas, vitrinas y servilleteros.",
    ],
    bloquesRecomendados: [
      { nombre: "Catálogo y carta", motivo: "Muestra platos, postres y promociones con fotos y precios." },
      { nombre: "Código QR nativo", motivo: "Acceso instantáneo a la carta desde cada mesa." },
      { nombre: "Horarios y contacto", motivo: "Informa claramente tus horarios de apertura y mapa de llegada." },
    ],
    plantillaRecomendada: {
      codigo: "gastronomia-bistro",
      nombre: "Bistró & Café Urbano",
      descripcion: "Enfoque visual en platos del día, botones de WhatsApp y reserva de mesa.",
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
      "Bloques de música, video vertical y eventos para presentar tus últimos lanzamientos.",
      "Analítica propia sin cookies que muestra qué enlaces convierten mejor.",
    ],
    bloquesRecomendados: [
      { nombre: "Descargas de archivos", motivo: "Vende o regala tus recursos digitales con enlaces protegidos." },
      { nombre: "Newsletter", motivo: "Capta suscriptores directamente a tu lista sin intermediarios." },
      { nombre: "Contenido multimedia", motivo: "Muestra tu último podcast de Spotify o video de YouTube." },
    ],
    plantillaRecomendada: {
      codigo: "creador-editorial",
      nombre: "Creador Digital & Podcast",
      descripcion: "Estilo limpio y moderno enfocado en enlaces destacados, boletín y descargas.",
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
      "Falta de soporte nativo para medios de pago locales como Webpay o Mercado Pago.",
      "Carritos abandonados por procesos de compra lentos con registro obligatorio.",
    ],
    beneficios: [
      "Catálogo con variantes de talla, color, material y control de stock en tiempo real.",
      "Carrito multi-producto ligero y cupones de descuento con validación instantánea.",
      "Integración directa con Mercado Pago y Webpay para recibir pagos con tarjetas chilenas.",
      "Notificaciones automáticas por correo de pedido confirmado y seguimiento.",
    ],
    bloquesRecomendados: [
      { nombre: "Catálogo de productos", motivo: "Grilla atractiva con variantes y control de stock." },
      { nombre: "Cupones de descuento", motivo: "Impulsa promociones especiales y fechas comerciales." },
      { nombre: "Cuenta regresiva", motivo: "Genera urgencia en ofertas y lanzamientos de temporada." },
    ],
    plantillaRecomendada: {
      codigo: "tienda-boutique",
      nombre: "Boutique & Accesorios",
      descripcion: "Fotografía de producto cuidada, carrito accesible y botones de compra directa.",
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
      "Formularios calificados con preguntas a medida para filtrar prospectos ideales.",
      "Mini-CRM integrado con embudos de conversión para gestionar cada contacto desde el primer clic.",
      "Webhooks salientes para conectar tus leads en tiempo real con HubSpot, Slack o tu ERP.",
      "Pruebas A/B para optimizar el mensaje comercial y aumentar la tasa de conversión.",
    ],
    bloquesRecomendados: [
      { nombre: "Formulario de cotización", motivo: "Califica a cada prospecto antes de la primera llamada." },
      { nombre: "Tabla de precios", motivo: "Presenta tus planes y alcances de servicio con transparencia." },
      { nombre: "Testimonios y casos", motivo: "Construye autoridad y confianza con clientes previos." },
    ],
    plantillaRecomendada: {
      codigo: "corporativo-consultora",
      nombre: "Firma Profesional & Consultoría",
      descripcion: "Tipografía sobria, estructura de casos de éxito y captura de cotizaciones.",
    },
  },
  {
    id: "educacion-talleres",
    slug: "educacion-talleres",
    nombre: "Educación y Talleres",
    tagline: "Inscripciones a cursos, talleres y capacitaciones sin fricción",
    descripcion:
      "Para profesores particulares, escuelas de oficio, academias de baile, entrenadores y oradores que imparten clases, talleres presenciales o programas en línea.",
    problemas: [
      "Inscripciones manuales por chat con riesgo de sobrecupo en talleres con aforo limitado.",
      "Cobros desordenados mediante transferencias bancarias que exigen verificación manual.",
      "Falta de comunicación automatizada antes del inicio de la clase o evento.",
    ],
    beneficios: [
      "Venta de cupos para fechas específicas con aforo máximo controlado.",
      "Bloques de eventos con calendario, hora de inicio y enlace de acceso o dirección.",
      "Secuencias de correo automatizadas para enviar material de bienvenida y recordatorios.",
      "Pagos automáticos con tarjeta que confirman el cupo de inmediato al alumno.",
    ],
    bloquesRecomendados: [
      { nombre: "Eventos y fechas", motivo: "Calendario claro de tus próximas clases y talleres." },
      { nombre: "Secuencias automáticas", motivo: "Envía el enlace de Zoom o las instrucciones de llegada." },
      { nombre: "Preguntas frecuentes", motivo: "Resuelve dudas sobre requisitos, nivel y horarios." },
    ],
    plantillaRecomendada: {
      codigo: "academia-cursos",
      nombre: "Academia & Talleres",
      descripcion: "Enfoque en temarios, fecha límite de inscripción y llamada a asegurar el cupo.",
    },
  },
];
