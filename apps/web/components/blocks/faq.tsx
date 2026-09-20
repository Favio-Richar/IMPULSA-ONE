import type { FaqBlockConfig } from "@impulza/validation";
import { RichText } from "../ui/rich-text";

/**
 * `<details>/<summary>` nativos: acordeón accesible por teclado y lector de pantalla sin una
 * línea de JavaScript — el navegador ya implementa el patrón ARIA `disclosure` correctamente.
 */
export function FaqBlock({ config }: { config: FaqBlockConfig }) {
  return (
    <div>
      {config.title ? (
        <h2 className="mb-4 text-lg font-semibold text-[var(--site-color-foreground)]">{config.title}</h2>
      ) : null}
      <div className="flex flex-col divide-y divide-[var(--site-color-border)] rounded-[var(--site-radius)] border border-[var(--site-color-border)]">
        {config.items.map((item, index) => (
          <details key={index} className="group p-4">
            <summary className="cursor-pointer list-none font-medium text-[var(--site-color-foreground)] marker:content-none">
              <span className="flex items-center justify-between gap-3">
                {item.question}
                <span className="shrink-0 text-[var(--site-color-muted-foreground)] transition-transform group-open:rotate-45">
                  +
                </span>
              </span>
            </summary>
            <div className="pt-3">
              <RichText html={item.answer} className="text-sm" />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
