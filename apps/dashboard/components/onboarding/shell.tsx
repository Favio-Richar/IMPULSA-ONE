"use client";

import type { TemplateResponse } from "@impulza/contracts";
import { cn } from "@impulza/ui";
import {
  Check,
  Eye,
  LayoutTemplate,
  Link2,
  PartyPopper,
  Rocket,
  Share2,
  Signature,
  Target,
  UserPen,
  UserRound,
  Briefcase,
  type LucideIcon,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ONBOARDING_STEPS, useOnboardingStore } from "../../lib/onboarding-store";
import { TemplatePreview } from "../templates/template-preview";
import { draftToPersonalization } from "./draft";

/** Un ícono por paso del asistente (decorativo: el avance accesible lo da la barra de progreso). */
export const STEP_ICONS: Record<(typeof ONBOARDING_STEPS)[number]["key"], LucideIcon> = {
  account: UserRound,
  objective: Target,
  industry: Briefcase,
  name: Signature,
  slug: Link2,
  import: Share2,
  template: LayoutTemplate,
  profile: UserPen,
  preview: Eye,
  publish: Rocket,
  checklist: PartyPopper,
};

/**
 * Lo que la persona está escribiendo AHORA, antes de pulsar «Continuar» (los formularios de cada paso solo guardan en el borrador al
 * enviarse). La vista previa lo mezcla sobre el borrador para mostrarlo en vivo. Es estado de interfaz: no toca el borrador.
 */
interface LiveOverrides {
  displayName?: string | undefined;
  headline?: string | undefined;
  bio?: string | undefined;
  slug?: string | undefined;
  /** Qué parte del teléfono mostrar en el paso de redes y enlaces: `social` (redes) o `link` (otros enlaces). */
  focus?: string | undefined;
}
const LiveContext = createContext<{ overrides: LiveOverrides; setOverrides: (changes: LiveOverrides) => void } | null>(null);

export function LivePreviewProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverridesState] = useState<LiveOverrides>({});
  // Estable a propósito: los efectos de `useLiveField` dependen de esta función y no deben volver a correr en cada cambio.
  const setOverrides = useCallback((changes: LiveOverrides) => {
    setOverridesState((current) => {
      const same = (Object.keys(changes) as Array<keyof LiveOverrides>).every((key) => current[key] === changes[key]);
      return same ? current : { ...current, ...changes };
    });
  }, []);
  const value = useMemo(() => ({ overrides, setOverrides }), [overrides, setOverrides]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/** Publica lo que se escribe en un campo para la vista previa. Sin proveedor (en una prueba), no hace nada. */
export function useLiveField(field: keyof LiveOverrides, value: string | undefined): void {
  const context = useContext(LiveContext);
  const setOverrides = context?.setOverrides;
  useEffect(() => {
    if (value !== undefined) setOverrides?.({ [field]: value });
  }, [field, value, setOverrides]);
  // Al salir del paso, lo escrito sin enviar deja de mandar: la vista previa vuelve a lo guardado.
  useEffect(() => () => setOverrides?.({ [field]: undefined }), [field, setOverrides]);
}

/** Pasos con vista previa lateral: desde el nombre (4) en adelante, salvo la vista previa grande (9) y el cierre (11). */
export function stepShowsLivePreview(stepKey: (typeof ONBOARDING_STEPS)[number]["key"]): boolean {
  return ["account", "objective", "industry", "name", "slug", "import", "template", "profile", "publish"].includes(stepKey);
}

const HINTS: Partial<Record<(typeof ONBOARDING_STEPS)[number]["key"], string>> = {
  account: "Así se verá tu portal. Se va armando con cada paso.",
  objective: "Tu portal pondrá primero lo que más te importa.",
  industry: "Elegimos plantillas pensadas para tu rubro.",
  name: "Tu nombre aparece arriba de todo, en grande.",
  slug: "Esta es la forma de tu página: sus botones se arman con tus enlaces.",
  import: "Tus redes y enlaces serán botones de esta página.",
  template: "Elige una plantilla y la verás aquí con tus datos.",
  profile: "Lo que escribes aparece aquí al instante.",
  publish: "Esto es lo que vamos a publicar.",
};

/** Barra de pasos numerada. Decorativa (`aria-hidden`): la barra de progreso y «Paso N de 11» son lo que leen los lectores de pantalla. */
export function StepRail({ stepIndex }: { stepIndex: number }) {
  return (
    <ol aria-hidden="true" className="flex items-center gap-1.5">
      {ONBOARDING_STEPS.map((step, index) => {
        const Icon = STEP_ICONS[step.key];
        const done = index < stepIndex;
        const current = index === stepIndex;
        return (
          <li key={step.key} className="flex flex-1 items-center gap-1.5 last:flex-none">
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300",
                done && "bg-primary text-primary-foreground",
                current && "scale-110 bg-primary text-primary-foreground shadow-md ring-4 ring-primary/20",
                !done && !current && "bg-surface text-muted-foreground",
              )}
            >
              {done ? <Check className="size-4" strokeWidth={3} /> : current ? <Icon className="size-4" /> : index + 1}
            </span>
            {index < ONBOARDING_STEPS.length - 1 ? (
              <span className={cn("h-0.5 flex-1 rounded-full transition-colors duration-300", done ? "bg-primary" : "bg-border")} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

const SCREEN_WIDTH = 390;
const FRAME_WIDTH = 264;
const SCALE = FRAME_WIDTH / SCREEN_WIDTH;

/**
 * Vista previa lateral persistente: un teléfono que se arma a medida que avanzas. Primero un esqueleto de portal con tu nombre
 * (lo que escribes aparece mientras escribes); al elegir plantilla, la plantilla real con tus datos (`TemplatePreview`, el mismo
 * componente de la galería y de la vista previa grande). Es un espejo decorativo: oculto a lectores de pantalla y sin foco.
 */
export function LivePreviewPanel({ stepKey, template }: { stepKey: (typeof ONBOARDING_STEPS)[number]["key"]; template: TemplateResponse | null }) {
  const draft = useOnboardingStore((state) => state.draft);
  const context = useContext(LiveContext);
  const overrides = context?.overrides ?? {};
  // Lo que se escribe ahora manda sobre lo guardado, pero solo mientras esté en el paso que lo escribe.
  const live = { ...draft, ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) } as typeof draft;
  const name = live.displayName.trim() || "Tu nombre";
  const hint = HINTS[stepKey];
  const sliderRef = useRef<HTMLDivElement>(null);
  const sliderTarget = stepKey === "import" ? (overrides.focus === "social" ? '[data-block-type="social"]' : '[data-block-type="link"]') : null;

  // En el paso de redes y enlaces, el teléfono se desplaza hasta donde aparecen esos botones (la plantilla es más alta que la
  // pantalla). Es solo presentación: se aplica directo al elemento, sin estado, y se recalcula cuando el contenido cambia de alto.
  useEffect(() => {
    const slider = sliderRef.current;
    if (!slider) {
      return;
    }
    const apply = (): void => {
      const target = sliderTarget ? slider.querySelector<HTMLElement>(sliderTarget) : null;
      if (!target) {
        slider.style.transform = "";
        return;
      }
      const offset = (target.getBoundingClientRect().top - slider.getBoundingClientRect().top) / SCALE;
      // Sin pasarse del final: el contenido nunca deja un hueco en blanco debajo.
      const screenHeight = slider.parentElement?.clientHeight ?? 0;
      const maxShift = Math.max(0, slider.offsetHeight * SCALE - screenHeight);
      const shift = Math.min(Math.max(0, offset - 56) * SCALE, maxShift);
      slider.style.transform = `translateY(${-shift}px)`;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(slider);
    return () => observer.disconnect();
  }, [sliderTarget, template, live.socials.length, live.links.length]);

  return (
    <aside aria-hidden="true" className="hidden lg:block">
      <div className="sticky top-6 flex flex-col items-center gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Así va quedando tu página</p>
        <div className="relative">
          <span aria-hidden="true" className="absolute -inset-6 -z-10 rounded-full bg-primary/25 blur-3xl" />
        <div className="onb-float rounded-[2.5rem] border-[10px] border-[#0f172a] bg-[#0f172a] p-0 shadow-2xl shadow-primary/30" style={{ width: FRAME_WIDTH + 20 }}>
          <div className="relative h-[34rem] overflow-hidden rounded-[1.9rem] bg-background">
            <div className="absolute left-1/2 top-2 z-10 h-4 w-20 -translate-x-1/2 rounded-full bg-[#0f172a]" />
            {template ? (
              <div ref={sliderRef} className="absolute inset-x-0 top-0 transition-transform duration-500 motion-reduce:transition-none">
                <div inert className="pointer-events-none origin-top-left" style={{ width: SCREEN_WIDTH, transform: `scale(${SCALE})` }}>
                  <TemplatePreview template={template} personalization={draftToPersonalization(live, template)} thumbnail />
                </div>
              </div>
            ) : (
              <SkeletonPortal name={name} slug={live.slug} />
            )}
          </div>
        </div>
        </div>
        {hint ? <p className="max-w-[17rem] text-center text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </aside>
  );
}

/** El portal antes de elegir plantilla: tu nombre y la forma de una página de enlaces, con los colores de la marca. */
function SkeletonPortal({ name, slug }: { name: string; slug: string }) {
  return (
    <div className="flex h-full flex-col items-center gap-3 bg-gradient-to-b from-primary/10 via-background to-background px-5 pt-14">
      <span className="flex size-20 items-center justify-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground shadow-lg ring-4 ring-background">
        {name.charAt(0).toUpperCase()}
      </span>
      <p className="max-w-full truncate text-lg font-semibold text-foreground motion-fade" key={name}>
        {name}
      </p>
      <div className="h-2.5 w-3/5 rounded-full bg-border" />
      <div className="h-2.5 w-2/5 rounded-full bg-border" />
      <div className="mt-3 flex w-full flex-col gap-2.5">
        <span className="h-11 w-full rounded-xl bg-primary" />
        <span className="h-11 w-full rounded-xl border border-border bg-surface" />
        <span className="h-11 w-full rounded-xl border border-border bg-surface" />
        <span className="h-11 w-full rounded-xl border border-border bg-surface" />
      </div>
      {slug ? <p className="mt-auto pb-4 text-[10px] text-muted-foreground">/{slug}</p> : null}
    </div>
  );
}
