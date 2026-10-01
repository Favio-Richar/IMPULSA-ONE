"use client";

import type { EmailSequenceResponse } from "@impulza/contracts";
import {
  AUTOMATION_TRIGGER_LABELS,
  AUTOMATION_TRIGGERS,
  createEmailSequenceSchema,
  describeDelay,
  MAX_SEQUENCE_STEPS,
  sequenceEmail,
  type AutomationTrigger,
} from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Input, Select } from "@impulza/ui";
import { ArrowDown, ArrowUp, Clock, Mail, Plus, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useCreateSequence, useDeleteSequence, useSendStepTest, useUpdateSequence } from "../../lib/hooks/use-sequences";
import { RichTextEditor } from "../block-editor/rich-text-editor";
import { ConfirmButton } from "../confirm-button";

type Unit = "hours" | "days";

interface StepDraft {
  key: string;
  amount: number;
  unit: Unit;
  subject: string;
  bodyHtml: string;
}

interface Draft {
  name: string;
  trigger: AutomationTrigger;
  steps: StepDraft[];
}

let counter = 0;
const newKey = () => `step-${(counter += 1)}`;

function toStepDraft(step: { delayHours: number; subject: string; bodyHtml: string }): StepDraft {
  const days = step.delayHours > 0 && step.delayHours % 24 === 0;
  return { key: newKey(), amount: days ? step.delayHours / 24 : step.delayHours, unit: days ? "days" : "hours", subject: step.subject, bodyHtml: step.bodyHtml };
}

const hoursOf = (step: StepDraft) => (step.unit === "days" ? step.amount * 24 : step.amount);

const STARTER: Draft = {
  name: "",
  trigger: "newsletter_subscribed",
  steps: [
    { key: newKey(), amount: 0, unit: "hours", subject: "¡Bienvenida, {{nombre}}!", bodyHtml: "<p>Hola {{nombre}}, gracias por suscribirte. Esto es lo que vas a recibir…</p>" },
    { key: newKey(), amount: 3, unit: "days", subject: "Lo más pedido", bodyHtml: "<p>Hola {{nombre}}, te contamos qué es lo que más eligen nuestros clientes…</p>" },
  ],
};

function apiMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: unknown; issues?: Array<{ message: string }> } | undefined;
    if (error.status === 403) return "Tu rol no permite cambiar secuencias.";
    if (body?.issues?.[0]?.message) return body.issues[0].message;
    if (typeof body?.message === "string") return body.message;
  }
  return fallback;
}

/**
 * Editor de una secuencia de correo (F7.5, ADR-020): a la izquierda los correos en orden, con su
 * espera, asunto y contenido; a la derecha cuándo sale cada uno y la vista previa del elegido. Probar
 * pide los cambios guardados: se prueba lo que está en el servidor.
 */
export function SequenceEditor({ organizationId, sequence }: { organizationId: string; sequence?: EmailSequenceResponse }): React.JSX.Element {
  const router = useRouter();
  const formId = useId();
  const initial = useMemo<Draft>(
    () => (sequence ? { name: sequence.name, trigger: sequence.trigger as AutomationTrigger, steps: sequence.steps.map(toStepDraft) } : STARTER),
    [sequence],
  );
  const [draft, setDraft] = useState<Draft>(initial);
  const [saved, setSaved] = useState<string>(JSON.stringify(serialize(initial)));
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const create = useCreateSequence(organizationId);
  const update = useUpdateSequence(organizationId);
  const remove = useDeleteSequence(organizationId);
  const test = useSendStepTest(organizationId, sequence?.id ?? "");
  const dirty = JSON.stringify(serialize(draft)) !== saved;

  const current = draft.steps[Math.min(selected, draft.steps.length - 1)];
  const preview = useMemo(
    () => (current ? sequenceEmail({ organizationName: "Tu negocio", subject: current.subject || "(sin asunto)", bodyHtml: current.bodyHtml, name: "Ana", unsubscribeUrl: "#baja" }) : null),
    [current],
  );

  // Cuándo sale cada correo, contado desde el evento.
  const timeline = draft.steps.reduce<number[]>((acc, step) => [...acc, (acc.at(-1) ?? 0) + hoursOf(step)], []);

  function setStep(index: number, changes: Partial<StepDraft>): void {
    setDraft((value) => ({ ...value, steps: value.steps.map((step, i) => (i === index ? { ...step, ...changes } : step)) }));
  }

  function move(index: number, delta: number): void {
    setDraft((value) => {
      const steps = [...value.steps];
      const [item] = steps.splice(index, 1);
      steps.splice(index + delta, 0, item!);
      return { ...value, steps };
    });
    setSelected(index + delta);
  }

  async function save(event?: React.FormEvent): Promise<void> {
    event?.preventDefault();
    setNotice(null);
    const payload = serialize(draft);
    const parsed = createEmailSequenceSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const stepIndex = issue?.path[0] === "steps" && typeof issue.path[1] === "number" ? issue.path[1] : null;
      setError(
        !draft.name.trim()
          ? "Ponle un nombre a la secuencia."
          : stepIndex !== null
            ? `Correo ${stepIndex + 1}: ${issue!.path[2] === "subject" ? "escribe el asunto." : issue!.path[2] === "delayHours" ? "la espera debe ser un número entero de hasta un año." : (issue?.message ?? "revísalo.")}`
            : (issue?.message ?? "Revisa los campos."),
      );
      if (stepIndex !== null) setSelected(stepIndex);
      return;
    }
    setError(null);
    try {
      if (sequence) {
        const result = await update.mutateAsync({ sequenceId: sequence.id, changes: { name: parsed.data.name, steps: parsed.data.steps } });
        const next = { name: result.name, trigger: result.trigger as AutomationTrigger, steps: result.steps.map(toStepDraft) };
        setDraft(next);
        setSaved(JSON.stringify(serialize(next)));
        setNotice("Cambios guardados. Lo que falta enviar a quienes ya están en la secuencia usa la versión nueva.");
      } else {
        const created = await create.mutateAsync(parsed.data);
        router.replace(`/secuencias/${created.id}`);
      }
    } catch (caught) {
      setError(apiMessage(caught, "No se pudo guardar. Intenta de nuevo."));
    }
  }

  return (
    <form id={formId} onSubmit={save} noValidate className="flex flex-col gap-6" aria-label={sequence ? `Editar ${sequence.name}` : "Nueva secuencia"}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/secuencias" className="text-sm text-muted-foreground hover:underline">
            ← Secuencias
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-foreground">{sequence ? sequence.name : "Nueva secuencia"}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sequence ? (
            <ConfirmButton
              type="button"
              variant="ghost"
              size="sm"
              confirmLabel="¿Borrar con sus inscripciones?"
              loading={remove.isPending}
              onConfirm={() => remove.mutate(sequence.id, { onSuccess: () => router.replace("/secuencias"), onError: (caught) => setError(apiMessage(caught, "No se pudo borrar.")) })}
            >
              Borrar
            </ConfirmButton>
          ) : null}
          <Button type="submit" size="sm" variant={sequence ? "secondary" : "primary"} loading={create.isPending || update.isPending} disabled={sequence ? !dirty : false}>
            {sequence ? (dirty ? "Guardar cambios" : "Guardado") : "Crear secuencia"}
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-foreground">
          {notice}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Cuándo empieza</CardTitle>
              <CardDescription>Cada persona entra una sola vez, y solo si aceptó recibir correos. Si se da de baja, no recibe más.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Input label="Nombre interno" placeholder="Bienvenida a la newsletter" maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
              <Select
                label="Empieza cuando"
                value={draft.trigger}
                disabled={Boolean(sequence)}
                helperText={sequence ? "No se cambia después de crearla: crea otra secuencia." : undefined}
                options={AUTOMATION_TRIGGERS.map((value) => ({ value, label: AUTOMATION_TRIGGER_LABELS[value] }))}
                onChange={(event) => setDraft({ ...draft, trigger: event.target.value as AutomationTrigger })}
              />
            </CardContent>
          </Card>

          <section aria-label="Correos de la secuencia" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">
                Correos <span className="text-sm font-normal text-muted-foreground tabular-nums">({draft.steps.length} de {MAX_SEQUENCE_STEPS})</span>
              </h2>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={draft.steps.length >= MAX_SEQUENCE_STEPS}
                onClick={() => {
                  setDraft({ ...draft, steps: [...draft.steps, { key: newKey(), amount: 2, unit: "days", subject: "", bodyHtml: "" }] });
                  setSelected(draft.steps.length);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                Agregar correo
              </Button>
            </div>
            <ol className="flex flex-col gap-3">
              {draft.steps.map((step, index) => (
                <li
                  key={step.key}
                  className={cn("rounded-lg border bg-background p-4 shadow-xs transition-colors", selected === index ? "border-primary" : "border-border")}
                  onFocusCapture={() => setSelected(index)}
                  data-sequence-step={index}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary" aria-hidden="true">
                        {index + 1}
                      </span>
                      Correo {index + 1}
                    </p>
                    <div className="flex items-center gap-1">
                      <Button type="button" size="sm" variant="ghost" aria-label={`Subir el correo ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}>
                        <ArrowUp className="size-4" aria-hidden="true" />
                      </Button>
                      <Button type="button" size="sm" variant="ghost" aria-label={`Bajar el correo ${index + 1}`} disabled={index === draft.steps.length - 1} onClick={() => move(index, 1)}>
                        <ArrowDown className="size-4" aria-hidden="true" />
                      </Button>
                      {sequence ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={dirty}
                          title={dirty ? "Guarda los cambios para probar." : undefined}
                          loading={test.isPending && test.variables === index}
                          onClick={() =>
                            test.mutate(index, {
                              onSuccess: () => {
                                setError(null);
                                setNotice(`Te enviamos el correo ${index + 1} a tu correo, marcado como prueba.`);
                              },
                              onError: (caught) => setError(apiMessage(caught, "No se pudo enviar la prueba.")),
                            })
                          }
                        >
                          <Send className="size-4" aria-hidden="true" />
                          Probar
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Quitar el correo ${index + 1}`}
                        disabled={draft.steps.length === 1}
                        onClick={() => {
                          setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) });
                          setSelected(Math.max(0, index - 1));
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3">
                    <fieldset className="flex flex-wrap items-end gap-2">
                      <legend className="mb-1.5 text-sm font-medium text-foreground">{index === 0 ? "Se envía después del evento" : "Se envía después del correo anterior"}</legend>
                      <div className="w-24">
                        <Input
                          label="Espera"
                          type="number"
                          min={0}
                          step={1}
                          value={String(step.amount)}
                          onChange={(event) => setStep(index, { amount: Math.max(0, Math.floor(Number(event.target.value) || 0)) })}
                        />
                      </div>
                      <div className="w-32">
                        <Select
                          label="Unidad"
                          value={step.unit}
                          options={[
                            { value: "hours", label: "horas" },
                            { value: "days", label: "días" },
                          ]}
                          onChange={(event) => setStep(index, { unit: event.target.value as Unit })}
                        />
                      </div>
                      <p className="pb-2.5 text-xs text-muted-foreground">{hoursOf(step) === 0 ? "Sale al instante." : `Espera ${describeDelay(hoursOf(step))}.`}</p>
                    </fieldset>
                    <Input label="Asunto" maxLength={150} placeholder="¡Bienvenida, {{nombre}}!" value={step.subject} onChange={(event) => setStep(index, { subject: event.target.value })} required />
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-foreground">Mensaje</span>
                      <div className="rounded-md border border-border-strong bg-background">
                        <RichTextEditor value={step.bodyHtml} onChange={(html) => setStep(index, { bodyHtml: html })} placeholder="Escribe el correo…" ariaLabel={`Mensaje del correo ${index + 1}`} />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Escribe <code className="rounded bg-surface px-1 font-mono">{"{{nombre}}"}</code> para saludar por el nombre (si no lo tenemos, se omite).
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="flex flex-col gap-6 xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Recorrido</CardTitle>
              <CardDescription>Cuándo recibe cada correo una persona que entra hoy.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="relative flex flex-col gap-4 border-l border-border pl-5" aria-label="Recorrido de la secuencia">
                <li className="relative">
                  <span className="absolute -left-[27px] top-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary" aria-hidden="true" />
                  <p className="text-sm font-medium text-foreground">{AUTOMATION_TRIGGER_LABELS[draft.trigger]}</p>
                </li>
                {draft.steps.map((step, index) => (
                  <li key={step.key} className="relative">
                    <span className="absolute -left-[27px] top-0.5 flex size-3.5 items-center justify-center rounded-full border-2 border-primary bg-background" aria-hidden="true" />
                    <button type="button" onClick={() => setSelected(index)} className={cn("w-full rounded-md px-2 py-1 text-left transition-colors hover:bg-surface", selected === index && "bg-surface")}>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="size-3.5" aria-hidden="true" />
                        {timeline[index] === 0 ? "Al instante" : `A los ${describeDelay(timeline[index]!)}`}
                      </span>
                      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <Mail className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                        <span className="truncate">{step.subject || `Correo ${index + 1} (sin asunto)`}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {preview ? (
            <Card>
              <CardHeader>
                <CardTitle>Vista previa · correo {Math.min(selected, draft.steps.length - 1) + 1}</CardTitle>
                <CardDescription>
                  Asunto: <span className="font-medium text-foreground">{preview.subject}</span> · con «Ana» como nombre de ejemplo.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* El servidor sanea el HTML al guardar; acá se muestra en un iframe aislado, sin scripts. */}
                <iframe title="Vista previa del correo" sandbox="" srcDoc={preview.html} className="h-80 w-full rounded-md border border-border bg-white" />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function serialize(draft: Draft) {
  return { name: draft.name.trim(), trigger: draft.trigger, steps: draft.steps.map((step) => ({ delayHours: hoursOf(step), subject: step.subject.trim(), bodyHtml: step.bodyHtml })) };
}
