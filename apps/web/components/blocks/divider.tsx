import type { DividerBlockConfig } from "@impulza/validation";

const SIZE_CLASSES: Record<DividerBlockConfig["size"], string> = {
  sm: "my-2",
  md: "my-4",
  lg: "my-8",
};

export function DividerBlock({ config }: { config: DividerBlockConfig }) {
  if (config.style === "space") {
    return <div className={SIZE_CLASSES[config.size]} aria-hidden="true" />;
  }

  return (
    <hr className={`border-t border-[var(--site-color-border)] ${SIZE_CLASSES[config.size]}`} />
  );
}
