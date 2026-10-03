import type { PrismaClient } from "@impulza/database";
import {
  brandEmail,
  resolveOrganizationBrand,
  type BrandableEmail,
  type PlatformBrandRow,
} from "@impulza/validation";
import { logger } from "./observability/logger.js";

/**
 * Marca de la organización para los correos que el worker envía a los clientes del negocio (recordatorios de
 * reserva, avisos de seña, campañas y secuencias; F9.2 criterio 4b). La regla de la cascada es la misma que
 * usa la API (`resolveOrganizationBrand` en `@impulza/validation`): acá solo se aportan los datos.
 *
 * **Nunca lanza**: si no se puede resolver la marca, el correo sale tal cual. Una marca que falla no puede
 * dejar a un cliente sin su recordatorio.
 */
export async function brandOrganizationEmail<T extends BrandableEmail>(
  prisma: Pick<PrismaClient, "brandProfile" | "platformBranding">,
  organizationId: string,
  message: T,
): Promise<T> {
  try {
    const brand = await resolveOrganizationBrand(
      {
        organization: (id) =>
          prisma.brandProfile.findUnique({
            where: { organizationId: id },
            select: {
              displayName: true,
              logoLightUrl: true,
              logoDarkUrl: true,
              faviconUrl: true,
              primaryColor: true,
              secondaryColor: true,
              contactEmail: true,
            },
          }),
        platform: async (): Promise<PlatformBrandRow | null> =>
          prisma.platformBranding.findFirst({
            orderBy: { createdAt: "asc" },
            select: { name: true, logoLightUrl: true, logoDarkUrl: true, faviconUrl: true, primaryColor: true, secondaryColor: true },
          }),
      },
      organizationId,
    );
    return brandEmail(message, brand);
  } catch (error) {
    logger.warn("brand.email_failed", { organizationId, err: error });
    return message;
  }
}
