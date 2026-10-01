export type IntegracionCategoria = "pagos" | "calendarios" | "automatizacion" | "marketing" | "comunicacion";

export interface Integracion {
  id: string;
  nombre: string;
  categoria: IntegracionCategoria;
  categoriaLabel: string;
  tagline: string;
  descripcion: string;
  beneficios: string[];
  comoFunciona: string;
  estado: "Disponible" | "Procesamiento nativo";
  icono: string;
  badge?: string;
}

export const CATEGORIAS_INTEGRACIONES: Array<{ id: IntegracionCategoria; label: string }> = [
  { id: "pagos", label: "Pagos y Cobros" },
  { id: "calendarios", label: "Calendarios" },
  { id: "automatizacion", label: "Automatización" },
  { id: "marketing", label: "Marketing y Analítica" },
  { id: "comunicacion", label: "Comunicación" },
];

export const INTEGRACIONES: Integracion[] = [
  {
    id: "webpay-oneclick",
    nombre: "Webpay Oneclick (Transbank)",
    categoria: "pagos",
    categoriaLabel: "Pagos y Cobros",
    tagline: "Cobro de suscripciones y pagos con tarjetas de débito y crédito chilenas",
    descripcion:
      "Permite cobrar suscripciones recurrentes y pagos puntuales en pesos chilenos cumpliendo todas las exigencias de seguridad y normativas de Transbank.",
    beneficios: [
      "Inscripción de tarjeta en 1 clic para pagos rápidos sin volver a ingresar datos.",
      "Procesamiento directo en pesos chilenos (CLP) con boleta o factura.",
      "Reintentos automáticos en caso de fondos insuficientes.",
    ],
    comoFunciona: "Conexión transparente administrada desde el módulo de Facturación en el panel.",
    estado: "Disponible",
    icono: "credit-card",
    badge: "Chile",
  },
  {
    id: "mercado-pago",
    nombre: "Mercado Pago",
    categoria: "pagos",
    categoriaLabel: "Pagos y Cobros",
    tagline: "Recibe pagos de reservas, productos y pedidos con tu propia cuenta",
    descripcion:
      "Conecta tu cuenta de Mercado Pago con OAuth seguro para cobrar a tus clientes finales. El dinero entra directamente a tu cuenta comercial sin intermediación de Impulza One.",
    beneficios: [
      "Cobro de señas de reservas para asegurar la asistencia.",
      "Venta de productos físicos, servicios y descargas digitales.",
      "Acepta tarjetas de crédito, débito, transferencias y saldo en cuenta.",
    ],
    comoFunciona: "Haz clic en 'Conectar Mercado Pago' en la sección de cobros del panel y autoriza con tu cuenta.",
    estado: "Disponible",
    icono: "shopping-bag",
    badge: "Popular",
  },
  {
    id: "google-calendar",
    nombre: "Google Calendar",
    categoria: "calendarios",
    categoriaLabel: "Calendarios",
    tagline: "Copia tus citas y reservas confirmadas automáticamente a tu calendario personal",
    descripcion:
      "Sincroniza tus reservas con tu cuenta de Google. Cada cita creada, reprogramada o cancelada se actualiza de inmediato en tu calendario principal.",
    beneficios: [
      "Eventos con el nombre del cliente, servicio, sucursal y datos de contacto.",
      "Cifrado de tokens OAuth con estándar simétrico AES-256-GCM en reposo.",
      "Modo desacoplado seguro para operar sin interrupciones.",
    ],
    comoFunciona: "Autoriza tu cuenta de Google desde la configuración de reservas de tu sitio con un clic.",
    estado: "Disponible",
    icono: "calendar",
  },
  {
    id: "ical-universal",
    nombre: "Suscripción iCal Universal (.ics)",
    categoria: "calendarios",
    categoriaLabel: "Calendarios",
    tagline: "Feed en tiempo real para Apple Calendar, Google Calendar y Microsoft Outlook",
    descripcion:
      "Enlace iCalendar estándar RFC 5545 con token seguro por sitio y por profesional para ver tus citas en cualquier aplicación de calendario sin necesidad de cuentas de desarrollador.",
    beneficios: [
      "Compatible con iPhone, Mac, Windows, Android y web.",
      "Feed global de todo el sitio o feed personal exclusivo para cada profesional.",
      "Rotación instantánea de token en un clic si necesitas revocar accesos.",
    ],
    comoFunciona: "Copia tu URL de feed iCal desde el panel y pégala en 'Añadir calendario desde URL' en tu app preferida.",
    estado: "Disponible",
    icono: "calendar-clock",
  },
  {
    id: "zapier",
    nombre: "Zapier",
    categoria: "automatizacion",
    categoriaLabel: "Automatización",
    tagline: "Conecta Impulza One con más de 5.000 aplicaciones web",
    descripcion:
      "Dispara flujos automáticos en Zapier cada vez que un visitante envíe un formulario, confirme una reserva o realice un pedido en tu portal.",
    beneficios: [
      "Envío de notificaciones a canales de Slack, Discord o Telegram.",
      "Creación de tareas en Notion, Trello, Asana o ClickUp.",
      "Registro de contactos en CRMs como HubSpot, Salesforce o Zoho.",
    ],
    comoFunciona: "Copia tu URL de webhook de Zapier y pégala en la sección de Webhooks salientes de tu organización.",
    estado: "Disponible",
    icono: "zap",
    badge: "No-code",
  },
  {
    id: "make",
    nombre: "Make (Integromat)",
    categoria: "automatizacion",
    categoriaLabel: "Automatización",
    tagline: "Automatizaciones visuales complejas con control de condiciones y lógica",
    descripcion:
      "Integra tus eventos de conversión en escenarios visuales avanzados de Make con soporte nativo para payload JSON firmado con HMAC-SHA256.",
    beneficios: [
      "Generación automática de boletas o facturas en sistemas contables chilenos.",
      "Enrutamiento de prospectos según el rubro o servicio solicitado.",
      "Trazabilidad de entregas con reintentos automáticos exponenciales.",
    ],
    comoFunciona: "Agrega un Custom Webhook en Make y regístralo en los destinos de webhooks de tu organización.",
    estado: "Disponible",
    icono: "workflow",
  },
  {
    id: "webhooks-propios",
    nombre: "Webhooks Salientes Firmados",
    categoria: "automatizacion",
    categoriaLabel: "Automatización",
    tagline: "Eventos HTTP seguros para desarrolladores y sistemas propios",
    descripcion:
      "Transmite eventos en tiempo real hacia tus propios servidores con firma criptográfica en la cabecera `X-Impulza-Signature` y protección estricta contra SSRF.",
    beneficios: [
      "Firma HMAC-SHA256 para verificar la autenticidad de cada evento.",
      "Eventos: `contact.created`, `booking.confirmed`, `booking.cancelled`, `order.paid`.",
      "Historial de entregas, tiempo de respuesta y botón para reintentar entregas fallidas.",
    ],
    comoFunciona: "Configura tu endpoint HTTPS y clave secreta en el panel bajo 'Webhooks'.",
    estado: "Disponible",
    icono: "code",
  },
  {
    id: "google-analytics-4",
    nombre: "Google Analytics 4 (GA4)",
    categoria: "marketing",
    categoriaLabel: "Marketing y Analítica",
    tagline: "Medición de tráfico web con consentimiento estricto Ley 21.719",
    descripcion:
      "Configura tu ID de medición `G-…` para registrar visitas y eventos clave sin cargar scripts de terceros hasta que el visitante otorgue su consentimiento explícito.",
    beneficios: [
      "Banner de consentimiento de cookies configurable según la normativa chilena.",
      "Medición de eventos: vistas, envíos de formulario, reservas y pedidos con valor.",
      "Sin riesgo de violación de CSP: cabeceras de seguridad estrictas pre-configuradas.",
    ],
    comoFunciona: "Ingresa tu ID de medición en el panel de tu sitio bajo 'Integraciones de medición'.",
    estado: "Disponible",
    icono: "bar-chart",
    badge: "Consentimiento",
  },
  {
    id: "meta-pixel",
    nombre: "Píxel de Meta (Facebook e Instagram)",
    categoria: "marketing",
    categoriaLabel: "Marketing y Analítica",
    tagline: "Optimiza tus campañas de anuncios midiendo conversiones reales",
    descripcion:
      "Ingresa tu ID de píxel de Meta para medir el retorno de tus anuncios en Instagram y Facebook. Solo se activa si el visitante acepta la categoría de publicidad.",
    beneficios: [
      "Mide eventos de conversión: Lead, Schedule (reservas) y Purchase (compras).",
      "Consentimiento granular: el visitante puede aceptar analítica pero rechazar publicidad.",
      "Cumplimiento total con los estándares de privacidad y retención de datos.",
    ],
    comoFunciona: "Pega tu ID numérico de píxel en la configuración de integraciones de tu sitio.",
    estado: "Disponible",
    icono: "target",
  },
  {
    id: "whatsapp",
    nombre: "WhatsApp Business Directo",
    categoria: "comunicacion",
    categoriaLabel: "Comunicación",
    tagline: "Contacto directo en 1 toque desde cualquier página de tu portal",
    descripcion:
      "Botón flotante o bloque destacado de WhatsApp con mensaje inicial personalizado para que tus prospectos inicien una conversación de inmediato.",
    beneficios: [
      "Mensajes contextuales pre-redactados según el servicio o producto visto.",
      "Métricas propias de clics contabilizadas en la analítica de tu sitio.",
      "Smart CTA para mostrar el botón de WhatsApp solo en horario de atención comercial.",
    ],
    comoFunciona: "Agrega el bloque WhatsApp en el constructor visual e ingresa tu número con código de país.",
    estado: "Disponible",
    icono: "message-circle",
    badge: "Esencial",
  },
];
