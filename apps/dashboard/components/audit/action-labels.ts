/**
 * Cómo se llama cada acción de la auditoría en pantalla. El código estable (`page.published`) es lo que filtra y exporta el servidor; esto
 * solo lo hace legible. Lo que no está en el mapa se arma con el recurso y el verbo (`booking.service_created` → «Reservas: servicio creado»),
 * y si tampoco se entiende, se muestra el código tal cual.
 */

const EXACT: Record<string, string> = {
  "page.published": "Publicó una página",
  "page.version_restored": "Restauró una versión de una página",
  "page.created": "Creó una página",
  "page.updated": "Editó una página",
  "page.deleted": "Envió una página a la papelera",
  "page.restored": "Recuperó una página de la papelera",
  "page.template_applied": "Aplicó una plantilla a una página",
  "publish_request.created": "Pidió aprobación para publicar",
  "publish_request.approved": "Aprobó una publicación",
  "publish_request.rejected": "Rechazó una publicación",
  "publish_request.cancelled": "Canceló una solicitud de publicación",
  "publish_settings.updated": "Cambió la aprobación antes de publicar",
  "custom_role.created": "Creó un rol personalizado",
  "custom_role.updated": "Editó un rol personalizado",
  "custom_role.deleted": "Borró un rol personalizado",
  "membership.invited": "Invitó a una persona",
  "membership.removed": "Quitó a una persona del equipo",
  "membership.role_changed": "Cambió el rol de una persona",
  "agency.member_scope_changed": "Cambió el acceso de alguien de la agencia",
  "agency.enabled": "Activó el modo agencia",
  "agency.link.created": "Vinculó una agencia con un negocio",
  "agency.link.requested": "Pidió acceso a un negocio",
  "agency.client.created": "Dio de alta a un cliente",
  "agency.client.duplicated": "Duplicó un cliente",
  "agency.import.created": "Importó clientes desde un archivo",
  "audit.exported": "Exportó la auditoría",
  "site.created": "Creó un sitio",
  "site.updated": "Editó un sitio",
  "site.archived": "Archivó un sitio",
  "site.theme_changed": "Cambió el tema de un sitio",
  "site.background_changed": "Cambió el fondo de un sitio",
  "organization.created": "Creó la organización",
  "org.brand_profile_updated": "Cambió la marca de la organización",
  "contact.exported": "Exportó contactos",
  "contact.deleted": "Eliminó un contacto",
  "domain.added": "Agregó un dominio",
  "domain.verified": "Verificó un dominio",
  "domain.removed": "Quitó un dominio",
};

const RESOURCE: Record<string, string> = {
  block: "Bloques",
  booking: "Reservas",
  campaign: "Campañas",
  catalog: "Catálogo",
  contact: "Contactos",
  coupon: "Cupones",
  email_sequence: "Secuencias",
  form: "Formularios",
  funnel: "Embudos",
  media: "Medios",
  order: "Pedidos",
  page_campaign: "Modo campaña",
  payments: "Cobros",
  qr_code: "Códigos QR",
  short_link: "Enlaces cortos",
  automation: "Automatizaciones",
  billing: "Facturación",
  support: "Soporte",
};

const VERB: Record<string, string> = {
  created: "creado",
  updated: "editado",
  deleted: "borrado",
  cancelled: "cancelado",
  duplicated: "duplicado",
  reordered: "reordenado",
  exported: "exportado",
  removed: "quitado",
};

export function actionLabel(action: string): string {
  const exact = EXACT[action];
  if (exact) return exact;
  const [resource, rest] = action.split(".", 2);
  const noun = resource ? RESOURCE[resource] : undefined;
  if (!noun || !rest) return action;
  const parts = rest.split("_");
  const verb = VERB[parts[parts.length - 1] ?? ""];
  if (!verb) return action;
  const what = parts.slice(0, -1).join(" ");
  return `${noun}: ${what ? `${what} ` : ""}${verb}`;
}
