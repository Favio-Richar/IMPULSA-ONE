import { Textarea } from "@impulza/ui";

/**
 * Motivo escrito de una acción de superadministración (ADR-005 §6): obligatorio, queda en la
 * auditoría con el nombre de quien la hizo.
 */
export function ReasonField({
  label = "Motivo",
  value,
  onChange,
  error,
  helperText = "Queda registrado en la auditoría con tu nombre.",
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  helperText?: string;
}): React.JSX.Element {
  return (
    <Textarea
      label={label}
      required
      rows={2}
      maxLength={500}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      error={error}
      helperText={helperText}
    />
  );
}

/** Mismo mínimo que el servidor (`admin-actions.dto.ts`): se avisa antes de enviar. */
export function reasonError(reason: string): string | undefined {
  return reason.trim().length < 5 ? "Explica el motivo (al menos 5 caracteres)." : undefined;
}
