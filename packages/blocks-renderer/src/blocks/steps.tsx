import type { StepsBlockConfig } from "@impulza/validation";
import { WideBleed } from "../ui/wide-bleed.js";

/** Pasos numerados (F10): «Cómo trabajo», «Cómo reservar»… */
export function StepsBlock({ config, mode = "public" }: { config: StepsBlockConfig; mode?: "public" | "preview" }) {
  return (
    <WideBleed mode={mode} size="lg">
      <section aria-label={config.title ?? "Pasos"} className="flex flex-col gap-4">
        {config.title ? (
          <h2 className="text-center text-xl font-semibold tracking-wide text-[var(--site-color-foreground)]" style={{ fontFamily: "var(--site-font-heading)" }}>
            {config.title}
          </h2>
        ) : null}
        <ol className={`grid gap-3 ${config.items.length >= 4 ? "sm:grid-cols-2" : config.items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {config.items.map((item, index) => (
            <li key={index} className="flex gap-4 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] p-4 shadow-[var(--site-shadow)]">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--site-color-primary)] text-base font-semibold text-[var(--site-color-primary-foreground)]"
              >
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="text-base font-semibold text-[var(--site-color-foreground)]">
                  <span className="sr-only">Paso {index + 1}: </span>
                  {item.title}
                </h3>
                <p className="text-sm text-[var(--site-color-muted-foreground)]">{item.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </WideBleed>
  );
}
