"use client";

import { cn } from "@impulza/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChecklistStep, PublishStep } from "../../../components/onboarding/publish-step";
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

  return (
    <div className={cn("mx-auto flex flex-col gap-6", wide ? "max-w-6xl" : "max-w-2xl")}>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Paso {stepIndex + 1} de {ONBOARDING_STEPS.length}
        </p>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface"
          role="progressbar"
          aria-label="Avance del asistente"
          aria-valuemin={1}
          aria-valuemax={ONBOARDING_STEPS.length}
          aria-valuenow={stepIndex + 1}
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${((stepIndex + 1) / ONBOARDING_STEPS.length) * 100}%` }} />
        </div>
      </div>

      <div>
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-foreground focus:outline-none sm:text-2xl">
          {step.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{STEP_INTROS[step.key]}</p>
      </div>

      <section aria-label={step.title} key={step.key} className="motion-fade">
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
      </section>
    </div>
  );
}
