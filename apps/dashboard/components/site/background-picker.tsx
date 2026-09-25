"use client";

import { SiteBackdrop } from "@impulza/blocks-renderer";
import type { MediaAssetResponse } from "@impulza/contracts";
import {
  BACKGROUND_GRADIENTS,
  colorTextPalette,
  getBackgroundGradient,
  gradientCss,
  HEX_COLOR_PATTERN,
  type ImageTones,
  legibleStrengths,
  OVERLAY_STRENGTHS,
  type OverlayStrength,
  type OverlayTone,
  resolveSiteBackground,
  type ResolvedSiteBackground,
  siteBackgroundSchema,
  type SiteBackground,
  type ThemeTokens,
  themeTokensSchema,
} from "@impulza/validation";
import { Button, Card, CardContent, CardHeader, CardTitle, cn, ErrorState, LoadingState } from "@impulza/ui";
import { Check, ImagePlus } from "lucide-react";
import { useId, useState } from "react";
import { ApiError } from "../../lib/api-client";
import { sameConfig } from "../../lib/block-fields/same-config";
import { useMediaLibrary } from "../../lib/hooks/use-media";
import { useSetSiteBackground, useSiteBackground, useSiteTheme } from "../../lib/hooks/use-sites";
import { MediaPicker } from "../media/media-picker";

type Kind = "theme" | SiteBackground["kind"];

const KIND_LABELS: Record<Kind, string> = {
  theme: "Del tema",
  color: "Color",
  gradient: "Degradado",
  image: "Imagen",
  video: "Video",
};
const TONE_LABELS: Record<OverlayTone, string> = { dark: "Oscura", light: "Clara" };
const STRENGTH_LABELS: Record<OverlayStrength, string> = { soft: "Suave", medium: "Media", strong: "Fuerte" };
const DEFAULT_OVERLAY = { tone: "dark", strength: "strong" } as const;

/** Mensaje de la API para mostrar tal cual (422 de legibilidad, imagen ajena, etc.). */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: unknown; issues?: Array<{ message: string }> } | undefined;
    if (body?.issues?.[0]) return body.issues[0].message;
    if (typeof body?.message === "string") return body.message;
    if (error.status === 403) return "Tu rol no permite cambiar la apariencia del sitio.";
  }
  return "No pudimos aplicar el fondo. Intenta de nuevo.";
}

/**
 * Fondo de la página (PP3): del tema, color, degradado curado, imagen de la biblioteca o video de la
 * biblioteca curada (solo si hay alguno aprobado). Todo lo que se ofrece ya alcanza AA: el color se
 * revisa al escribirlo y, sobre una imagen, solo se habilitan las intensidades de capa que se leen
 * bien sobre esa foto. El servidor vuelve a verificarlo todo al guardar.
 */
export function BackgroundPicker({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const backgroundQuery = useSiteBackground(organizationId, siteId);
  const themeQuery = useSiteTheme(organizationId, siteId);

  if (backgroundQuery.isPending || themeQuery.isPending) {
    return <LoadingState label="Cargando el fondo…" />;
  }
  if (backgroundQuery.isError || themeQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void backgroundQuery.refetch();
          void themeQuery.refetch();
        }}
      />
    );
  }
  return (
    <BackgroundEditor
      organizationId={organizationId}
      siteId={siteId}
      theme={themeTokensSchema.parse(themeQuery.data.tokens)}
      saved={siteBackgroundSchema.safeParse(backgroundQuery.data.background).data ?? null}
      videos={backgroundQuery.data.videos}
    />
  );
}

function BackgroundEditor({
  organizationId,
  siteId,
  theme,
  saved,
  videos,
}: {
  organizationId: string;
  siteId: string;
  theme: ThemeTokens;
  saved: SiteBackground | null;
  videos: Array<{ code: string; name: string; posterUrl: string }>;
}): React.JSX.Element {
  const setMutation = useSetSiteBackground(organizationId, siteId);
  const library = useMediaLibrary(organizationId);
  const [kind, setKind] = useState<Kind>(saved?.kind ?? "theme");
  const [color, setColor] = useState(saved?.kind === "color" ? saved.color : "#0f172a");
  const [gradient, setGradient] = useState<string>(saved?.kind === "gradient" ? saved.gradient : BACKGROUND_GRADIENTS[0].code);
  const [image, setImage] = useState<{ url: string; tones: ImageTones | null } | null>(
    saved?.kind === "image" ? { url: saved.image.url, tones: null } : null,
  );
  const [video, setVideo] = useState<string | null>(saved?.kind === "video" ? saved.video : (videos[0]?.code ?? null));
  const [overlay, setOverlay] = useState<{ tone: OverlayTone; strength: OverlayStrength }>(
    saved?.kind === "image" || saved?.kind === "video" ? saved.overlay : DEFAULT_OVERLAY,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [done, setDone] = useState(false);
  const colorId = useId();

  // Los tonos de la imagen guardada salen de la biblioteca (el fondo guarda solo la URL). Sin ellos
  // (aún cargando, o una imagen de antes de PP3), se asume el peor caso: solo la capa fuerte.
  const imageTones = image?.tones ?? library.data?.items.find((item) => item.url === image?.url)?.tones ?? null;

  const colorValid = HEX_COLOR_PATTERN.test(color) && colorTextPalette(color.toLowerCase(), null) !== null;
  const allowedStrengths = kind === "image" ? legibleStrengths(imageTones, overlay.tone) : [...OVERLAY_STRENGTHS];
  // Un video curado se aprueba con tonos que alcanzan AA en toda intensidad fuerte; la API igual verifica.

  function draft(): SiteBackground | null {
    switch (kind) {
      case "theme":
        return null;
      case "color":
        return { kind: "color", color: color.toLowerCase() };
      case "gradient":
        return { kind: "gradient", gradient: gradient as Extract<SiteBackground, { kind: "gradient" }>["gradient"] };
      case "image":
        return image ? { kind: "image", image: { url: image.url }, overlay } : null;
      case "video":
        return video ? { kind: "video", video, overlay } : null;
    }
  }

  const current = draft();
  const ready =
    kind === "theme" ||
    (kind === "color" && colorValid) ||
    kind === "gradient" ||
    (kind === "image" && image !== null && allowedStrengths.includes(overlay.strength)) ||
    (kind === "video" && video !== null);
  // Por valor: lo guardado vuelve de JSONB con las claves en otro orden.
  const unchanged = sameConfig(current, saved);

  // Vista previa: lo que resolvería el servidor. Un video se muestra con su póster.
  const previewVideo = videos.find((item) => item.code === video);
  const preview: ResolvedSiteBackground | null =
    !ready || current === null
      ? null
      : current.kind === "video"
        ? previewVideo
          ? { kind: "video", video: { posterUrl: previewVideo.posterUrl, src: "" }, overlay, text: overlay.tone === "dark" ? "light" : "dark" }
          : null
        : resolveSiteBackground(current, theme, (key) => key);

  function chooseTone(tone: OverlayTone): void {
    const allowed = kind === "image" ? legibleStrengths(imageTones, tone) : [...OVERLAY_STRENGTHS];
    setOverlay({ tone, strength: allowed.includes(overlay.strength) ? overlay.strength : (allowed[0] ?? "strong") });
  }

  function chooseImage(asset: MediaAssetResponse): void {
    if (!asset.url) return;
    setImage({ url: asset.url, tones: asset.tones });
    const allowed = legibleStrengths(asset.tones, overlay.tone);
    if (!allowed.includes(overlay.strength)) {
      setOverlay({ tone: overlay.tone, strength: allowed[0] ?? "strong" });
    }
  }

  async function apply(): Promise<void> {
    setDone(false);
    await setMutation.mutateAsync(current).then(
      () => setDone(true),
      () => undefined,
    );
  }

  const kinds: Kind[] = ["theme", "color", "gradient", "image", ...(videos.length > 0 ? (["video"] as const) : [])];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fondo de la página</CardTitle>
        <p className="text-sm text-muted-foreground">
          Lo primero que ve quien toca tu enlace. El texto siempre se ajusta para leerse bien sobre el fondo.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
          <div className="flex min-w-0 flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium text-foreground">Tipo de fondo</legend>
              <div className="flex flex-wrap gap-2">
                {kinds.map((option) => (
                  <label
                    key={option}
                    className={cn(
                      "flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)]",
                      kind === option ? "border-primary bg-primary/5 font-medium text-foreground" : "border-border text-muted-foreground hover:border-border-strong",
                    )}
                  >
                    <input type="radio" name={`${colorId}-kind`} value={option} checked={kind === option} onChange={() => setKind(option)} className="sr-only" />
                    {KIND_LABELS[option]}
                  </label>
                ))}
              </div>
            </fieldset>

            {kind === "theme" ? <p className="text-sm text-muted-foreground">Se usa el color de fondo del tema elegido arriba.</p> : null}

            {kind === "color" ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={colorId} className="text-sm font-medium text-foreground">
                  Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Elegir color"
                    value={HEX_COLOR_PATTERN.test(color) ? color : "#000000"}
                    onChange={(event) => setColor(event.target.value)}
                    className="h-10 w-12 cursor-pointer rounded-md border border-border-strong bg-background p-1"
                  />
                  <input
                    id={colorId}
                    type="text"
                    value={color}
                    maxLength={7}
                    onChange={(event) => setColor(event.target.value.trim())}
                    aria-invalid={!colorValid}
                    aria-describedby={colorValid ? undefined : `${colorId}-error`}
                    className="h-10 w-32 rounded-md border border-border-strong bg-background px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
                  />
                </div>
                {!colorValid ? (
                  <p id={`${colorId}-error`} role="alert" className="text-sm text-danger">
                    {HEX_COLOR_PATTERN.test(color)
                      ? "Con este color ningún texto se lee bien. Elige uno más claro o más oscuro."
                      : "Escribe un color como #0f172a."}
                  </p>
                ) : null}
              </div>
            ) : null}

            {kind === "gradient" ? (
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-foreground">Degradado</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {BACKGROUND_GRADIENTS.map((option) => (
                    <label
                      key={option.code}
                      className={cn(
                        "flex cursor-pointer flex-col gap-1.5 rounded-md border p-1.5 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)]",
                        gradient === option.code ? "border-primary ring-1 ring-primary" : "border-border hover:border-border-strong",
                      )}
                    >
                      <input type="radio" name={`${colorId}-gradient`} value={option.code} checked={gradient === option.code} onChange={() => setGradient(option.code)} className="sr-only" />
                      <span className="relative h-12 rounded-sm" style={{ backgroundImage: gradientCss(getBackgroundGradient(option.code)!) }}>
                        {gradient === option.code ? (
                          <Check className={cn("absolute right-1 top-1 size-4", option.text === "light" ? "text-white" : "text-slate-900")} aria-hidden="true" />
                        ) : null}
                      </span>
                      <span className="font-medium text-foreground">{option.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {kind === "image" ? (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">Imagen</span>
                <div className="flex flex-wrap items-center gap-3">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- variante ya optimizada por el worker
                    <img src={image.url} alt="" className="h-16 w-28 rounded-md border border-border object-cover" />
                  ) : null}
                  <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
                    <ImagePlus className="size-4" aria-hidden="true" />
                    {image ? "Cambiar imagen" : "Elegir imagen"}
                  </Button>
                </div>
                <MediaPicker
                  organizationId={organizationId}
                  open={pickerOpen}
                  onOpenChange={setPickerOpen}
                  hint="horizontal, al menos 1600 px de ancho"
                  onSelect={chooseImage}
                />
              </div>
            ) : null}

            {kind === "video" ? (
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-foreground">Video</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {videos.map((option) => (
                    <label
                      key={option.code}
                      className={cn(
                        "flex cursor-pointer flex-col gap-1.5 rounded-md border p-1.5 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)]",
                        video === option.code ? "border-primary ring-1 ring-primary" : "border-border hover:border-border-strong",
                      )}
                    >
                      <input type="radio" name={`${colorId}-video`} value={option.code} checked={video === option.code} onChange={() => setVideo(option.code)} className="sr-only" />
                      {/* eslint-disable-next-line @next/next/no-img-element -- póster de la biblioteca curada */}
                      <img src={option.posterUrl} alt="" className="h-16 w-full rounded-sm object-cover" />
                      <span className="font-medium text-foreground">{option.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {kind === "image" || kind === "video" ? (
              <div className="flex flex-col gap-3">
                <OptionGroup
                  legend="Capa para que el texto se lea"
                  name={`${colorId}-tone`}
                  options={(["dark", "light"] as const).map((tone) => ({ value: tone, label: TONE_LABELS[tone], disabled: false }))}
                  value={overlay.tone}
                  onChange={(tone) => chooseTone(tone)}
                />
                <OptionGroup
                  legend="Intensidad"
                  name={`${colorId}-strength`}
                  options={OVERLAY_STRENGTHS.map((strength) => ({ value: strength, label: STRENGTH_LABELS[strength], disabled: !allowedStrengths.includes(strength) }))}
                  value={overlay.strength}
                  onChange={(strength) => setOverlay({ ...overlay, strength })}
                />
                {kind === "image" && image && allowedStrengths.length < OVERLAY_STRENGTHS.length ? (
                  <p className="text-xs text-muted-foreground">Las intensidades desactivadas no dejarían leer bien el texto sobre esta imagen.</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Vista previa</span>
            <div className="overflow-hidden rounded-md border border-border" aria-label="Vista previa del fondo" role="img">
              <SiteBackdrop theme={theme} background={preview} fixed={false} className="h-48">
                <div className="flex h-full flex-col justify-center gap-2 p-4" style={{ fontFamily: "var(--site-font-family)" }}>
                  <span className="text-base font-semibold text-[var(--site-color-foreground)]">Tu nombre</span>
                  <span className="text-xs text-[var(--site-color-muted-foreground)]">Una frase que cuenta lo que haces.</span>
                  <span className="rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-3 py-1.5 text-center text-xs font-medium text-[var(--site-color-primary-foreground)]">
                    Escríbeme
                  </span>
                </div>
              </SiteBackdrop>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div aria-live="polite" className="text-sm">
            {setMutation.isError ? (
              <p role="alert" className="text-danger">
                {errorMessage(setMutation.error)}
              </p>
            ) : done && unchanged ? (
              <p className="text-success">Fondo aplicado. Ya se ve en tu página pública.</p>
            ) : null}
          </div>
          <Button type="button" onClick={() => void apply()} disabled={!ready || unchanged} loading={setMutation.isPending}>
            Aplicar fondo
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OptionGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: Array<{ value: T; label: string; disabled: boolean }>;
  value: T;
  onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-foreground">{legend}</legend>
      <div className="inline-flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex items-center rounded-md border px-3 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)]",
              option.disabled
                ? "cursor-not-allowed border-border text-muted-foreground/60"
                : value === option.value
                  ? "cursor-pointer border-primary bg-primary/5 font-medium text-foreground"
                  : "cursor-pointer border-border text-muted-foreground hover:border-border-strong",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
