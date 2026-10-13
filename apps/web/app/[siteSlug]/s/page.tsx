import { Container } from "@impulza/blocks-renderer";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FreeSubscribeForm } from "../../../components/subscribe-forms";
import { PlanList } from "../../../components/member-gate";
import { getMemberPlans } from "../../../lib/memberships";
import { getSubscribePage } from "../../../lib/subscribe";

// Página de suscripción del sitio (extra F10): la personaliza el negocio y ahí la persona se suscribe gratis o con un plan de
// pago. Es a donde lleva el botón «Suscribirme» del portal. Sin caché: el negocio puede cambiarla o apagarla.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ siteSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { siteSlug } = await params;
  const page = await getSubscribePage(siteSlug);
  if (!page || page === "unavailable") return { title: "Suscripción", robots: { index: false } };
  return { title: `${page.title} · ${page.siteName}`, ...(page.description ? { description: page.description } : {}) };
}

const SECTION = "flex flex-col gap-4 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] p-5 shadow-[var(--site-shadow)]";

export default async function SubscribePage({ params }: Props) {
  const { siteSlug } = await params;
  const [page, plans] = await Promise.all([getSubscribePage(siteSlug), getMemberPlans(siteSlug)]);
  if (page === null) notFound();
  if (page === "unavailable") {
    return (
      <Container className="py-8">
        <p role="status" className="text-sm text-[var(--site-color-muted-foreground)]">
          No pudimos cargar esta página ahora. Intenta de nuevo en un momento.
        </p>
      </Container>
    );
  }

  const paid = plans.checkoutAvailable && plans.plans.length > 0 && plans.providers.length > 0;
  const nothing = !page.freeEnabled && !paid;

  return (
    <Container className="flex flex-col gap-6 py-8">
      <a href={`/${siteSlug}`} className="text-sm text-[var(--site-color-link)] underline-offset-2 hover:underline">
        ← Volver a {page.siteName}
      </a>

      <header className="flex flex-col gap-3">
        {page.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={page.imageUrl} alt="" className="aspect-[16/9] w-full rounded-[var(--site-radius)] border border-[var(--site-color-border)] object-cover" />
        ) : null}
        <h1 className="text-2xl font-semibold text-[var(--site-color-foreground)]" style={{ fontFamily: "var(--site-font-heading)" }}>
          {page.title}
        </h1>
        {page.description ? <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--site-color-foreground)]">{page.description}</p> : null}
      </header>

      {page.benefits.length > 0 ? (
        <section aria-labelledby="beneficios" className="flex flex-col gap-3">
          <h2 id="beneficios" className="text-base font-semibold text-[var(--site-color-foreground)]">
            Qué recibes
          </h2>
          <ul className="flex flex-col gap-2">
            {page.benefits.map((benefit) => (
              <li key={benefit} className="flex items-start gap-2 text-sm text-[var(--site-color-foreground)]">
                <span aria-hidden="true" className="mt-0.5 font-semibold text-[var(--site-color-primary)]">
                  ✓
                </span>
                {benefit}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {page.freeEnabled ? (
        <section aria-labelledby="suscripcion-gratis" className={SECTION}>
          <h2 id="suscripcion-gratis" className="text-base font-semibold text-[var(--site-color-foreground)]">
            {paid ? "Suscripción gratuita" : "Suscríbete"}
          </h2>
          <FreeSubscribeForm siteSlug={siteSlug} siteName={page.siteName} />
        </section>
      ) : null}

      {paid ? (
        <section aria-label="Planes de pago" className={SECTION}>
          <PlanList siteSlug={siteSlug} plans={plans.plans} providers={plans.providers} renew={false} />
        </section>
      ) : null}

      {nothing ? (
        <p role="status" className="rounded-[var(--site-radius)] border border-[var(--site-color-border)] p-4 text-sm text-[var(--site-color-muted-foreground)]">
          Las suscripciones de {page.siteName} todavía no están abiertas. Vuelve pronto.
        </p>
      ) : null}
    </Container>
  );
}
