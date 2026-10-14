"use client";

import { PageBlocks, SiteBackdrop } from "@impulza/blocks-renderer";
import {
  backgroundForDisplay,
  getCatalogTheme,
  parseStoredBlock,
  personalizeTemplateBlocks,
  resolveSiteBackground,
  TEMPLATE_CATALOG,
  templatePersonalizationSchema,
  type TemplatePersonalization,
} from "@impulza/validation";
import { useMemo, useSyncExternalStore } from "react";

type State =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "ready"; code: string; personalization: TemplatePersonalization | undefined };

/** Decodifica el fragmento (`#<base64url(JSON)>`): vive solo en la URL, nunca viaja al servidor ni se guarda. */
function decode(hash: string): State {
  try {
    const raw = hash.replace(/^#/, "");
    if (raw === "") {
      return { kind: "invalid" };
    }
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(padded)));
    const data = JSON.parse(json) as { c?: unknown; p?: unknown; e?: unknown };
    if (typeof data.c !== "string" || typeof data.e !== "number") {
      return { kind: "invalid" };
    }
    if (Date.now() > data.e) {
      return { kind: "expired" };
    }
    const personalization = templatePersonalizationSchema.safeParse(data.p ?? {});
    return { kind: "ready", code: data.c, personalization: personalization.success ? personalization.data : undefined };
  } catch {
    return { kind: "invalid" };
  }
}

function Notice({ title, text }: { title: string; text: string }): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-semibold text-[#0f172a]">{title}</h1>
      <p className="text-sm text-[#475569]">{text}</p>
    </main>
  );
}

export default function VistaPreviaPage(): React.JSX.Element {
  // El fragmento solo existe en el navegador: en el servidor (`null`) se muestra «cargando».
  const hash = useSyncExternalStore(
    (listener) => {
      window.addEventListener("hashchange", listener);
      return () => window.removeEventListener("hashchange", listener);
    },
    () => window.location.hash,
    () => null,
  );
  const state = useMemo<State>(() => (hash === null ? { kind: "loading" } : decode(hash)), [hash]);

  if (state.kind === "loading") {
    return <Notice title="Cargando la vista previa…" text="Un momento." />;
  }
  if (state.kind === "expired") {
    return <Notice title="Este enlace ya venció" text="Las vistas previas duran 48 horas. Pide a quien te la compartió que genere una nueva." />;
  }
  const template = state.kind === "ready" ? TEMPLATE_CATALOG.find((entry) => entry.code === state.code) : undefined;
  const theme = template ? getCatalogTheme(template.themeCode) : undefined;
  if (state.kind !== "ready" || !template || !theme) {
    return <Notice title="No pudimos abrir esta vista previa" text="El enlace está incompleto o ya no es válido." />;
  }

  const tokens = theme.tokens;
  const background = resolveSiteBackground(backgroundForDisplay(template.background ?? null, theme.code), tokens, (key) => key);
  const blocks = personalizeTemplateBlocks(
    template.blocksSeed.map((block) => ({ ...block })),
    state.personalization,
  ).flatMap((block, position) => {
    const parsed = parseStoredBlock(block.type, block.configSchemaVersion, block.config);
    return parsed.renderable ? [{ position, type: block.type, config: parsed.config, primary: block.isPrimary === true }] : [];
  });

  return (
    <>
      <p className="bg-[#0f172a] px-4 py-2 text-center text-xs text-white">
        Vista previa temporal hecha con Impulza One · todavía no está publicada
      </p>
      <SiteBackdrop theme={tokens} background={background} fixed={false} showModeToggle={false} className="min-h-screen">
        <PageBlocks blocks={blocks} buttonStyle={tokens.buttonStyle} mode="preview" primaryActionBar={false} />
      </SiteBackdrop>
    </>
  );
}
