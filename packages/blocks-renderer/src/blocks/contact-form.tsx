import type { ContactFormBlockConfig } from "@impulza/validation";

const FIELD_LABELS: Record<ContactFormBlockConfig["fields"][number], string> = {
  name: "Nombre",
  email: "Correo",
  phone: "Teléfono",
  message: "Mensaje",
};

/**
 * El bloque declara la intención de un formulario y su copy, pero el envío real (destino,
 * anti-spam, almacenamiento) es de Fase 3 — así lo documenta el propio esquema en
 * `@impulza/validation` desde F2.4. Renderizar campos que parecen funcionar y no envían nada a
 * ningún lado sería engañoso; se muestran deshabilitados con un aviso explícito en vez de simular
 * una función que todavía no existe.
 */
export function ContactFormBlock({ config }: { config: ContactFormBlockConfig }) {
  return (
    <div className="rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] p-6 shadow-[var(--site-shadow)]">
      {config.title ? (
        <h2 className="mb-4 text-lg font-semibold text-[var(--site-color-foreground)]">{config.title}</h2>
      ) : null}

      <div className="flex flex-col gap-3" aria-hidden="true">
        {config.fields.map((field) => (
          <div key={field}>
            <span className="mb-1 block text-sm font-medium text-[var(--site-color-foreground)]">
              {FIELD_LABELS[field]}
            </span>
            {field === "message" ? (
              <div className="h-20 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)]" />
            ) : (
              <div className="h-10 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)]" />
            )}
          </div>
        ))}
        <span className="inline-flex cursor-not-allowed items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-5 py-2.5 text-sm font-medium text-[var(--site-color-primary-foreground)] opacity-50">
          {config.submitLabel}
        </span>
      </div>

      <p className="mt-3 text-sm text-[var(--site-color-muted-foreground)]">
        Los formularios llegan en una próxima etapa del producto — esta vista previa todavía no envía nada.
      </p>
    </div>
  );
}
