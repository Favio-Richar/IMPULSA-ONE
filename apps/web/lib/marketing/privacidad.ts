export interface SeccionPrivacidad {
  id: string;
  titulo: string;
  parrafos: string[];
  destacados?: string[];
}

export const FECHA_VIGENCIA_PRIVACIDAD = "1 de octubre de 2026";

export const SECCIONES_PRIVACIDAD: SeccionPrivacidad[] = [
  {
    id: "responsable",
    titulo: "1. Responsable del tratamiento",
    parrafos: [
      "Impulza One (en adelante, 'Impulza One' o 'la Plataforma') es el responsable del tratamiento de los datos personales recopilados a través de nuestro sitio web comercial y de las cuentas de usuario de la plataforma SaaS.",
      "Nos comprometemos a resguardar la privacidad de nuestros usuarios y de los visitantes de sus portales, aplicando los principios de licitud, finalidad, proporcionalidad, seguridad y responsabilidad conforme a la Ley 19.628 sobre Protección de la Vida Privada y la Ley 21.719 sobre Protección de Datos Personales de la República de Chile.",
    ],
  },
  {
    id: "datos-recopilados",
    titulo: "2. Datos personales que recopilamos",
    parrafos: [
      "Tratamos únicamente los datos necesarios y proporcionales para la prestación de nuestros servicios:",
    ],
    destacados: [
      "Datos de registro y cuenta: correo electrónico, contraseña protegida con hash criptográfico Argon2id, nombre de usuario y nombre de la organización.",
      "Datos de facturación: nombre o razón social, RUT, dirección y referencias de pago suministradas por la pasarela autorizada (nunca almacenamos el número completo de tarjeta de crédito o débito).",
      "Datos técnicos y de sesión: dirección IP anonimizada mediante sal rotativa diaria por sitio (sin almacenamiento de IP cruda), tipo de dispositivo, navegador y registros de auditoría de seguridad.",
      "Comunicaciones de soporte: mensajes e información proporcionada voluntariamente a través del sistema de tickets o canales de atención.",
    ],
  },
  {
    id: "finalidades",
    titulo: "3. Finalidades del tratamiento",
    parrafos: [
      "Utilizamos tus datos personales exclusivamente para los siguientes fines legítimos:",
      "a) Proveer, operar, mantener y asegurar la plataforma Impulza One y tus sitios web publicados.",
      "b) Gestionar tu suscripción, cobros recurrentes y emisión de los documentos tributarios correspondientes ante el SII.",
      "c) Enviarte comunicaciones operativas indispensables: confirmación de cuenta, recuperación de contraseña, alertas de seguridad y recordatorios de renovación.",
      "d) Proporcionar asistencia técnica oportuna cuando abras una solicitud de soporte.",
      "e) Prevenir fraudes, abusos o accesos no autorizados a la infraestructura.",
      "Nunca vendemos, arrendamos ni comercializamos tus datos personales ni los de tus clientes con terceros con fines publicitarios.",
    ],
  },
  {
    id: "encargado-tratamiento",
    titulo: "4. Datos de clientes de tu negocio (Rol de Encargado)",
    parrafos: [
      "Cuando publicas un formulario, agenda de reservas o catálogo en Impulza One, tú actúas como Responsable del tratamiento respecto de los datos personales de tus clientes finales (nombre, correo, teléfono, notas de reserva o pedidos), e Impulza One actúa exclusivamente como Encargado del tratamiento en tu nombre.",
      "Tus datos de contactos y clientes te pertenecen exclusivamente. Impulza One no utiliza los datos de tus clientes para sus propios fines ni para contactarlos directamente, salvo el envío estrictamente técnico de confirmaciones y enlaces de gestión solicitados por la funcionalidad de tu sitio.",
      "Proporcionamos herramientas para que puedas atender solicitudes de acceso, rectificación o eliminación de tus clientes en tu panel de mini-CRM en cualquier momento.",
    ],
  },
  {
    id: "seguridad",
    titulo: "5. Seguridad y cifrado de la información",
    parrafos: [
      "Implementamos medidas técnicas y organizativas de nivel bancario e industrial para salvaguardar la confidencialidad, integridad y disponibilidad de la información:",
    ],
    destacados: [
      "Aislamiento multi-tenant estricto: separación lógica garantizada en base de datos para que ninguna organización pueda acceder o modificar datos de otra.",
      "Cifrado en tránsito y en reposo: todas las conexiones operan bajo HTTPS con TLS 1.3. Las credenciales sensibles y tokens OAuth (como Google Calendar o Mercado Pago) se cifran en reposo con el algoritmo simétrico AES-256-GCM.",
      "Contraseñas seguras: uso de la función de derivación de claves Argon2id, el estándar criptográfico moderno más resistente contra ataques de fuerza bruta.",
      "Enlaces firmados HMAC-SHA256: las gestiones públicas de reservas, pedidos y bajas de correo se autorizan con tokens criptográficos efímeros sin exponer identificadores internos.",
    ],
  },
  {
    id: "cookies-analitica",
    titulo: "6. Cookies y tecnologías de medición",
    parrafos: [
      "Nuestra analítica nativa está diseñada desde el origen bajo el principio de privacidad por diseño (ADR-004):",
      "No utilizamos cookies invasivas de seguimiento ni rastreo entre sitios para las estadísticas de visitas y clics de la plataforma.",
      "Para herramientas de terceros como Google Analytics 4 o el Píxel de Meta que agregues a tu sitio, exigimos el consentimiento previo e informado del visitante mediante un banner accesible con opciones de Aceptar y Rechazar con el mismo peso visual, conforme a las directrices de la Ley 21.719.",
    ],
  },
  {
    id: "retencion",
    titulo: "7. Conservación y eliminación de datos",
    parrafos: [
      "Conservamos tus datos mientras mantengas tu cuenta activa en la plataforma. Si decides cancelar tu cuenta y solicitar su eliminación definitiva, procederemos a borrar de forma segura todos tus sitios, páginas, bloques y bases de contactos, salvo aquellos antecedentes contables o tributarios que deban ser retenidos por exigencia legal durante los plazos establecidos por el Código de Comercio y la legislación tributaria chilena.",
    ],
  },
  {
    id: "derechos-arco",
    titulo: "8. Derechos de los titulares (ARCO y portabilidad)",
    parrafos: [
      "Como titular de datos personales, tienes derecho a:",
      "• Acceso: conocer qué datos personales tuyos estamos tratando.",
      "• Rectificación: solicitar la corrección de datos inexactos o incompletos.",
      "• Cancelación / Supresión: pedir la eliminación de tus datos cuando hayan dejado de ser necesarios para las finalidades informadas.",
      "• Oposición: oponerte al tratamiento de tus datos para situaciones específicas justificadas.",
      "• Portabilidad: obtener una copia de tus datos en un formato estructurado y de uso común.",
      "Puedes ejercer estos derechos directamente desde las opciones de configuración de tu panel de usuario o enviando una solicitud formal a nuestro canal de privacidad.",
    ],
  },
  {
    id: "contacto-privacidad",
    titulo: "9. Canal de contacto de privacidad",
    parrafos: [
      "Para cualquier duda, solicitud o ejercicio de derechos relacionados con la protección de tus datos personales, puedes escribirnos a través del módulo de Soporte en tu panel o al correo de privacidad institucional de Impulza One.",
      "Responderemos a tus requerimientos dentro de los plazos legales establecidos por la normativa chilena.",
    ],
  },
];
