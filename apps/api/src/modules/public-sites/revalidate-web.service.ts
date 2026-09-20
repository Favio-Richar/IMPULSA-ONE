import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@impulza/database";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";

const REVALIDATE_TIMEOUT_MS = 3000;

/**
 * Avisa a `apps/web` que el contenido público de un sitio cambió, para que invalide su caché de
 * inmediato (F2.7, "invalidación solo al publicar, no por tiempo arbitrario"). `apps/web` corre
 * como un proceso Next.js separado — `revalidateTag()` solo se puede llamar desde **dentro** de
 * ese proceso, así que la única vía es este webhook: el mismo patrón que cualquier CMS headless
 * usa para invalidar un frontend Next.js aparte (ver `apps/web/app/api/revalidate/route.ts`).
 *
 * La base de datos, no la caché, es la fuente de verdad: si `apps/web` está caído o el aviso
 * falla, publicar/restaurar **no** debe fallar por eso — se registra el error y se sigue. El peor
 * caso es que el sitio se vea desactualizado hasta la próxima publicación exitosa, que es un costo
 * aceptable frente a que el panel deje de poder publicar porque el sitio público no responde.
 */
@Injectable()
export class RevalidateWebService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async revalidateSite(siteId: string): Promise<void> {
    if (!env.WEB_APP_URL || !env.WEB_REVALIDATE_SECRET) {
      // Sin configurar a propósito en algunos entornos (dev local sin apps/web arriba, o antes de
      // desplegarlo) — no es un error, es un no-op documentado (mismo criterio que SENTRY_DSN).
      return;
    }

    // apps/web nunca conoce ids internos (el contrato público es deliberadamente mínimo, F2.7):
    // lo único que puede usar para identificar el sitio en su propia caché es el slug, que es lo
    // mismo que ya usó para pedirlo. Se resuelve acá, no se le pide al llamador que lo cargue.
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { slug: true } });
    if (!site) {
      return;
    }

    try {
      const response = await fetch(new URL("/api/revalidate", env.WEB_APP_URL), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-revalidate-secret": env.WEB_REVALIDATE_SECRET,
        },
        body: JSON.stringify({ siteSlug: site.slug }),
        signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.warn("El webhook de invalidación de apps/web respondió con error", {
          siteSlug: site.slug,
          status: response.status,
        });
      }
    } catch (error) {
      logger.error("No se pudo avisar a apps/web para invalidar la caché pública", {
        siteSlug: site.slug,
        error,
      });
    }
  }
}
