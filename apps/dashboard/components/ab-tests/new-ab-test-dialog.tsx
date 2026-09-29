"use client";

import { Button, Dialog, Input, Select } from "@impulza/ui";
import { AB_TEST_FIELD_LABELS, AB_TEST_FIELD_SCHEMAS, abVariantSchema, type AbTestBlockType } from "@impulza/validation";
import { useState, type FormEvent } from "react";
import { abTestErrorMessage } from "../../lib/ab-test-messages";
import { useCreateAbTest } from "../../lib/hooks/use-ab-tests";
import { PlanLimitNotice } from "../plan-limit-notice";

const STYLE_OPTIONS = [
  { value: "primary", label: "Principal" },
  { value: "secondary", label: "Secundario" },
  { value: "outline", label: "Contorno" },
];

const MAX_LENGTHS: Record<string, number> = { label: 80, description: 160, headline: 160 };

/**
 * Empezar una prueba A/B (F6.5): A es el bloque tal como está publicado; B cambia solo texto o
 * estilo. Se muestra lado a lado lo actual y lo nuevo, y se valida con el mismo esquema que el
 * servidor antes de enviar.
 */
export function NewAbTestDialog({
  open,
  onOpenChange,
  organizationId,
  siteId,
  blockId,
  blockType,
  blockLabel,
  currentConfig,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  siteId: string;
  blockId: string;
  blockType: AbTestBlockType;
  blockLabel: string;
  currentConfig: Record<string, unknown>;
}): React.JSX.Element {
  const fields = Object.keys(AB_TEST_FIELD_SCHEMAS[blockType]);
  const create = useCreateAbTest(organizationId, siteId);
  const [name, setName] = useState(`Prueba de ${blockLabel.toLowerCase()}`);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field, ""])));
  const [clientError, setClientError] = useState<string | null>(null);

  function close(next: boolean): void {
    onOpenChange(next);
    if (!next) {
      create.reset();
      setClientError(null);
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    setClientError(null);
    const variantB = Object.fromEntries(Object.entries(values).filter(([field, value]) => value.trim() !== "" && value.trim() !== String(currentConfig[field] ?? "")).map(([field, value]) => [field, value.trim()]));
    const parsed = abVariantSchema(blockType).safeParse(variantB);
    if (!parsed.success) {
      setClientError(Object.keys(variantB).length === 0 ? "Cambia al menos un campo para que B sea distinta de A." : (parsed.error.issues[0]?.message ?? "Revisa la variante B."));
      return;
    }
    if (name.trim() === "") {
      setClientError("Ponle un nombre a la prueba.");
      return;
    }
    create.mutate({ blockId, name: name.trim(), variantB: parsed.data }, { onSuccess: () => close(false) });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      title={`Probar una variante · ${blockLabel}`}
      description="La mitad de tus visitantes verá la versión actual (A) y la otra mitad la nueva (B). Cada persona ve siempre la misma."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button type="submit" form={`nueva-prueba-${blockId}`} loading={create.isPending}>
            Empezar la prueba
          </Button>
        </>
      }
    >
      <form id={`nueva-prueba-${blockId}`} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <Input label="Nombre de la prueba" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} helperText="Solo lo ves tú." />

        <div className="flex flex-col gap-4">
          {fields.map((field) => (
            <div key={field} className="grid gap-2 sm:grid-cols-2 sm:items-end">
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">{AB_TEST_FIELD_LABELS[field]} · A (actual)</span>
                <p className="min-h-10 break-words rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted-foreground">
                  {field === "style" ? (STYLE_OPTIONS.find((option) => option.value === (currentConfig.style ?? "primary"))?.label ?? "—") : String(currentConfig[field] ?? "—")}
                </p>
              </div>
              {field === "style" ? (
                <Select
                  label={`${AB_TEST_FIELD_LABELS[field]} · B`}
                  placeholder="Sin cambios"
                  options={STYLE_OPTIONS}
                  value={values[field]}
                  onChange={(event) => setValues({ ...values, [field]: event.target.value })}
                />
              ) : (
                <Input
                  label={`${AB_TEST_FIELD_LABELS[field]} · B`}
                  placeholder="Deja vacío para no cambiarlo"
                  maxLength={MAX_LENGTHS[field]}
                  value={values[field]}
                  onChange={(event) => setValues({ ...values, [field]: event.target.value })}
                />
              )}
            </div>
          ))}
        </div>

        <p className="text-sm text-muted-foreground">
          Se mide cuántas visitas terminan en un clic{blockType === "profile" ? " en cualquier botón de la página" : " en este botón"}, y cuántas en un formulario, reserva o pedido. El
          sistema recomienda una ganadora solo cuando hay datos suficientes.
        </p>

        {clientError ? (
          <p role="alert" className="text-sm text-danger">
            {clientError}
          </p>
        ) : null}
        <PlanLimitNotice error={create.error} />
        {create.isError && abTestErrorMessage(create.error) ? (
          <p role="alert" className="text-sm text-danger">
            {abTestErrorMessage(create.error)}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
