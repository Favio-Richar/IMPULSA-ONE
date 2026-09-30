"use client";

import { formatLocalDateTime, localDateTimeToInstant, SITE_TIME_ZONES, type CountdownBlockConfig } from "@impulza/validation";
import { useNow } from "../lib/clock.js";
import { LinkButton, type ButtonVariant } from "../ui/link-button.js";
import { stackSurfaceClass } from "../ui/stack-button.js";

const UNITS = [
  { key: "days", label: "días", one: "día" },
  { key: "hours", label: "horas", one: "hora" },
  { key: "minutes", label: "min", one: "min" },
  { key: "seconds", label: "seg", one: "seg" },
] as const;

type Remaining = Record<(typeof UNITS)[number]["key"], number>;

/** Días, horas, minutos y segundos que faltan (sin negativos). */
export function remainingUntil(target: number, now: number): Remaining {
  const total = Math.max(0, Math.floor((target - now) / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
}

/** "3 días, 4 horas y 5 minutos": lo que oye un lector de pantalla (sin los segundos). */
export function remainingSentence(remaining: Remaining): string {
  const parts = [
    remaining.days > 0 ? `${remaining.days} ${remaining.days === 1 ? "día" : "días"}` : null,
    remaining.hours > 0 ? `${remaining.hours} ${remaining.hours === 1 ? "hora" : "horas"}` : null,
    `${remaining.minutes} ${remaining.minutes === 1 ? "minuto" : "minutos"}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
}

export function zoneLabel(timeZone: string): string {
  return SITE_TIME_ZONES.find((zone) => zone.value === timeZone)?.label ?? timeZone.replace(/_/g, " ");
}

/**
 * Cuenta regresiva (F7.3, ADR-018). El servidor pinta la fecha escrita y las cifras en blanco; el
 * conteo empieza al hidratar. Al llegar a cero muestra su mensaje o desaparece, según se configuró.
 */
export function CountdownBlock({ config, buttonVariant }: { config: CountdownBlockConfig; buttonVariant: ButtonVariant }) {
  const now = useNow(1_000);
  const target = localDateTimeToInstant(config.target, config.timeZone)?.getTime() ?? null;
  const ended = now !== null && target !== null && now >= target;
  if (ended && config.endedBehavior === "hide") return null;

  const remaining = now !== null && target !== null ? remainingUntil(target, now) : null;
  const when = formatLocalDateTime(config.target, config.timeZone, { weekday: true });
  const surface = stackSurfaceClass(buttonVariant === "glass" ? "glass" : "secondary");

  return (
    <section className={`flex flex-col items-center gap-4 px-5 py-6 text-center ${surface}`} aria-label={config.title ?? "Cuenta regresiva"} data-countdown="">
      {config.title ? <h2 className="text-lg font-semibold text-[var(--site-color-foreground)]">{config.title}</h2> : null}
      {ended ? (
        <p className="text-base font-medium text-[var(--site-color-foreground)]" role="status">
          {config.endedMessage ?? "¡Ya comenzó!"}
        </p>
      ) : (
        <>
          {/* Las cifras cambian cada segundo: `role="timer"` no se anuncia sola; la frase de abajo sí se lee. */}
          <div role="timer" aria-label={remaining ? `Faltan ${remainingSentence(remaining)}` : `Hasta el ${when}`} className="grid w-full max-w-sm grid-cols-4 gap-2">
            {UNITS.map((unit) => {
              const value = remaining?.[unit.key];
              return (
                <div
                  key={unit.key}
                  aria-hidden="true"
                  className="flex flex-col items-center rounded-[calc(var(--site-radius)/1.5)] border border-[var(--site-color-border)] bg-[color-mix(in_srgb,var(--site-color-foreground)_5%,transparent)] px-1 py-2.5"
                >
                  <span className="text-2xl font-semibold tabular-nums text-[var(--site-color-foreground)] sm:text-3xl" data-countdown-value={unit.key}>
                    {value === undefined ? "–" : String(value).padStart(unit.key === "days" ? 1 : 2, "0")}
                  </span>
                  <span className="text-xs text-[var(--site-color-muted-foreground)]">{value === 1 ? unit.one : unit.label}</span>
                </div>
              );
            })}
          </div>
          <p className="text-sm text-[var(--site-color-muted-foreground)]">
            <time dateTime={target !== null ? new Date(target).toISOString() : undefined}>{when}</time> · hora de {zoneLabel(config.timeZone)}
          </p>
        </>
      )}
      {config.cta ? (
        <LinkButton href={config.cta.url} variant={buttonVariant === "glass" ? "glass" : "primary"}>
          {config.cta.label}
        </LinkButton>
      ) : null}
    </section>
  );
}
