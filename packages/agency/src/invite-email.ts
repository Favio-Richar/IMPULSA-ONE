import { AGENCY_OWNER_INVITE_TTL_DAYS } from "@impulza/validation";

/** Enlace con el token crudo de la invitación al propietario. El token solo existe aquí y en el correo; en la base va su huella. */
export function ownerInviteUrl(appBaseUrl: string, rawToken: string): string {
  return `${appBaseUrl.replace(/\/$/, "")}/invitaciones/agencia?token=${rawToken}`;
}

/** El correo con que una agencia invita al propietario de un cliente que acaba de crear (alta, duplicado o importación). */
export function ownerInviteEmail(input: { agencyName: string; clientName: string; inviteUrl: string }): { subject: string; text: string } {
  return {
    subject: `${input.agencyName} te invita a administrar «${input.clientName}» — Impulza One`,
    text:
      `${input.agencyName} creó el espacio de «${input.clientName}» en Impulza One y te invita a ser su propietario.\n\n` +
      `Como propietario decides quién entra: la agencia trabaja con acceso delegado y puedes revocarlo cuando quieras.\n\n` +
      `Acepta la invitación (vence en ${AGENCY_OWNER_INVITE_TTL_DAYS} días): ${input.inviteUrl}`,
  };
}
