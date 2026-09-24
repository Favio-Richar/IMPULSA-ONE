"use client";

import { PageBlocks } from "@impulza/blocks-renderer";
import type { BlockResponse } from "@impulza/contracts";
import { themeTokensSchema, themeTokensToCssVariables } from "@impulza/validation";
import { Button } from "@impulza/ui";
import { Laptop, Smartphone, Tablet } from "lucide-react";
import { useState } from "react";
import type { CSSProperties } from "react";

const DEVICES = {
  mobile: { label: "Móvil", icon: Smartphone, width: "375px" },
  tablet: { label: "Tablet", icon: Tablet, width: "768px" },
  desktop: { label: "Escritorio", icon: Laptop, width: "100%" },
} as const;

type Device = keyof typeof DEVICES;

/** Vista previa protagonista del constructor (PM §9.2, F2.9): pinta los bloques con
 *  `PageBlocks`, el mismo componente que usa el render público (F2.7) — lo que se ve acá es
 *  exactamente lo que vería un visitante si se publicara ahora, no una aproximación aparte. Solo
 *  los bloques visibles y sanos entran, igual que filtra el render público. */
export function PreviewPane({ blocks, themeTokens }: { blocks: BlockResponse[]; themeTokens: unknown }) {
  const [device, setDevice] = useState<Device>("desktop");
  const tokens = themeTokensSchema.parse(themeTokens);
  const cssVariables = themeTokensToCssVariables(tokens) as CSSProperties;
  const visibleBlocks = blocks
    .filter((block) => block.visible && !block.degraded)
    .map((block) => ({ position: block.position, type: block.type, config: block.config }));

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-center gap-1">
        {(Object.keys(DEVICES) as Device[]).map((key) => {
          const Icon = DEVICES[key].icon;
          return (
            <Button
              key={key}
              type="button"
              variant={device === key ? "secondary" : "ghost"}
              size="sm"
              aria-label={DEVICES[key].label}
              aria-pressed={device === key}
              onClick={() => setDevice(key)}
            >
              <Icon className="size-4" />
            </Button>
          );
        })}
      </div>
      <div className="flex flex-1 justify-center overflow-auto rounded-lg border border-border bg-surface p-4">
        <div
          className="h-fit min-h-full overflow-hidden rounded-md border border-border shadow-sm transition-[width]"
          style={{ width: DEVICES[device].width, maxWidth: "100%" }}
        >
          <div
            style={cssVariables}
            className="min-h-full bg-[var(--site-color-background)] text-[var(--site-color-foreground)]"
          >
            <div style={{ fontFamily: "var(--site-font-family)" }}>
              {visibleBlocks.length === 0 ? (
                <p className="p-10 text-center text-sm text-[var(--site-color-muted-foreground)]">
                  Agrega un bloque para ver la vista previa.
                </p>
              ) : (
                <PageBlocks blocks={visibleBlocks} buttonStyle={tokens.buttonStyle} mode="preview" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
