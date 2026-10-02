export interface RecursoGuia {
  id: string;
  slug: string;
  titulo: string;
  categoria: "Inicio rápido" | "Conversión y Ventas" | "Legal y Privacidad" | "Herramientas";
  tiempoLectura: string;
  resumen: string;
  puntosClave: string[];
}

export const RECURSOS_GUIAS: RecursoGuia[] = [
  {
    id: "lanzar-en-10-minutos",
    slug: "lanzar-en-10-minutos",
    titulo: "Cómo lanzar tu centro digital en menos de 10 minutos",
    categoria: "Inicio rápido",
    tiempoLectura: "4 min",
    resumen:
      "Aprende paso a paso cómo registrar tu cuenta, elegir una plantilla acorde a tu rubro, personalizar los bloques esenciales y publicar tu sitio sin tocar código.",
    puntosClave: [
      "Elección de la plantilla base según tu objetivo principal (reservar, vender o captar).",
      "Configuración de tu foto de perfil, biografía y paleta de colores de marca.",
      "Vinculación de tus redes sociales y botón principal de contacto.",
      "Publicación instantánea bajo tu slug gratuito o dominio propio.",
    ],
  },
  {
    id: "reservas-sin-solapes",
    slug: "reservas-sin-solapes",
    titulo: "Guía definitiva para recibir reservas online sin llamadas ni dobles citas",
    categoria: "Conversión y Ventas",
    tiempoLectura: "6 min",
    resumen:
      "Descubre cómo estructurar tus servicios, definir horarios semanales por profesional o sucursal y cobrar señas automáticas para eliminar las cancelaciones de última hora.",
    puntosClave: [
      "Configuración de horarios semanales y tiempos de colchón (buffer) entre citas.",
      "Asignación de profesionales específicos a cada servicio con balanceo automático.",
      "Activación del cobro de señas con Mercado Pago para garantizar el compromiso.",
      "Suscripción de citas a tu Google Calendar o Apple Calendar vía feed iCal.",
    ],
  },
  {
    id: "cobros-chile",
    slug: "cobros-chile",
    titulo: "Cómo configurar tus cobros en línea con Webpay y Mercado Pago",
    categoria: "Conversión y Ventas",
    tiempoLectura: "5 min",
    resumen:
      "Comprende la diferencia entre cobrar suscripciones de tu negocio y recibir pagos de tus clientes finales con tu propia cuenta comercial de forma 100 % transparente.",
    puntosClave: [
      "Conexión segura mediante OAuth sin compartir contraseñas ni claves API sensibles.",
      "Recepción directa de los fondos en tu cuenta bancaria sin comisiones sobre ventas de Impulza.",
      "Aviso por correo cuando un pago queda confirmado.",
      "Estado de cada pago y devoluciones desde tu panel de cobros.",
    ],
  },
  {
    id: "ley-21719-privacidad",
    slug: "ley-21719-privacidad",
    titulo: "Cumplimiento de la Ley 21.719 de datos personales en tu sitio web",
    categoria: "Legal y Privacidad",
    tiempoLectura: "7 min",
    resumen:
      "Lo que todo negocio y profesional en Chile debe saber sobre el nuevo marco de protección de datos: consentimiento informado, cookies de terceros y trazabilidad.",
    puntosClave: [
      "Por qué la analítica nativa de Impulza One no requiere banner invasivo de cookies.",
      "Cómo activar Google Analytics y Meta Pixel con consentimiento previo auditable.",
      "Doble confirmación en newsletters para evitar multas y quejas de spam.",
      "Manejo seguro de datos de clientes y derechos ARCO en tu mini-CRM.",
    ],
  },
  {
    id: "optimizacion-embudos",
    slug: "optimizacion-embudos",
    titulo: "Estrategias de conversión con embudos, cupones y carrito de compra",
    categoria: "Conversión y Ventas",
    tiempoLectura: "5 min",
    resumen:
      "Aumenta el ticket promedio de tu tienda digital combinando variantes de producto, descuentos por código promocional y secuencias de correo de bienvenida.",
    puntosClave: [
      "Cómo crear embudos de 2 a 6 pasos para detectar en qué etapa abandonan los usuarios.",
      "Configuración de cupones de descuento porcentuales o de monto fijo con fecha límite.",
      "Diseño de ofertas con cuenta regresiva para promociones de fin de semana.",
      "Pruebas A/B en textos y llamadas a la acción para maximizar conversiones.",
    ],
  },
  {
    id: "herramientas-qr-enlaces",
    slug: "herramientas-qr-enlaces",
    titulo: "Maximiza el impacto de tus códigos QR y enlaces cortos en el mundo físico",
    categoria: "Herramientas",
    tiempoLectura: "4 min",
    resumen:
      "Buenas prácticas para imprimir códigos QR en tarjetas de visita, vitrinas, cartas y packaging, midiendo cada escaneo en tiempo real.",
    puntosClave: [
      "Tamaños mínimos recomendados de impresión y contraste de color para lectura rápida.",
      "Creación de enlaces cortos mnemotécnicos para compartir por radio, audio o impresos.",
      "Trazabilidad de visitas por dispositivo, sistema operativo y horario.",
      "Reorientación del destino de un QR ya impreso sin tener que volver a imprimir.",
    ],
  },
];

export const HERRAMIENTAS_UTILES = [
  {
    titulo: "Generador de Códigos QR",
    descripcion: "Crea códigos QR dinámicos de alta resolución para descargar e imprimir en tus piezas gráficas.",
    enlace: "/planes",
    label: "Ver planes con QR ilimitados",
  },
  {
    titulo: "Catálogo de Plantillas Profesionales",
    descripcion: "Explora decenas de diseños probados para cada rubro listos para activar en tu cuenta.",
    enlace: "/plantillas",
    label: "Explorar plantillas",
  },
  {
    titulo: "Comparador de Planes",
    descripcion: "Revisa los límites de sitios, almacenamiento, miembros de equipo y pasarelas de pago.",
    enlace: "/planes#faq",
    label: "Comparar planes y precios",
  },
];
