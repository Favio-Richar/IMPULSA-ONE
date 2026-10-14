"use client";

import { cn } from "@impulza/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChecklistStep, PublishStep } from "../../../components/onboarding/publish-step";
import { LivePreviewPanel, LivePreviewProvider, STEP_ICONS, StepRail, stepShowsLivePreview } from "../../../components/onboarding/shell";
import {
  AccountStep,
  ImportStep,
  IndustryStep,
  NameStep,
  ObjectiveStep,
  PreviewStep,
  ProfileStep,
  SlugStep,
  TemplateStep,
  useChosenTemplate,
} from "../../../components/onboarding/steps";
import { useMe } from "../../../lib/hooks/use-me";
import { ONBOARDING_STEPS, useOnboardingStore } from "../../../lib/onboarding-store";

const STEP_INTROS: Record<(typeof ONBOARDING_STEPS)[number]["key"], string> = {
  account: "Cuéntanos quién eres para adaptar el resto del camino.",
  objective: "¿Qué es lo más importante que tu página tiene que lograr?",
  industry: "Así te mostramos primero las plantillas pensadas para tu rubro.",
  name: "El nombre que verán tus visitantes.",
  slug: "La dirección que vas a compartir en tus redes, tu QR y tus tarjetas.",
  import: "Trae las redes y enlaces que ya tienes. Puedes saltarte este paso.",
  template: "Elige un punto de partida. Todo lo podrás cambiar después.",
  profile: "Completa tu perfil y el botón más importante de tu página.",
  preview: "Así se verá tu página. Mírala en teléfono y en computador.",
  publish: "Último paso: creamos tu página y la publicamos.",
  checklist: "Tu página está lista. Estos pasos te ayudan a sacarle partido.",
};

/** Columna de la vista previa: la plantilla elegida (si ya hay una) con los datos del borrador. */
function PreviewColumn({ stepKey }: { stepKey: (typeof ONBOARDING_STEPS)[number]["key"] }): React.JSX.Element {
  const { template } = useChosenTemplate();
  return <LivePreviewPanel stepKey={stepKey} template={template} />;
}

/** Onboarding de 11 pasos del plan maestro (§8.2), con el paso de plantilla (PL4). */
export default function OnboardingPage(): React.JSX.Element | null {
  const router = useRouter();
  const meQuery = useMe();
  const stepIndex = useOnboardingStore((state) => state.stepIndex);
  const goTo = useOnboardingStore((state) => state.goTo);
  const ensureOwner = useOnboardingStore((state) => state.ensureOwner);
  const reset = useOnboardingStore((state) => state.reset);
  const progress = useOnboardingStore((state) => state.progress);
  const [slugConflict, setSlugConflict] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // El borrador vive en sessionStorage: se lee después de montar (nunca en el render del servidor) y
  // se descarta si es de otra cuenta.
  useEffect(() => {
    void Promise.resolve(useOnboardingStore.persist.rehydrate()).then(() => setHydrated(true));
  }, []);
  useEffect(() => {
    if (hydrated && meQuery.data) {
      ensureOwner(meQuery.data.id);
    }
  }, [hydrated, meQuery.data, ensureOwner]);

  // Al cambiar de paso, el foco va al título: un lector de pantalla anuncia dónde se está.
  useEffect(() => {
    headingRef.current?.focus();
  }, [stepIndex]);

  if (!hydrated) {
    return null;
  }

  const step = ONBOARDING_STEPS[stepIndex]!;
  // Una vez creado el sitio, volver a los pasos anteriores ya no cambiaría nada: el asistente sigue
  // hacia adelante y el resto se edita en el constructor.
  const locked = progress.templateApplied;
  const next = () => goTo(stepIndex + 1);
  const back = () => goTo(stepIndex - 1);

  function leave(): void {
    reset();
  }
  function finish(): void {
    reset();
    router.push("/");
  }

  const wide = step.key === "template" || step.key === "preview";
  const showPreview = stepShowsLivePreview(step.key);
  const StepIcon = STEP_ICONS[step.key];

  return (
    <LivePreviewProvider>
      <div className={cn("mx-auto flex w-full flex-col gap-6 overflow-x-clip", "max-w-6xl")}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-muted-foreground">
              Paso {stepIndex + 1} de {ONBOARDING_STEPS.length}
            </p>
            <span className="hidden text-xs text-muted-foreground sm:inline">{Math.round(((stepIndex + 1) / ONBOARDING_STEPS.length) * 100)} % completado</span>
          </div>
          <div className="hidden sm:block">
            <StepRail stepIndex={stepIndex} />
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-surface sm:sr-only"
            role="progressbar"
            aria-label="Avance del asistente"
            aria-valuemin={1}
            aria-valuemax={ONBOARDING_STEPS.length}
            aria-valuenow={stepIndex + 1}
          >
            <div
              className="onb-shimmer relative h-full overflow-hidden rounded-full bg-gradient-to-r from-primary to-primary/70 transition-[width] duration-500"
              style={{ width: `${((stepIndex + 1) / ONBOARDING_STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        <div className={cn("grid items-start gap-8", showPreview ? "lg:grid-cols-[minmax(0,1fr)_19rem]" : "")}>
          <div
            className={cn(
              "relative overflow-clip rounded-3xl border border-border bg-background/90 p-5 shadow-2xl shadow-primary/10 backdrop-blur-xl sm:p-8",
              "before:absolute before:inset-x-0 before:top-0 before:h-1.5 before:bg-gradient-to-r before:from-primary before:via-primary/60 before:to-primary/10",
              // En un teléfono, los pasos con vistas a escala (plantillas y vista previa) usan todo el ancho: la tarjeta no les resta
              // píxeles, porque reducirían de más el contenido escalado y sus controles quedarían bajo el tamaño mínimo táctil.
              wide && "max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none max-sm:backdrop-blur-none",
            )}
          >
            <div className="mb-6 flex items-start gap-4">
              <span
                aria-hidden="true"
                className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shadow-primary/30"
              >
                <StepIcon className="size-7" />
              </span>
              <div className="min-w-0">
                <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-foreground focus:outline-none sm:text-3xl">
                  {step.title}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">{STEP_INTROS[step.key]}</p>
              </div>
            </div>

            <section aria-label={step.title} key={step.key} className="motion-fade">
              <div className="motion-slide-left">
                {step.key === "account" ? <AccountStep onNext={next} onBack={back} /> : null}
                {step.key === "objective" ? <ObjectiveStep onNext={next} onBack={back} /> : null}
                {step.key === "industry" ? <IndustryStep onNext={next} onBack={back} /> : null}
                {step.key === "name" ? <NameStep onNext={next} onBack={back} /> : null}
                {step.key === "slug" ? (
                  <SlugStep
                    onNext={() => {
                      setSlugConflict(null);
                      next();
                    }}
                    onBack={back}
                    conflictMessage={slugConflict}
                  />
                ) : null}
                {step.key === "import" ? <ImportStep onNext={next} onBack={back} /> : null}
                {step.key === "template" ? <TemplateStep onNext={next} onBack={back} /> : null}
                {step.key === "profile" ? <ProfileStep onNext={next} onBack={back} /> : null}
                {step.key === "preview" ? <PreviewStep onNext={next} onBack={back} onEdit={goTo} /> : null}
                {step.key === "publish" ? (
                  <PublishStep
                    onNext={next}
                    onBack={locked ? () => undefined : back}
                    onSlugConflict={(message) => {
                      setSlugConflict(message);
                      goTo(ONBOARDING_STEPS.findIndex((candidate) => candidate.key === "slug"));
                    }}
                  />
                ) : null}
                {step.key === "checklist" ? <ChecklistStep onLeave={leave} onFinish={finish} /> : null}
              </div>
            </section>
          </div>

          {showPreview ? <PreviewColumn stepKey={step.key} /> : null}
        </div>
      </div>
    </LivePreviewProvider>
  );
}
