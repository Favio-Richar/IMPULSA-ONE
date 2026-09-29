import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { PageBlocks } from "@impulza/blocks-renderer";
import type { PublicFormResponse } from "@impulza/contracts";
import { AB_BUCKET_COOKIE, parseAbBucket, themeTokensSchema } from "@impulza/validation";
import { hasExperiments, randomAbBucket, resolveExperimentBlocks } from "../lib/ab";
import { getPublicForm, getPublicPage, getPublicSite } from "../lib/api";
import { AbBucketCookie } from "./ab-bucket-cookie";
import { AnalyticsTracker } from "./analytics-tracker";

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
export async function SitePage({ siteSlug, pageSlug }: { siteSlug: string; pageSlug: string }) {
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
  const blocks = bucket === null ? page.blocks : resolveExperimentBlocks(page.blocks, bucket);

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
    </>
  );
}
