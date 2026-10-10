// Catálogo explícito de permisos (F1.6). Solo se declaran los que ya tienen un endpoint real que
// los exige — no se inventan permisos para features de fases futuras (mismo criterio que "no
// tablas vacías" aplicado a RBAC). El modelo (Role -> RolePermission -> Permission) ya soporta
// restricciones más finas por recurso cuando haga falta; hoy el permiso se evalúa solo por rol.
export const PERMISSIONS = {
  ORGANIZATION_MEMBERS_INVITE: "organization.members.invite",
  ORGANIZATION_MEMBERS_UPDATE_ROLE: "organization.members.update_role",
  ORGANIZATION_MEMBERS_REMOVE: "organization.members.remove",
  SITE_CREATE: "site.create",
  SITE_UPDATE: "site.update",
  SITE_ARCHIVE: "site.archive",
  PAGE_MANAGE: "page.manage",
  PAGE_DELETE: "page.delete",
  THEME_MANAGE: "theme.manage",
  FORM_MANAGE: "form.manage",
  CONTACT_MANAGE: "contact.manage",
  CONTACT_DELETE: "contact.delete",
  SHORTLINK_MANAGE: "shortlink.manage",
  SUPPORT_VIEW_ALL: "support.view_all",
  MEDIA_MANAGE: "media.manage",
  BOOKING_MANAGE: "booking.manage",
  CATALOG_MANAGE: "catalog.manage",
  ORDER_MANAGE: "order.manage",
  CAMPAIGN_MANAGE: "campaign.manage",
  BILLING_MANAGE: "billing.manage",
  PAYMENTS_CONNECT: "payments.connect",
  PAYMENTS_REFUND: "payments.refund",
  WEBHOOKS_MANAGE: "webhooks.manage",
  // F9.3 (ADR-028): modo agencia.
  AGENCY_MANAGE: "agency.manage",
  AGENCY_LINK_MANAGE: "agency.link.manage",
  // F9.6c (ADR-028 s3): aprobacion antes de publicar.
  PUBLISH_APPROVE: "publish.approve",
  PUBLISH_CONFIGURE: "publish.configure",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_CATALOG: ReadonlyArray<{ key: PermissionKey; description: string }> = [
  {
    key: PERMISSIONS.ORGANIZATION_MEMBERS_INVITE,
    description: "Invitar nuevos miembros a la organización.",
  },
  {
    key: PERMISSIONS.ORGANIZATION_MEMBERS_UPDATE_ROLE,
    description: "Cambiar el rol de un miembro existente.",
  },
  {
    key: PERMISSIONS.ORGANIZATION_MEMBERS_REMOVE,
    description: "Remover a un miembro de la organización.",
  },
  {
    key: PERMISSIONS.SITE_CREATE,
    description: "Crear un sitio nuevo en la organización.",
  },
  {
    key: PERMISSIONS.SITE_UPDATE,
    description: "Editar el nombre, slug y tema de un sitio.",
  },
  {
    key: PERMISSIONS.SITE_ARCHIVE,
    description: "Archivar un sitio (deja de estar publicado).",
  },
  {
    key: PERMISSIONS.PAGE_MANAGE,
    description:
      "Crear, editar y reordenar páginas de un sitio; publicarlas y restaurar versiones de su historial (F2.6).",
  },
  {
    key: PERMISSIONS.PAGE_DELETE,
    description: "Borrar (lógicamente) y restaurar páginas de un sitio.",
  },
  {
    key: PERMISSIONS.THEME_MANAGE,
    description: "Crear y editar temas propios de la organización.",
  },
  {
    key: PERMISSIONS.FORM_MANAGE,
    description: "Crear y editar formularios y sus campos en un sitio (F3.2).",
  },
  {
    key: PERMISSIONS.CONTACT_MANAGE,
    description:
      "Editar contactos del mini-CRM: etiquetas, notas, estado comercial y asignación (F3.3).",
  },
  {
    key: PERMISSIONS.CONTACT_DELETE,
    description:
      "Eliminar un contacto en cascada (derecho de cancelación/ARCO+, ADR-004) — acción destructiva y auditada.",
  },
  {
    key: PERMISSIONS.SHORTLINK_MANAGE,
    description: "Crear y editar enlaces cortos y códigos QR de la organización (F3.5).",
  },
  {
    key: PERMISSIONS.SUPPORT_VIEW_ALL,
    description:
      "Ver todas las solicitudes de soporte de la organización, no solo las propias (F4.5). Cualquier miembro activo puede abrir una.",
  },
  {
    key: PERMISSIONS.MEDIA_MANAGE,
    description: "Subir y borrar imágenes y videos de la biblioteca de medios (PP1). Consume la cuota de almacenamiento del plan.",
  },
  {
    key: PERMISSIONS.BOOKING_MANAGE,
    description: "Gestionar la agenda: crear reservas a mano y cambiar su estado (F5.3).",
  },
  {
    key: PERMISSIONS.CATALOG_MANAGE,
    description: "Crear y editar el catálogo de productos y sus categorías (F5.5).",
  },
  {
    key: PERMISSIONS.ORDER_MANAGE,
    description: "Atender pedidos: marcarlos como pagados, entregados o cancelados (F5.5).",
  },
  {
    key: PERMISSIONS.CAMPAIGN_MANAGE,
    description: "Crear y enviar campañas de email a los contactos que aceptaron recibirlas (F5.6).",
  },
  {
    key: PERMISSIONS.BILLING_MANAGE,
    description: "Contratar, cambiar o cancelar el plan de pago y pedir reembolso por retracto (F4.6).",
  },
  {
    key: PERMISSIONS.PAYMENTS_CONNECT,
    description: "Conectar o desconectar la cuenta de Mercado Pago con que el negocio cobra a sus clientes (F5.8).",
  },
  {
    key: PERMISSIONS.PAYMENTS_REFUND,
    description: "Devolver dinero cobrado con la cuenta de Mercado Pago del negocio: pedidos y señas (F5.11).",
  },
  {
    key: PERMISSIONS.WEBHOOKS_MANAGE,
    description: "Ver y administrar los webhooks salientes (destinos, secretos, pruebas y entregas) de la organización (F7.2).",
  },
  {
    key: PERMISSIONS.AGENCY_MANAGE,
    description: "En una agencia: dar de alta, vincular, pausar, archivar y soltar clientes, y ver su estado (F9.3, ADR-028).",
  },
  {
    key: PERMISSIONS.AGENCY_LINK_MANAGE,
    description: "En un negocio: aceptar o rechazar la solicitud de una agencia y revocar su acceso en cualquier momento (F9.3, ADR-028 §2). Solo el propietario.",
  },
  {
    key: PERMISSIONS.PUBLISH_APPROVE,
    description:
      "Aprobar o rechazar las solicitudes de publicación de otras personas y publicar sin pedir aprobación cuando la organización la exige (F9.6c, ADR-028 §3).",
  },
  {
    key: PERMISSIONS.PUBLISH_CONFIGURE,
    description: "Activar o desactivar la aprobación antes de publicar de la organización (F9.6c). Solo el propietario: es la compuerta misma.",
  },
];

// Roles con cada permiso — única fuente de verdad para el seed (packages/database/prisma/seed.ts)
// y para los tests. SUPER_ADMIN es un rol de plataforma (ADR-002 §4): no gana permisos de
// organización por esta vía, opera por su propio camino de superadministración.
// EDITOR sí edita sitios (es su trabajo: contenido), pero no los crea ni los archiva — crear
// consume cupo del plan y archivar saca un sitio de producción; ambas son decisiones de
// OWNER/ADMIN. ANALYST y SUPPORT solo leen (la lectura no pasa por un permiso: basta con ser
// miembro activo de la organización) salvo lo que se detalla abajo para F3.3.
export const ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  OWNER: [
    PERMISSIONS.ORGANIZATION_MEMBERS_INVITE,
    PERMISSIONS.ORGANIZATION_MEMBERS_UPDATE_ROLE,
    PERMISSIONS.ORGANIZATION_MEMBERS_REMOVE,
    PERMISSIONS.SITE_CREATE,
    PERMISSIONS.SITE_UPDATE,
    PERMISSIONS.SITE_ARCHIVE,
    PERMISSIONS.PAGE_MANAGE,
    PERMISSIONS.PAGE_DELETE,
    PERMISSIONS.THEME_MANAGE,
    PERMISSIONS.FORM_MANAGE,
    PERMISSIONS.CONTACT_MANAGE,
    PERMISSIONS.CONTACT_DELETE,
    PERMISSIONS.SHORTLINK_MANAGE,
    PERMISSIONS.SUPPORT_VIEW_ALL,
    PERMISSIONS.MEDIA_MANAGE,
    PERMISSIONS.BOOKING_MANAGE,
    PERMISSIONS.CATALOG_MANAGE,
    PERMISSIONS.ORDER_MANAGE,
    PERMISSIONS.CAMPAIGN_MANAGE,
    // Contratar o cancelar un plan compromete dinero del negocio (F4.6, ADR-012): solo el dueño,
    // igual que dar de baja o transferir la organización.
    PERMISSIONS.BILLING_MANAGE,
    // A qué cuenta llega el dinero de las ventas es decisión del dueño (F5.8, ADR-013).
    PERMISSIONS.PAYMENTS_CONNECT,
    // Devolver dinero sale de la cuenta del negocio y no se deshace (F5.11, ADR-013): solo el dueño.
    PERMISSIONS.PAYMENTS_REFUND,
    // Los webhooks sacan datos de clientes hacia otros sistemas (F7.2, ADR-017): OWNER y ADMIN.
    PERMISSIONS.WEBHOOKS_MANAGE,
    // El propietario decide qué agencia entra a su negocio y puede revocarla (F9.3, ADR-028 §2).
    PERMISSIONS.AGENCY_LINK_MANAGE,
    PERMISSIONS.AGENCY_MANAGE,
    // La compuerta de publicación la decide el dueño; aprobar lo comparte con ADMIN (F9.6c).
    PERMISSIONS.PUBLISH_CONFIGURE,
    PERMISSIONS.PUBLISH_APPROVE,
  ],
  ADMIN: [
    PERMISSIONS.ORGANIZATION_MEMBERS_INVITE,
    PERMISSIONS.ORGANIZATION_MEMBERS_UPDATE_ROLE,
    PERMISSIONS.ORGANIZATION_MEMBERS_REMOVE,
    PERMISSIONS.SITE_CREATE,
    PERMISSIONS.SITE_UPDATE,
    PERMISSIONS.SITE_ARCHIVE,
    PERMISSIONS.PAGE_MANAGE,
    PERMISSIONS.PAGE_DELETE,
    PERMISSIONS.THEME_MANAGE,
    PERMISSIONS.FORM_MANAGE,
    PERMISSIONS.CONTACT_MANAGE,
    PERMISSIONS.CONTACT_DELETE,
    PERMISSIONS.SHORTLINK_MANAGE,
    PERMISSIONS.SUPPORT_VIEW_ALL,
    PERMISSIONS.MEDIA_MANAGE,
    PERMISSIONS.BOOKING_MANAGE,
    PERMISSIONS.CATALOG_MANAGE,
    PERMISSIONS.ORDER_MANAGE,
    // Un envío masivo sale a nombre del negocio y no se puede deshacer (F5.6): solo OWNER/ADMIN.
    PERMISSIONS.CAMPAIGN_MANAGE,
    PERMISSIONS.WEBHOOKS_MANAGE,
    PERMISSIONS.AGENCY_MANAGE,
    PERMISSIONS.PUBLISH_APPROVE,
  ],
  // EDITOR gestiona páginas (crear/editar/reordenar es su trabajo diario) pero no las borra:
  // borrar saca contenido de circulación, misma lógica que archivar un sitio. Formularios y
  // enlaces/QR son parte de ese mismo trabajo de contenido/marketing; contactos también, pero
  // sin poder eliminarlos (acción destructiva y con implicancia legal, ADR-004 — reservada a
  // OWNER/ADMIN, igual que PAGE_DELETE).
  EDITOR: [
    PERMISSIONS.SITE_UPDATE,
    PERMISSIONS.PAGE_MANAGE,
    PERMISSIONS.FORM_MANAGE,
    PERMISSIONS.CONTACT_MANAGE,
    PERMISSIONS.SHORTLINK_MANAGE,
    // Subir fotos es parte del trabajo de contenido (PP1).
    PERMISSIONS.MEDIA_MANAGE,
    // Atender la agenda del negocio (F5.3).
    PERMISSIONS.BOOKING_MANAGE,
    // Catálogo y pedidos (F5.5): contenido y atención comercial del día a día.
    PERMISSIONS.CATALOG_MANAGE,
    PERMISSIONS.ORDER_MANAGE,
  ],
  ANALYST: [],
  // SUPPORT es "soporte al cliente con acceso limitado y auditado" (seed.ts) — administrar el
  // mini-CRM es exactamente ese trabajo, sin poder borrar contactos (ARCO+ es decisión de
  // OWNER/ADMIN) ni tocar formularios/enlaces (eso es marketing/contenido, no soporte).
  // Atender la agenda (marcar asistencia, cancelar, anotar una reserva) también es atención al
  // cliente (F5.3).
  SUPPORT: [PERMISSIONS.CONTACT_MANAGE, PERMISSIONS.BOOKING_MANAGE, PERMISSIONS.ORDER_MANAGE],
  // En la agencia: gestiona su cartera de clientes (F9.3).
  AGENCY_MANAGER: [PERMISSIONS.AGENCY_MANAGE],
  // Rol DELEGADO que una agencia tiene dentro de la organización de un cliente (F9.3, ADR-028 §2). Parte del
  // de ADMIN, **sin** lo que el cliente nunca delega: gestionar su equipo (invitar, cambiar roles, remover),
  // borrar contactos (derecho de cancelación, ADR-004) y los webhooks que sacan sus datos. Tampoco tiene cobros,
  // plan ni cuenta de Mercado Pago (permisos que ADMIN ya no tiene). Los límites duros que no son un permiso
  // (exportar contactos, cuentas de cobro, equipo) los aplica `AgencyAccessPolicy` en la puerta de entrada.
  AGENCY_DELEGATE: [
    PERMISSIONS.SITE_CREATE,
    PERMISSIONS.SITE_UPDATE,
    PERMISSIONS.SITE_ARCHIVE,
    PERMISSIONS.PAGE_MANAGE,
    PERMISSIONS.PAGE_DELETE,
    PERMISSIONS.THEME_MANAGE,
    PERMISSIONS.FORM_MANAGE,
    PERMISSIONS.CONTACT_MANAGE,
    PERMISSIONS.SHORTLINK_MANAGE,
    PERMISSIONS.SUPPORT_VIEW_ALL,
    PERMISSIONS.MEDIA_MANAGE,
    PERMISSIONS.BOOKING_MANAGE,
    PERMISSIONS.CATALOG_MANAGE,
    PERMISSIONS.ORDER_MANAGE,
    PERMISSIONS.CAMPAIGN_MANAGE,
  ],
  SUPER_ADMIN: [],
};
