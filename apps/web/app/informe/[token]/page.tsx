import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSharedReport } from "../../../lib/shared-report";

// Informe compartido por enlace (F9.8b). El enlace es una credencial: nunca se indexa, nunca se cachea y no manda referer. Solo cifras
// agregadas del negocio; sin datos personales de contactos.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Informe",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const number = new Intl.NumberFormat("es-CL");
const percent = new Intl.NumberFormat("es-CL", { style: "percent", maximumFractionDigits: 1 });

function dayText(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("es-CL", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
}

function Delta({ delta, available }: { delta: { base: number | null; change: number | null; ratio: number | null }; available: boolean }) {
  if (!available || delta.base === null || delta.change === null) return <span>No disponible</span>;
  const sign = delta.change > 0 ? "+" : "";
  const label = delta.ratio === null ? (delta.change > 0 ? "Nuevo" : "0 %") : `${sign}${percent.format(delta.ratio)}`;
  return (
    <span>
      <strong>{label}</strong>
      <span style={{ display: "block", fontSize: "0.75rem", opacity: 0.75 }}>
        antes {number.format(delta.base)} ({sign}
        {number.format(delta.change)})
      </span>
    </span>
  );
}

export default async function InformePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = await getSharedReport(token);
  if (shared === null) notFound();
  if (shared === "gone" || shared === "unavailable") {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">{shared === "gone" ? "Este enlace ya no está disponible" : "No pudimos cargar el informe"}</h1>
        <p className="mt-2 text-sm">
          {shared === "gone"
            ? "Fue revocado o venció. Pide a quien te lo compartió un enlace nuevo."
            : "Intenta de nuevo en un momento."}
        </p>
      </main>
    );
  }

  const { report, brand, expiresAt } = shared;
  const csvHref = `/informe/${encodeURIComponent(token)}/csv`;
  const currency = report.currency;
  const money = (value: number) =>
    currency ? new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: 0 }).format(value) : number.format(value);

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-8" data-testid="shared-report">
      <header className="flex flex-wrap items-center gap-3 border-b pb-4" style={{ borderColor: brand.primaryColor }}>
        {brand.logoLightUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoLightUrl} alt={brand.displayName} className="h-10 max-w-[200px] object-contain" />
        ) : null}
        <div>
          <h1 className="text-xl font-semibold">{brand.displayName}</h1>
          <p className="text-sm opacity-75">
            Informe del {dayText(report.period.from)} al {dayText(report.period.to)}
          </p>
        </div>
      </header>

      <section className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm" data-testid="shared-report-metrics">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-3 font-medium">Métrica</th>
              <th className="py-2 pr-3 text-right font-medium">Periodo</th>
              <th className="py-2 pr-3 font-medium">vs. periodo anterior</th>
              <th className="py-2 font-medium">vs. año anterior</th>
            </tr>
          </thead>
          <tbody>
            {report.metrics.map((metric) => (
              <tr key={metric.key} className="border-b" data-metric={metric.key}>
                <td className="py-2 pr-3">{metric.label}</td>
                <td className="py-2 pr-3 text-right font-medium tabular-nums">{metric.key === "revenue" ? money(metric.value) : number.format(metric.value)}</td>
                <td className="py-2 pr-3">
                  <Delta delta={metric.previous} available={report.comparison.previousAvailable} />
                </td>
                <td className="py-2">
                  <Delta delta={metric.lastYear} available={report.comparison.lastYearAvailable} />
                </td>
              </tr>
            ))}
            <tr data-metric="conversion">
              <td className="py-2 pr-3">Conversión (contactos / visitantes)</td>
              <td className="py-2 pr-3 text-right font-medium tabular-nums">{report.conversion.value === null ? "—" : percent.format(report.conversion.value)}</td>
              <td className="py-2 pr-3">{report.conversion.previous === null ? "—" : percent.format(report.conversion.previous)}</td>
              <td className="py-2">{report.conversion.lastYear === null ? "—" : percent.format(report.conversion.lastYear)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {report.topBlocks.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-base font-semibold">Bloques con más clics</h2>
          <ol className="mt-2 divide-y text-sm">
            {report.topBlocks.map((block) => (
              <li key={block.id} className="flex justify-between gap-3 py-2">
                <span>
                  {block.label ?? block.kind ?? "Bloque eliminado"}
                  {block.detail ? <span className="opacity-75"> · {block.detail}</span> : null}
                </span>
                <span className="font-medium tabular-nums">{number.format(block.value)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs opacity-75">
        <span>
          Generado el {new Date(report.generatedAt).toLocaleString("es-CL")} · Este enlace vence el {new Date(expiresAt).toLocaleDateString("es-CL")}.
        </span>
        <a href={csvHref} className="underline print:hidden" download>
          Descargar CSV
        </a>
      </footer>
    </main>
  );
}
