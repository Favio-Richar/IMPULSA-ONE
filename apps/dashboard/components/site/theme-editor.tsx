"use client";

import type { ThemeResponse } from "@impulza/contracts";
import {
  BUTTON_STYLES,
  DENSITY_SCALES,
  RADIUS_SCALES,
  SHADOW_SCALES,
  themeTokensSchema,
  themeTokensToCssVariables,
  type ThemeTokens,
} from "@impulza/validation";
import { Button, cn, Dialog, Input } from "@impulza/ui";
import { Check, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useAssignSiteTheme } from "../../lib/hooks/use-sites";
import { useUpdateTheme } from "../../lib/hooks/use-themes";
import {
  checksFor,
  describeFailure,
  formatRatio,
  isHex,
  paletteContrastChecks,
  type ContrastCheck,
  type EditablePalette,
  type PaletteKey,
} from "../../lib/theme-contrast";
import { FONT_FAMILY_OPTIONS, FONT_GROUPS } from "../../lib/theme-fonts";
import { PagePreview, previewButtonStyle, type Device } from "./page-preview";

const COLOR_GROUPS: ReadonlyArray<{ title: string; description: string; colors: ReadonlyArray<{ key: PaletteKey; label: string; hint: string }> }> = [
  {
    title: "Fondo y superficies",
    description: "Lo que va detrás del contenido.",
    colors: [
      { key: "background", label: "Fondo de la página", hint: "El color base de toda la página." },
      { key: "surface", label: "Tarjetas y superficies", hint: "Bloques, tarjetas y botones neutros." },
      { key: "border", label: "Bordes", hint: "Separadores y contornos suaves." },
    ],
  },
  {
    title: "Texto",
    description: "Tiene que leerse bien sobre el fondo y sobre las tarjetas.",
    colors: [
      { key: "foreground", label: "Texto principal", hint: "Títulos y párrafos." },
      { key: "mutedForeground", label: "Texto secundario", hint: "Descripciones y detalles." },
    ],
  },
  {
    title: "Acento",
    description: "El color de tus botones y enlaces.",
    colors: [
      { key: "primary", label: "Color de acento", hint: "Botones principales y enlaces." },
      { key: "primaryForeground", label: "Texto sobre el acento", hint: "El texto dentro de un botón de acento." },
    ],
  },
];

const RADIUS_LABELS: Record<ThemeTokens["radius"], string> = { none: "Recto", subtle: "Sutil", moderate: "Moderado" };
const DENSITY_LABELS: Record<ThemeTokens["density"], string> = { compact: "Compacta", comfortable: "Cómoda" };
const SHADOW_LABELS: Record<ThemeTokens["shadow"], string> = { none: "Sin sombra", subtle: "Sutil" };
const BUTTON_LABELS: Record<ThemeTokens["buttonStyle"], string> = { solid: "Sólido", outline: "Contorno", glass: "Cristal", mono: "Monocromo" };

/** Mensaje del servidor para mostrar tal cual (422 de contraste, 403, 409…). El editor ya evita el 422 comprobando antes. */
function saveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: unknown; issues?: Array<{ path?: string; message: string }> } | undefined;
    const issue = body?.issues?.[0];
    if (issue) return issue.path ? `${issue.path}: ${issue.message}` : issue.message;
    if (typeof body?.message === "string") return body.message;
    if (error.status === 403) return "Tu rol no permite editar temas.";
  }
  return "No pudimos guardar el tema. Intenta de nuevo.";
}

/**
 * Editor de un tema propio (el del catálogo se duplica primero). Controla TODOS los campos de `ThemeTokens` —los 7 colores, la
 * tipografía, el radio, la densidad, la sombra y el estilo de botón— con una vista previa en vivo, y comprueba el contraste AA de
 * cada par mientras se edita: «Guardar» queda deshabilitado, con el motivo exacto, hasta que todos pasen. La paleta de día/noche y
 * el movimiento del tema original se conservan tal cual (no se editan acá).
 */
export function ThemeEditor({
  organizationId,
  siteId,
  theme,
  onClose,
  onSaved,
}: {
  organizationId: string;
  siteId: string;
  theme: ThemeResponse;
  onClose: () => void;
  onSaved: (theme: ThemeResponse) => void;
}): React.JSX.Element {
  const original = themeTokensSchema.parse(theme.tokens);
  const update = useUpdateTheme(organizationId);
  const assign = useAssignSiteTheme(organizationId, siteId);
  const [name, setName] = useState(theme.name);
  const [palette, setPalette] = useState<EditablePalette>({ ...original.palette });
  const [fontFamily, setFontFamily] = useState(original.fontFamily);
  const [radius, setRadius] = useState(original.radius);
  const [density, setDensity] = useState(original.density);
  const [shadow, setShadow] = useState(original.shadow);
  const [buttonStyle, setButtonStyle] = useState(original.buttonStyle);
  const [device, setDevice] = useState<Device>("phone");
  const [failed, setFailed] = useState<string | null>(null);

  const checks = paletteContrastChecks(palette);
  const failing = checks.filter((check) => !check.passes);
  const invalidHex = (Object.keys(palette) as PaletteKey[]).filter((key) => !isHex(palette[key]));
  const nameOk = name.trim().length >= 2 && name.trim().length <= 60;
  const canSave = failing.length === 0 && invalidHex.length === 0 && nameOk && !update.isPending && !assign.isPending;

  // Un color a medio escribir no rompe la vista previa: se usa el último válido del tema original en ese lugar.
  const livePalette = Object.fromEntries(
    (Object.keys(palette) as PaletteKey[]).map((key) => [key, isHex(palette[key]) ? palette[key].toLowerCase() : original.palette[key]]),
  ) as ThemeTokens["palette"];
  const draft: ThemeTokens = { ...original, palette: livePalette, fontFamily, radius, density, shadow, buttonStyle };

  async function save(): Promise<void> {
    setFailed(null);
    const tokens: ThemeTokens = { ...draft, palette: Object.fromEntries((Object.keys(palette) as PaletteKey[]).map((key) => [key, palette[key].toLowerCase()])) as ThemeTokens["palette"] };
    try {
      const saved = await update.mutateAsync({ themeId: theme.id, name: name.trim(), tokens });
      // Queda aplicado al sitio (mismo flujo que elegir un tema en la grilla).
      await assign.mutateAsync(saved.id);
      onSaved(saved);
    } catch (error) {
      setFailed(saveErrorMessage(error));
    }
  }

  const blockReason =
    invalidHex.length > 0
      ? `Revisa el color «${COLOR_GROUPS.flatMap((group) => group.colors).find((color) => color.key === invalidHex[0])?.label ?? invalidHex[0]}»: usa un hexadecimal de 6 dígitos, por ejemplo #1d4ed8.`
      : failing.length > 0
        ? describeFailure(failing[0]!)
        : !nameOk
          ? "Ponle un nombre de 2 a 60 caracteres."
          : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !update.isPending && !assign.isPending) onClose();
      }}
      title="Personalizar tema"
      description="Cambia colores, tipografía y botones. La vista previa se actualiza al instante y solo se guarda un tema que se lee bien."
      className="sm:max-w-5xl"
      footer={
        <>
          <div aria-live="polite" className="flex-1 text-sm sm:mr-auto">
            {failed ? (
              <p role="alert" className="text-danger">
                {failed}
              </p>
            ) : blockReason ? (
              <p className="flex items-start gap-1.5 text-danger" data-testid="theme-block-reason">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {blockReason}
                {failing.length > 1 ? <span className="text-muted-foreground"> (y {failing.length - 1} más)</span> : null}
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-success">
                <Check className="size-4" aria-hidden="true" />
                Todos los colores cumplen WCAG 2.2 AA.
              </p>
            )}
          </div>
          <Button type="button" variant="ghost" onClick={onClose} disabled={update.isPending || assign.isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void save()} disabled={!canSave} loading={update.isPending || assign.isPending}>
            Guardar y aplicar
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]">
        <div className="order-last flex min-w-0 flex-col gap-7 lg:order-first">
          <Input label="Nombre del tema" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} error={nameOk ? undefined : "Entre 2 y 60 caracteres."} />

          <section aria-labelledby="editor-colores" className="flex flex-col gap-5">
            <h3 id="editor-colores" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Colores
            </h3>
            {COLOR_GROUPS.map((group) => (
              <fieldset key={group.title} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <legend className="px-1 text-sm font-semibold text-foreground">{group.title}</legend>
                <p className="-mt-1 text-xs text-muted-foreground">{group.description}</p>
                {group.colors.map((color) => (
                  <ColorField
                    key={color.key}
                    label={color.label}
                    hint={color.hint}
                    value={palette[color.key]}
                    checks={checksFor(color.key, checks)}
                    onChange={(value) => setPalette((current) => ({ ...current, [color.key]: value }))}
                  />
                ))}
              </fieldset>
            ))}
            <ContrastSummary checks={checks} />
          </section>

          <section aria-labelledby="editor-tipografia" className="flex flex-col gap-3">
            <h3 id="editor-tipografia" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Tipografía
            </h3>
            {FONT_GROUPS.map((group) => (
              <fieldset key={group.id} className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium text-foreground">{group.label}</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {FONT_FAMILY_OPTIONS.filter((option) => option.group === group.id).map((option) => {
                    const vars = themeTokensToCssVariables({ ...draft, fontFamily: option.value });
                    return (
                      <label
                        key={option.value}
                        className={cn(
                          "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)]",
                          fontFamily === option.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-border-strong",
                        )}
                      >
                        <input type="radio" name="theme-font" value={option.value} checked={fontFamily === option.value} onChange={() => setFontFamily(option.value)} className="sr-only" />
                        <span className="text-2xl leading-none text-foreground" aria-hidden="true" style={{ fontFamily: vars["--site-font-heading"] }}>
                          Aa{" "}
                          <span className="text-sm" style={{ fontFamily: vars["--site-font-family"] }}>
                            Tu texto se ve así
                          </span>
                        </span>
                        <span className="text-sm font-medium text-foreground">{option.label}</span>
                        <span className="text-xs text-muted-foreground">{option.description}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </section>

          <section aria-labelledby="editor-forma" className="flex flex-col gap-5">
            <h3 id="editor-forma" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Forma y botones
            </h3>
            <VisualOptions
              legend="Bordes"
              name="theme-radius"
              value={radius}
              onChange={setRadius}
              options={RADIUS_SCALES.map((value) => ({
                value,
                label: RADIUS_LABELS[value],
                sample: <span className="block h-8 w-14 border-2 border-foreground/70 bg-surface" style={{ borderRadius: draftRadius(value) }} />,
              }))}
            />
            <VisualOptions
              legend="Espaciado entre bloques"
              name="theme-density"
              value={density}
              onChange={setDensity}
              options={DENSITY_SCALES.map((value) => ({
                value,
                label: DENSITY_LABELS[value],
                sample: (
                  <span className={cn("flex w-14 flex-col", value === "compact" ? "gap-0.5" : "gap-2")}>
                    <span className="h-2 rounded-sm bg-foreground/60" />
                    <span className="h-2 rounded-sm bg-foreground/60" />
                    <span className="h-2 rounded-sm bg-foreground/60" />
                  </span>
                ),
              }))}
            />
            <VisualOptions
              legend="Sombra"
              name="theme-shadow"
              value={shadow}
              onChange={setShadow}
              options={SHADOW_SCALES.map((value) => ({
                value,
                label: SHADOW_LABELS[value],
                sample: (
                  <span
                    className="block h-8 w-14 rounded-md border border-border bg-background"
                    style={{ boxShadow: value === "none" ? "none" : "0 3px 8px 0 rgb(15 23 42 / 0.22)" }}
                  />
                ),
              }))}
            />
            <VisualOptions
              legend="Estilo de botón"
              name="theme-button"
              value={buttonStyle}
              onChange={setButtonStyle}
              options={BUTTON_STYLES.map((value) => ({
                value,
                label: BUTTON_LABELS[value],
                sample: (
                  <span
                    className="flex h-8 w-20 items-center justify-center text-[10px] font-medium"
                    style={{ ...buttonSampleStyle(value, livePalette), borderRadius: draftRadius(radius) }}
                  >
                    Botón
                  </span>
                ),
              }))}
            />
          </section>
        </div>

        <div className="order-first lg:order-last">
          <div className="flex flex-col gap-3 lg:sticky lg:top-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">Vista previa</span>
              <div role="group" aria-label="Tamaño de la vista previa" className="inline-flex rounded-md border border-border p-0.5">
                {(["phone", "desktop"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={device === value}
                    onClick={() => setDevice(value)}
                    className={cn(
                      "min-h-9 rounded-sm px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
                      device === value ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-surface",
                    )}
                  >
                    {value === "phone" ? "Teléfono" : "Escritorio"}
                  </button>
                ))}
              </div>
            </div>
            <PagePreview theme={draft} background={null} device={device} />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

const RADIUS_PX: Record<ThemeTokens["radius"], string> = { none: "0px", subtle: "0.375rem", moderate: "0.75rem" };
function draftRadius(radius: ThemeTokens["radius"]): string {
  return RADIUS_PX[radius];
}

/** Muestra de un botón con el estilo elegido y los colores que se están editando (los mismos que pinta la página). */
function buttonSampleStyle(style: ThemeTokens["buttonStyle"], palette: ThemeTokens["palette"]): React.CSSProperties {
  const vars = {
    "--site-color-primary": palette.primary,
    "--site-color-primary-foreground": palette.primaryForeground,
    "--site-color-border": palette.border,
    "--site-color-surface": palette.surface,
    "--site-color-foreground": palette.foreground,
  } as React.CSSProperties;
  return { ...vars, ...previewButtonStyle(style) };
}

function VisualOptions<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
}: {
  legend: string;
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string; sample: React.ReactNode }>;
}): React.JSX.Element {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex min-w-24 cursor-pointer flex-col items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)]",
              value === option.value ? "border-primary bg-primary/5 font-medium text-foreground ring-1 ring-primary" : "border-border text-muted-foreground hover:border-border-strong",
            )}
          >
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="sr-only" />
            <span aria-hidden="true" className="flex h-10 items-center">
              {option.sample}
            </span>
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Un color: selector, hexadecimal y su estado de contraste (con texto, no solo color) para los pares en los que interviene. */
function ColorField({
  label,
  hint,
  value,
  checks,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  checks: ContrastCheck[];
  onChange: (value: string) => void;
}): React.JSX.Element {
  const id = useId();
  const valid = isHex(value);
  const failing = checks.filter((check) => !check.passes);
  const worst = checks.filter((check) => check.ratio !== null).sort((a, b) => (a.ratio ?? 0) / a.required - (b.ratio ?? 0) / b.required)[0];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-hex`} className="text-sm font-medium text-foreground">
            {label}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={`Elegir ${label.toLowerCase()}`}
              value={valid ? value.toLowerCase() : "#000000"}
              onChange={(event) => onChange(event.target.value)}
              className="h-10 w-12 cursor-pointer rounded-md border border-border-strong bg-background p-1"
            />
            <input
              id={`${id}-hex`}
              type="text"
              value={value}
              maxLength={7}
              spellCheck={false}
              onChange={(event) => onChange(event.target.value.trim())}
              aria-invalid={!valid}
              aria-describedby={`${id}-state`}
              className="h-10 w-28 rounded-md border border-border-strong bg-background px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
            />
          </div>
        </div>
        <p id={`${id}-state`} className="min-w-0 flex-1 pb-1 text-xs" data-testid={`state-${label}`}>
          {!valid ? (
            <span className="flex items-center gap-1 font-medium text-danger">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              Usa un color como #1d4ed8.
            </span>
          ) : checks.length === 0 ? (
            <span className="text-muted-foreground">Decorativo: sin requisito de contraste.</span>
          ) : failing.length > 0 ? (
            <span className="flex items-start gap-1 font-medium text-danger">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              No cumple AA: {failing.map((check) => (check.ratio === null ? "falta un color válido" : `${formatRatio(check.ratio)} (necesita ${check.required}:1)`)).join(" · ")}
            </span>
          ) : (
            <span className="flex items-center gap-1 font-medium text-success">
              <Check className="size-3.5 shrink-0" aria-hidden="true" />
              Cumple AA{worst?.ratio ? ` · ${formatRatio(worst.ratio)}` : ""}
            </span>
          )}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Los cinco pares que el servidor verifica, en una lista corta con su razón: nada queda escondido. */
function ContrastSummary({ checks }: { checks: ContrastCheck[] }): React.JSX.Element {
  return (
    <details className="rounded-lg border border-border bg-surface p-3 text-sm">
      <summary className="cursor-pointer font-medium text-foreground">Ver todas las comprobaciones de contraste</summary>
      <ul className="mt-2 flex flex-col gap-1">
        {checks.map((check) => (
          <li key={check.id} className="flex items-start justify-between gap-3">
            <span className="text-foreground">{check.label}</span>
            <span className={cn("shrink-0 font-medium tabular-nums", check.passes ? "text-success" : "text-danger")}>
              {check.ratio === null ? "—" : formatRatio(check.ratio)} · {check.required}:1 {check.passes ? "✓" : "✗"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
