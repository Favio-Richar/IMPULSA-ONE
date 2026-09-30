import { detectDeviceType } from "@impulza/analytics";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { PageBlocks } from "@impulza/blocks-renderer";
import type { PublicFormResponse } from "@impulza/contracts";
import { AB_BUCKET_COOKIE, parseAbBucket, themeTokensSchema } from "@impulza/validation";
import { hasExperiments, randomAbBucket, resolveExperimentBlocks } from "../lib/ab";
import { getBookingAvailable, getPublicForm, getPublicPage, getPublicSite } from "../lib/api";
import { applySmartCta, smartCtaNeedsBookings } from "../lib/smart-cta";
import { AbBucketCookie } from "./ab-bucket-cookie";
import { AnalyticsTracker } from "./analytics-tracker";
import { Measurement } from "./measurement";

/** Todo bloque `contact_form` con un `formId` real, sin duplicados: varios bloques pueden apuntar
 *  al mismo formulario en la misma página. */
function formIdsReferencedBy(blocks: { type: string; config: unknown }[]): string[] {
  const ids = new Set<string>();
  for (const block of blocks) {
    if (block.type !== "contact_form") continue;
    const formId = (block.config as { formId?: unknown } | null)?.formId;
    if (typeof formId === "string") ids.add(formId);
  }
  return [...ids];
}

/**
 * Cuerpo compartido de la home (`app/[siteSlug]/page.tsx`) y de cualquier otra página
 * (`app/[siteSlug]/[pageSlug]/page.tsx`) — la única diferencia entre ambas rutas es qué slug de
 * página le pasan acá; todo lo demás (buscar la página, 404 si no está publicada, pintar sus
 * bloques con el tema del sitio) es exactamente el mismo trabajo.
 */
/** Campaña de la visita (F6.6): solo `utm_source` y `utm_campaign`, el primer valor de cada una. */
export function utmFrom(searchParams: Record<string, string | string[] | undefined>): { source: string | null; campaign: string | null } {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.slice(0, 120) ?? null;
  return { source: first(searchParams.utm_source), campaign: first(searchParams.utm_campaign) };
}

export async function SitePage({
  siteSlug,
  pageSlug,
  utm = { source: null, campaign: null },
}: {
  siteSlug: string;
  pageSlug: string;
  utm?: { source: string | null; campaign: string | null };
}) {
  const [site, page] = await Promise.all([
    getPublicSite(siteSlug),
    getPublicPage(siteSlug, pageSlug),
  ]);

  // El layout ya llama a `getPublicSite` y hace `notFound()` si el sitio no existe (deduplicado,
  // no es una segunda petición) — acá solo falta comprobar la página en sí.
  if (!site || !page) {
    notFound();
  }

  const tokens = themeTokensSchema.parse(site.theme.tokens);

  // F3.2: se resuelve el formulario real de cada bloque `contact_form` en el servidor — el
  // visitante nunca llama a `apps/api` directamente (mismo principio que el resto de este
  // archivo); el bloque recibe los datos ya listos, no una URL para ir a buscarlos.
  const formIds = formIdsReferencedBy(page.blocks);
  const resolvedForms = await Promise.all(formIds.map((formId) => getPublicForm(siteSlug, formId)));
  const forms = Object.fromEntries(
    formIds
      .map((formId, index) => [formId, resolvedForms[index]] as const)
      .filter((entry): entry is [string, PublicFormResponse] => entry[1] !== null),
  );

  // F6.5: con una prueba A/B en curso, la variante se elige acá con el grupo del visitante (o uno
  // nuevo, que se guarda al montar). Sin pruebas no se lee ni se crea ninguna cookie.
  const experimenting = hasExperiments(page.blocks);
  const storedBucket = experimenting ? parseAbBucket((await cookies()).get(AB_BUCKET_COOKIE)?.value) : null;
  const bucket = experimenting ? (storedBucket ?? randomAbBucket()) : null;
  const tested = bucket === null ? page.blocks : resolveExperimentBlocks(page.blocks, bucket);

  // F6.6: la acción principal de esta visita según las reglas de Smart CTA (hora real del negocio,
  // dispositivo, campaña). "¿Quedan reservas?" solo se consulta si alguna regla lo necesita.
  const blocks = page.smartCta
    ? applySmartCta(tested, page.smartCta, {
        now: new Date(),
        device: detectDeviceType((await headers()).get("user-agent")),
        utm,
        bookingsAvailable: smartCtaNeedsBookings(page.smartCta) ? await getBookingAvailable(siteSlug) : null,
      })
    : tested;

  return (
    <>
      {bucket !== null && storedBucket === null ? <AbBucketCookie bucket={bucket} /> : null}
      <AnalyticsTracker siteSlug={siteSlug} pageSlug={page.slug} />
      <PageBlocks
        blocks={blocks}
        buttonStyle={tokens.buttonStyle}
        siteSlug={siteSlug}
        forms={forms}
        mode="public"
      />
      {/* F7.1 (ADR-016): solo si el sitio tiene medición de terceros; nada se carga sin consentimiento. */}
      {site.measurement && (site.measurement.ga4MeasurementId || site.measurement.metaPixelId) ? (
        <Measurement
          siteSlug={siteSlug}
          siteName={site.name}
          ga4MeasurementId={site.measurement.ga4MeasurementId}
          metaPixelId={site.measurement.metaPixelId}
        />
      ) : null}
    </>
  );
}
