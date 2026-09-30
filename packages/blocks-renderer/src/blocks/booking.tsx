"use client";

import { CalendarCheck, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, CreditCard } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { BookingAvailabilityResponse, PublicBookingConfirmationResponse, PublicBookingInfoResponse } from "@impulza/contracts";
import { addDaysToDate, localDateOf, MARKETING_CONSENT_LABEL, type BookingBlockConfig } from "@impulza/validation";
import { formatPrice } from "../lib/format-price.js";
import { buildIcs } from "../lib/ics.js";
import { OUTBOUND_LINK } from "../ui/outbound.js";
import { StackButtonContent, stackButtonClass, stackSurfaceClass } from "../ui/stack-button.js";
import { fetchJson, INPUT_CLASS, Notice, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../ui/flow.js";
import { SURFACE_SCOPE } from "../ui/surface.js";

type Service = PublicBookingInfoResponse["services"][number];
type Step = "service" | "time" | "details" | "done";

const DAYS = 7;
/** Opción elegible (servicio, día, hora): superficie de la pila; la elegida, en el color primario. */
const CHOICE_BASE = "rounded-[var(--site-radius)] border text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40";
const CHOICE_IDLE = "border-[var(--site-color-border)] bg-[var(--site-color-background)] text-[var(--site-color-foreground)] hover:border-[var(--site-color-primary)]";
const CHOICE_SELECTED = "border-transparent bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]";

/** Mayúscula solo en la primera letra ("Martes, 29 de septiembre"): `capitalize` de CSS pondría "De". */
function sentenceCase(text: string): string {
  return text.charAt(0).toLocaleUpperCase("es-CL") + text.slice(1);
}

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Reservar desde la página (F5.2, PL5): un botón más de la pila que despliega el flujo propio —
 * servicio → día y hora → datos → confirmación—, dentro del sitio. Las horas libres las calcula el
 * servidor en la zona del negocio y se muestran en esa zona. Todo pasa por las rutas locales de
 * `apps/web` (`/api/bookings/...`), nunca directo a la API. En la vista previa del constructor no
 * se reserva nada.
 */
export function BookingBlock({
  config,
  siteSlug,
  mode = "public",
  primary = false,
  glass = false,
  mono = false,
}: {
  config: BookingBlockConfig;
  siteSlug?: string;
  mode?: "public" | "preview";
  primary?: boolean;
  glass?: boolean;
  mono?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const panelClass = `${SURFACE_SCOPE} mt-3 ${stackSurfaceClass("secondary")} p-4 sm:p-6`;

  return (
    <details className="group" onToggle={(event) => setOpened((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className={`${stackButtonClass(primary && !mono ? "primary" : glass ? "glass" : "secondary", primary)} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        <StackButtonContent primary={primary} icon={<CalendarCheck className="h-5 w-5 shrink-0" aria-hidden="true" />} label={config.label} />
      </summary>
      <div className={panelClass} data-booking-panel="">
        {mode === "preview" || !siteSlug ? (
          <p className="text-sm text-[var(--site-color-foreground)]">
            Vista previa: en tu página publicada, aquí tus clientes eligen servicio, día y hora, y reservan. Tus horarios y servicios se
            configuran en Sitios → Reservas.
          </p>
        ) : opened ? (
          <BookingFlow siteSlug={siteSlug} serviceIds={config.serviceIds} />
        ) : null}
      </div>
    </details>
  );
}

function BookingFlow({ siteSlug, serviceIds }: { siteSlug: string; serviceIds?: string[] }) {
  const base = `/api/bookings/${encodeURIComponent(siteSlug)}`;
  const [info, setInfo] = useState<PublicBookingInfoResponse | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("service");
  const [service, setService] = useState<Service | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PublicBookingConfirmationResponse | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<PublicBookingInfoResponse>(base, { cache: "no-store" }).then((result) => {
      if (cancelled) return;
      if (result.ok) setInfo(result.data);
      else setInfoError(result.status === 404 ? "Por ahora no hay horas disponibles para reservar en línea." : result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [base]);

  // Al cambiar de paso, el foco va al título del paso: el lector de pantalla anuncia dónde está.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const services = useMemo(
    () => (info?.services ?? []).filter((candidate) => !serviceIds || serviceIds.length === 0 || serviceIds.includes(candidate.id)),
    [info, serviceIds],
  );

  if (infoError) return <Notice>{infoError}</Notice>;
  if (!info) return <p className="text-sm text-[var(--site-color-muted-foreground)]" role="status">Cargando horarios…</p>;
  if (services.length === 0) return <Notice>Por ahora no hay servicios disponibles para reservar en línea.</Notice>;

  const timeZone = info.timeZone;
  const heading = (text: string) => (
    <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-[var(--site-color-foreground)] outline-none">
      {text}
    </h3>
  );

  if (step === "done" && confirmation) {
    return <Confirmation confirmation={confirmation} heading={heading} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex gap-1.5 text-xs text-[var(--site-color-muted-foreground)]" aria-label="Pasos de la reserva">
        {(["Servicio", "Día y hora", "Tus datos"] as const).map((label, index) => {
          const current = (["service", "time", "details"] as const).indexOf(step as "service" | "time" | "details") === index;
          return (
            <li key={label} aria-current={current ? "step" : undefined} className={current ? "font-semibold text-[var(--site-color-foreground)]" : ""}>
              {index > 0 ? "· " : ""}
              {label}
            </li>
          );
        })}
      </ol>

      {notice ? <Notice>{notice}</Notice> : null}

      {step === "service" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2">{heading("¿Qué quieres reservar?")}</legend>
          {services.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={service?.id === candidate.id}
              onClick={() => {
                setService(candidate);
                setSlot(null);
                setNotice(null);
                setStep("time");
              }}
              className={`${CHOICE_BASE} ${service?.id === candidate.id ? CHOICE_SELECTED : CHOICE_IDLE} flex min-h-14 flex-col items-start gap-0.5 px-4 py-3 text-left`}
            >
              <span className="font-medium">{candidate.name}</span>
              <span className="flex flex-wrap items-center gap-x-3 text-xs">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {durationLabel(candidate.durationMinutes)}
                </span>
                {candidate.priceAmount !== null && candidate.priceCurrency ? <span>{formatPrice(candidate.priceAmount, candidate.priceCurrency)}</span> : null}
                {candidate.depositAmount !== null && candidate.priceCurrency ? <span>Seña {formatPrice(candidate.depositAmount, candidate.priceCurrency)}</span> : null}
              </span>
              {candidate.description ? <span className="text-xs">{candidate.description}</span> : null}
            </button>
          ))}
        </fieldset>
      ) : null}

      {step === "time" && service ? (
        <BookingTimePicker
          base={base}
          service={service}
          timeZone={timeZone}
          maxAdvanceDays={info.maxAdvanceDays}
          heading={heading}
          onBack={() => setStep("service")}
          onPick={(picked) => {
            setSlot(picked);
            setNotice(null);
            setStep("details");
          }}
        />
      ) : null}

      {step === "details" && service && slot ? (
        <DetailsForm
          base={base}
          service={service}
          slot={slot}
          timeZone={timeZone}
          heading={heading}
          onBack={() => setStep("time")}
          onTaken={(message) => {
            setNotice(message);
            setSlot(null);
            setStep("time");
          }}
          onDone={(result) => {
            setConfirmation(result);
            setStep("done");
          }}
        />
      ) : null}
    </div>
  );
}

/** Día y hora libres de un servicio (F5.2); también lo usa "cambiar la hora" (F5.4). */
export function BookingTimePicker({
  base,
  service,
  timeZone,
  maxAdvanceDays,
  heading,
  onBack,
  onPick,
  backLabel = "Cambiar servicio",
  title,
}: {
  base: string;
  service: Service;
  timeZone: string;
  maxAdvanceDays: number;
  heading: (text: string) => React.ReactNode;
  onBack: () => void;
  onPick: (slot: string) => void;
  /** Texto del botón para volver (al reprogramar: "Volver"). */
  backLabel?: string;
  /** Título del paso (por defecto, "<servicio> · elige día y hora"). */
  title?: string;
}) {
  const today = localDateOf(new Date(), timeZone);
  const lastDay = addDaysToDate(today, maxAdvanceDays);
  const [from, setFrom] = useState(today);
  const [availability, setAvailability] = useState<BookingAvailabilityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const dayFormat = useMemo(() => new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "short", day: "numeric" }), []);
  const longDayFormat = useMemo(() => new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }), []);
  const timeFormat = useMemo(() => new Intl.DateTimeFormat("es-CL", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [timeZone]);

  useEffect(() => {
    let cancelled = false;
    setAvailability(null);
    setError(null);
    const params = new URLSearchParams({ serviceId: service.id, from, days: String(DAYS) });
    void fetchJson<BookingAvailabilityResponse>(`${base}/availability?${params.toString()}`, { cache: "no-store" }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setAvailability(result.data);
      // Elige solo el primer día con horas libres de la semana visible.
      setDay((current) => current && result.data.days.some((d) => d.date === current && d.slots.length > 0) ? current : (result.data.days.find((d) => d.slots.length > 0)?.date ?? null));
    });
    return () => {
      cancelled = true;
    };
  }, [base, service.id, from]);

  const selectedDay = availability?.days.find((d) => d.date === day) ?? null;
  const noneThisWeek = availability !== null && availability.days.every((d) => d.slots.length === 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {heading(title ?? `${service.name} · elige día y hora`)}
        <button type="button" onClick={onBack} className="text-sm text-[var(--site-color-foreground)] underline underline-offset-2">
          {backLabel}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setFrom((current) => (addDaysToDate(current, -DAYS) < today ? today : addDaysToDate(current, -DAYS)))}
          disabled={from <= today}
          aria-label="Semana anterior"
          className={`${CHOICE_BASE} ${CHOICE_IDLE} flex h-11 w-11 shrink-0 items-center justify-center`}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <div role="group" aria-label="Día" className="grid flex-1 grid-cols-7 gap-1">
          {(availability?.days ?? Array.from({ length: DAYS }, (_, i) => ({ date: addDaysToDate(from, i), slots: [] as string[] }))).map((d) => {
            const [weekday = "", number = ""] = dayFormat.format(new Date(`${d.date}T12:00:00Z`)).replace(".", "").split(" ");
            return (
              <button
                key={d.date}
                type="button"
                aria-pressed={d.date === day}
                aria-label={`${longDayFormat.format(new Date(`${d.date}T12:00:00Z`))}${d.slots.length === 0 ? ", sin horas" : ""}`}
                disabled={!availability || d.slots.length === 0}
                onClick={() => setDay(d.date)}
                className={`${CHOICE_BASE} ${d.date === day ? CHOICE_SELECTED : CHOICE_IDLE} flex min-h-14 flex-col items-center justify-center px-0.5 py-1`}
              >
                <span className="text-[0.7rem] leading-tight">{sentenceCase(weekday)}</span>
                <span className="text-base font-semibold leading-tight tabular-nums">{number}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setFrom((current) => addDaysToDate(current, DAYS))}
          disabled={addDaysToDate(from, DAYS) > lastDay}
          aria-label="Semana siguiente"
          className={`${CHOICE_BASE} ${CHOICE_IDLE} flex h-11 w-11 shrink-0 items-center justify-center`}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {error ? (
        <Notice>{error}</Notice>
      ) : !availability ? (
        <p className="text-sm text-[var(--site-color-muted-foreground)]" role="status">
          Buscando horas libres…
        </p>
      ) : noneThisWeek ? (
        <p className="text-sm text-[var(--site-color-foreground)]">No quedan horas esta semana. Prueba con la siguiente.</p>
      ) : selectedDay ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-[var(--site-color-foreground)]">{sentenceCase(longDayFormat.format(new Date(`${selectedDay.date}T12:00:00Z`)))}</p>
          <div role="group" aria-label="Hora" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {selectedDay.slots.map((slot) => (
              <button
                key={slot}
                type="button"
                onClick={() => onPick(slot)}
                className={`${CHOICE_BASE} ${CHOICE_IDLE} min-h-11 px-2 py-2 font-medium tabular-nums`}
              >
                {timeFormat.format(new Date(slot))}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailsForm({
  base,
  service,
  slot,
  timeZone,
  heading,
  onBack,
  onTaken,
  onDone,
}: {
  base: string;
  service: Service;
  slot: string;
  timeZone: string;
  heading: (text: string) => React.ReactNode;
  onBack: () => void;
  onTaken: (message: string) => void;
  onDone: (confirmation: PublicBookingConfirmationResponse) => void;
}) {
  const id = useId();
  const [values, setValues] = useState({ name: "", email: "", phone: "", note: "", consent: false, marketing: false, website: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = new Intl.DateTimeFormat("es-CL", { timeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(slot),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.name.trim() || !values.email.trim()) {
      setError("Escribe tu nombre y tu correo.");
      return;
    }
    if (!values.consent) {
      setError("Necesitamos tu autorización para guardar la reserva.");
      return;
    }
    setError(null);
    setSubmitting(true);
    // Sin "+", solo se asume Chile si el negocio atiende en zona chilena; si no, el servidor pide el
    // formato internacional con un mensaje claro.
    const digits = values.phone.replace(/[\s()-]/g, "");
    const chilean = ["America/Santiago", "America/Punta_Arenas", "Pacific/Easter"].includes(timeZone);
    const phone = digits && !digits.startsWith("+") && chilean ? `+56${digits.replace(/^0+/, "")}` : digits;
    const result = await fetchJson<PublicBookingConfirmationResponse>(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId: service.id,
        startsAt: slot,
        name: values.name.trim(),
        email: values.email.trim(),
        ...(phone ? { phone } : {}),
        ...(values.note.trim() ? { note: values.note.trim() } : {}),
        consent: true,
        // Aparte y opcional (F5.6): solo con la casilla marcada llegan campañas.
        ...(values.marketing ? { marketingConsent: true } : {}),
        website: values.website,
      }),
    });
    setSubmitting(false);
    if (result.ok) {
      onDone(result.data);
    } else if (result.status === 409) {
      onTaken(result.message);
    } else if (result.status === 429) {
      setError("Hiciste muchos intentos seguidos. Espera unos minutos y vuelve a intentarlo.");
    } else {
      setError(result.message);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3" aria-labelledby={`${id}-titulo`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={`${id}-titulo`}>{heading("Tus datos")}</span>
        <button type="button" onClick={onBack} className="text-sm text-[var(--site-color-foreground)] underline underline-offset-2">
          Cambiar hora
        </button>
      </div>
      <p className="rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-3 py-2 text-sm text-[var(--site-color-foreground)]">
        <span className="font-medium">{service.name}</span> · <span>{sentenceCase(when)}</span>
      </p>
      <div>
        <label htmlFor={`${id}-nombre`} className="mb-1 block text-sm font-medium text-[var(--site-color-foreground)]">
          Nombre *
        </label>
        <input id={`${id}-nombre`} className={INPUT_CLASS} autoComplete="name" maxLength={120} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
      </div>
      <div>
        <label htmlFor={`${id}-correo`} className="mb-1 block text-sm font-medium text-[var(--site-color-foreground)]">
          Correo *
        </label>
        <input id={`${id}-correo`} type="email" className={INPUT_CLASS} autoComplete="email" maxLength={254} value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />
      </div>
      <div>
        <label htmlFor={`${id}-telefono`} className="mb-1 block text-sm font-medium text-[var(--site-color-foreground)]">
          Teléfono (opcional)
        </label>
        <input
          id={`${id}-telefono`}
          type="tel"
          className={INPUT_CLASS}
          autoComplete="tel"
          placeholder="+56 9 1234 5678"
          value={values.phone}
          onChange={(e) => setValues({ ...values, phone: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor={`${id}-nota`} className="mb-1 block text-sm font-medium text-[var(--site-color-foreground)]">
          Comentario (opcional)
        </label>
        <textarea id={`${id}-nota`} className={INPUT_CLASS} rows={2} maxLength={500} value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} />
      </div>
      {/* Trampa antispam: invisible para personas, la completan los bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-web`}>Sitio web</label>
        <input id={`${id}-web`} tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => setValues({ ...values, website: e.target.value })} />
      </div>
      <label className="flex items-start gap-2 text-sm text-[var(--site-color-foreground)]">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--site-color-primary)]" checked={values.consent} onChange={(e) => setValues({ ...values, consent: e.target.checked })} />
        <span>Acepto que este negocio guarde mis datos para gestionar mi reserva. *</span>
      </label>
      <label className="flex items-start gap-2 text-sm text-[var(--site-color-foreground)]">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--site-color-primary)]" checked={values.marketing} onChange={(e) => setValues({ ...values, marketing: e.target.checked })} />
        <span>{MARKETING_CONSENT_LABEL}</span>
      </label>
      {error ? <Notice>{error}</Notice> : null}
      <button type="submit" disabled={submitting} className={PRIMARY_BUTTON}>
        {submitting ? "Confirmando…" : "Confirmar reserva"}
      </button>
    </form>
  );
}

function Confirmation({ confirmation, heading }: { confirmation: PublicBookingConfirmationResponse; heading: (text: string) => React.ReactNode }) {
  const when = new Intl.DateTimeFormat("es-CL", {
    timeZone: confirmation.timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(confirmation.startsAt));
  const icsHref = useMemo(() => {
    const ics = buildIcs({
      uid: `${confirmation.startsAt}-${Math.random().toString(36).slice(2)}@impulza`,
      title: confirmation.serviceName,
      start: new Date(confirmation.startsAt),
      end: new Date(confirmation.endsAt),
      ...(typeof window !== "undefined" ? { url: window.location.href } : {}),
    });
    return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
  }, [confirmation]);

  // Seña (F5.10): la hora queda guardada hasta el plazo y se confirma al pagarla en Mercado Pago.
  if (confirmation.status === "PENDING_PAYMENT") {
    const deposit = confirmation.depositAmount !== null && confirmation.priceCurrency ? formatPrice(confirmation.depositAmount, confirmation.priceCurrency) : "";
    const until = confirmation.paymentDeadline
      ? new Intl.DateTimeFormat("es-CL", { timeZone: confirmation.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(confirmation.paymentDeadline))
      : null;
    return (
      <div className="flex flex-col gap-4" role="status">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]">
            <CreditCard className="h-5 w-5" aria-hidden="true" />
          </span>
          {heading("Paga la seña para confirmar")}
        </div>
        <p className="text-sm text-[var(--site-color-foreground)]">
          Guardamos tu hora: <span className="font-medium">{confirmation.serviceName}</span>, <span>{when}</span>. Paga la seña de{" "}
          <span className="font-semibold">{deposit}</span>
          {until ? ` antes de las ${until}` : ""} para confirmarla; si no, la hora se libera.
        </p>
        {confirmation.checkoutUrl ? (
          // Misma pestaña: Mercado Pago devuelve al cliente a "Tu reserva", con el estado del pago.
          <a href={confirmation.checkoutUrl} rel="noopener noreferrer" className={PRIMARY_BUTTON}>
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            Pagar la seña con Mercado Pago
          </a>
        ) : null}
        <p className="text-xs text-[var(--site-color-muted-foreground)]">
          Pagas en el sitio de Mercado Pago y el dinero lo recibe directamente el negocio. También te enviamos el enlace por correo.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" role="status">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]">
          <Check className="h-5 w-5" aria-hidden="true" />
        </span>
        {heading("¡Reserva confirmada!")}
      </div>
      <p className="text-sm text-[var(--site-color-foreground)]">
        <span className="font-medium">{confirmation.serviceName}</span>, <span>{when}</span>.
        {confirmation.priceAmount !== null && confirmation.priceCurrency ? ` Valor: ${formatPrice(confirmation.priceAmount, confirmation.priceCurrency)}.` : ""}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {confirmation.paymentUrl ? (
          <a href={confirmation.paymentUrl} {...OUTBOUND_LINK} className={PRIMARY_BUTTON}>
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            Pagar ahora
          </a>
        ) : null}
        <a href={icsHref} download="reserva.ics" className={SECONDARY_BUTTON}>
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
          Agregar a mi calendario
        </a>
      </div>
      {confirmation.paymentUrl ? (
        <p className="text-xs text-[var(--site-color-muted-foreground)]">El pago lo recibe directamente el negocio.</p>
      ) : null}
    </div>
  );
}
