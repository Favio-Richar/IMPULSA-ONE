"use client";

import { StickerBlock } from "@impulza/blocks-renderer";
import { DEFAULT_THEME_CODE, getCatalogTheme, STICKER_CATALOG, STICKER_CATEGORIES, themeTokensToCssVariables, type StickerCategory } from "@impulza/validation";
import { cn } from "@impulza/ui";
import { Search } from "lucide-react";
import { useId, useMemo, useState } from "react";

/** Una paleta neutra para las miniaturas: las decoraciones usan los colores del tema de la página, que el panel no tiene cargados. */
const THUMB_THEME = themeTokensToCssVariables((getCatalogTheme(DEFAULT_THEME_CODE) ?? getCatalogTheme("claro-profesional"))!.tokens);

/** Quita tildes y pasa a minúsculas, para que «corazon» encuentre «Corazón». */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Selector de la decoración de un bloque sticker: el catálogo curado agrupado por categoría, con búsqueda. Cada opción es un
 * botón con el nombre de la decoración (la miniatura es solo visual). Es un grupo de opciones, no un `<select>` de texto plano.
 */
export function StickerPicker({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (stickerId: string) => void;
  error?: string | undefined;
}): React.JSX.Element {
  const searchId = useId();
  const [category, setCategory] = useState<StickerCategory | "todas">("todas");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = fold(query.trim());
    return STICKER_CATALOG.filter(
      (sticker) =>
        (category === "todas" || sticker.category === category) && (needle === "" || fold(sticker.name).includes(needle) || fold(sticker.id).includes(needle)),
    );
  }, [category, query]);

  const selectedName = STICKER_CATALOG.find((sticker) => sticker.id === value)?.name;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium text-foreground">
        {label}
        {selectedName ? <span className="ml-2 font-normal text-muted-foreground">Elegida: {selectedName}</span> : null}
      </legend>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label htmlFor={searchId} className="sr-only">
            Buscar decoración
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar: flecha, estrella, nuevo…"
            className="h-10 w-full rounded-md border border-border-strong bg-background pl-9 pr-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
          />
        </div>
      </div>

      <div role="group" aria-label="Categorías de decoraciones" className="flex flex-wrap gap-1.5">
        {([{ id: "todas", label: "Todas" }, ...STICKER_CATEGORIES] as const).map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={category === entry.id}
            onClick={() => setCategory(entry.id)}
            className={cn(
              "min-h-9 rounded-md border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
              category === entry.id ? "border-primary bg-primary/5 font-medium text-foreground" : "border-border text-muted-foreground hover:border-border-strong",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p role="status" className="rounded-md border border-dashed border-border-strong p-4 text-center text-sm text-muted-foreground">
          Ninguna decoración coincide con «{query}». Prueba con otra palabra.
        </p>
      ) : (
        <ul role="list" aria-label="Decoraciones" className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-5" style={THUMB_THEME as React.CSSProperties}>
          {visible.map((sticker) => {
            const selected = sticker.id === value;
            return (
              <li key={sticker.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={sticker.name}
                  title={sticker.name}
                  onClick={() => onChange(sticker.id)}
                  className={cn(
                    "flex aspect-square w-full items-center justify-center rounded-md border p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
                    selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-[var(--site-color-background)] hover:border-border-strong",
                  )}
                >
                  <StickerBlock config={{ stickerId: sticker.id, size: "sm", rotation: 0, alignment: "center" }} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {visible.length} {visible.length === 1 ? "decoración" : "decoraciones"}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
