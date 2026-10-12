import { publicMarketplaceResponse, type MarketplaceListingPublicResponse } from "@impulza/contracts";
import { MARKETPLACE_KIND_LABELS, type MarketplaceKind } from "@impulza/validation";
import { env } from "../../lib/env";
import { fetchUpstream } from "../../lib/upstream";

/** Publicaciones aprobadas del marketplace (F10.6), sin caché: una aprobación o un retiro se ve en el acto. Ante una falla de la API, la sección muestra su estado vacío. */
async function loadListings(): Promise<MarketplaceListingPublicResponse[]> {
  const response = await fetchUpstream("marketplace-directory", `${env.API_BASE_URL}/public/marketplace`, {
    headers: { "X-Requested-With": "impulza-one" },
    cache: "no-store",
  });
  if (!response || !response.ok) return [];
  const parsed = publicMarketplaceResponse.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.items : [];
}

/** Integraciones y plantillas de socios, revisadas por la plataforma. Solo lo aprobado llega aquí. */
export async function MarketplacePartners({ loginHref }: { loginHref: string }) {
  const items = await loadListings();
  return (
    <section aria-labelledby="socios-titulo" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <h2 id="socios-titulo" className="text-2xl font-semibold tracking-tight text-[#0f172a]">
        De nuestros socios
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-[#475569]">
        Plantillas e integraciones publicadas por socios y revisadas por Impulza One. Se instalan y se quitan desde el panel, cuando quieras.
      </p>
      {items.length === 0 ? (
        <p className="mt-6 rounded-lg border border-[#e2e8f0] p-4 text-sm text-[#475569]">
          Pronto habrá integraciones y plantillas de socios.{" "}
          <a href={loginHref} className="font-medium text-[#0f6f6b] underline underline-offset-2">
            Entra a tu panel
          </a>{" "}
          para publicar la tuya.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 rounded-xl border border-[#e2e8f0] bg-white p-5">
              <p className="text-xs font-medium text-[#0f6f6b]">
                {MARKETPLACE_KIND_LABELS[item.kind as MarketplaceKind]} · v{item.version}
              </p>
              <h3 className="text-base font-semibold text-[#0f172a]">{item.name}</h3>
              <p className="text-sm text-[#475569]">{item.summary}</p>
              <p className="mt-auto pt-2 text-xs text-[#64748b]">
                Por{" "}
                {item.partnerUrl ? (
                  <a href={item.partnerUrl} rel="noopener noreferrer nofollow" className="underline underline-offset-2">
                    {item.partnerName}
                  </a>
                ) : (
                  item.partnerName
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
