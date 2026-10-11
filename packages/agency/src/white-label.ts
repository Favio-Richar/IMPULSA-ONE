import { AgencyClientStatus, OrganizationKind, type Prisma, type PrismaClient } from "@impulza/database";
import type { WhiteLabelBrandRow } from "@impulza/validation";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * La marca blanca que aplica a una organización (F9.7a, ADR-028 §4), o `null`. Solo aplica si:
 * - la organización es cliente de una agencia con la relación vigente: **ACTIVE**, o creada por la agencia y aún sin aceptar (si termina, se
 *   pausa o se archiva, vuelve sola a la marca de la plataforma);
 * - la agencia activó la marca blanca para ESE cliente (`whiteLabelEnabled`);
 * - la organización dueña de la marca sigue siendo una agencia y tiene un nombre de marca configurado.
 * Una sola lectura, compartida por la API y el worker: ningún proceso decide por su cuenta.
 */
export async function loadWhiteLabelBrand(db: Db, clientOrganizationId: string): Promise<WhiteLabelBrandRow | null> {
  const relation = await db.agencyClient.findFirst({
    where: {
      clientOrganizationId,
      // Activa, o creada por la agencia y aún sin aceptar el propietario (la agencia ya trabaja ahí, igual que en F9.3).
      OR: [{ status: AgencyClientStatus.ACTIVE }, { status: AgencyClientStatus.INVITED, agencyCreated: true }],
      whiteLabelEnabled: true,
      agencyOrganization: { kind: OrganizationKind.AGENCY, whiteLabel: { is: { displayName: { not: null } } } },
    },
    orderBy: { createdAt: "asc" },
    select: {
      agencyOrganization: {
        select: {
          id: true,
          name: true,
          whiteLabel: {
            select: {
              displayName: true,
              logoLightUrl: true,
              logoDarkUrl: true,
              faviconUrl: true,
              primaryColor: true,
              secondaryColor: true,
              supportEmail: true,
              footerText: true,
            },
          },
        },
      },
    },
  });
  const settings = relation?.agencyOrganization.whiteLabel;
  if (!relation || !settings) return null;
  return {
    displayName: settings.displayName,
    logoLightUrl: settings.logoLightUrl,
    logoDarkUrl: settings.logoDarkUrl,
    faviconUrl: settings.faviconUrl,
    primaryColor: settings.primaryColor,
    secondaryColor: settings.secondaryColor,
    contactEmail: settings.supportEmail,
    footerText: settings.footerText,
    agencyName: relation.agencyOrganization.name,
    agencyOrganizationId: relation.agencyOrganization.id,
    // Un remitente propio exige un dominio verificado (ADR-028 §5); hasta que F9.7d lo aporte, el correo sale con el remitente de la plataforma.
    senderEmail: null,
  };
}
