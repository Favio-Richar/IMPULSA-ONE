import type { StatsBlockConfig } from "@impulza/validation";
import { WideBleed } from "../ui/wide-bleed.js";

/** Cifras destacadas (F10): número grande y rótulo, en fila de dos a cuatro. */
export function StatsBlock({ config, mode = "public" }: { config: StatsBlockConfig; mode?: "public" | "preview" }) {
  return (
    <WideBleed mode={mode} size="md">
      <section aria-label={config.title ?? "Cifras"} className="flex flex-col gap-4">
        {config.title ? (
          <h2 className="text-center text-lg font-semibold tracking-wide text-[var(--site-color-foreground)]" style={{ fontFamily: "var(--site-font-heading)" }}>
            {config.title}
          </h2>
        ) : null}
        <dl className={`grid gap-3 ${config.items.length === 2 ? "grid-cols-2" : config.items.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"}`}>
          {config.items.map((item, index) => (
            <div key={index} className="flex flex-col items-center gap-1 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] px-3 py-5 text-center shadow-[var(--site-shadow)]">
              <dd className="text-3xl font-semibold tabular-nums text-[var(--site-color-foreground)]" style={{ fontFamily: "var(--site-font-heading)" }}>
                {item.value}
              </dd>
              <dt className="text-sm text-[var(--site-color-muted-foreground)]">{item.label}</dt>
            </div>
          ))}
        </dl>
      </section>
    </WideBleed>
  );
}
