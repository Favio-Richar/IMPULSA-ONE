"use client";

import { MARKETING_CONSENT_LABEL } from "@impulza/validation";
import { INPUT_CLASS } from "../ui/flow.js";

// Datos del cliente para un pedido (F5.5), compartidos por el pedido suelto y el del carrito (F7.8c):
// mismos campos, misma validación previa y mismo cuerpo hacia la API (que siempre revalida).

export interface CustomerValues {
  name: string;
  email: string;
  phone: string;
  address: string;
  note: string;
  consent: boolean;
  marketing: boolean;
  website: string;
}

export const EMPTY_CUSTOMER: CustomerValues = { name: "", email: "", phone: "", address: "", note: "", consent: false, marketing: false, website: "" };

/** Lo que falta antes de enviar (la API valida de nuevo), o `null`. */
export function customerProblem(values: CustomerValues, needsAddress: boolean): string | null {
  if (!values.name.trim() || !values.email.trim()) return "Escribe tu nombre y tu correo.";
  if (needsAddress && !values.address.trim()) return "Escribe la dirección de entrega.";
  if (!values.consent) return "Necesitamos tu autorización para guardar el pedido.";
  return null;
}

/** Datos del cliente tal como los espera la API. */
export function customerPayload(values: CustomerValues, needsAddress: boolean): Record<string, unknown> {
  const phone = values.phone.replace(/[\s()-]/g, "");
  return {
    name: values.name.trim(),
    email: values.email.trim(),
    ...(phone ? { phone } : {}),
    ...(needsAddress ? { address: values.address.trim() } : {}),
    ...(values.note.trim() ? { note: values.note.trim() } : {}),
    consent: true,
    // Aparte y opcional (F5.6): solo con la casilla marcada llegan campañas.
    ...(values.marketing ? { marketingConsent: true } : {}),
    website: values.website,
  };
}

export function CustomerFields({
  id,
  values,
  onChange,
  needsAddress,
}: {
  id: string;
  values: CustomerValues;
  onChange: (values: CustomerValues) => void;
  needsAddress: boolean;
}) {
  const field = (key: "name" | "email" | "phone" | "address", label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div>
      <label htmlFor={`${id}-${key}`} className="mb-1 block text-sm font-medium text-[var(--site-color-foreground)]">
        {label}
      </label>
      <input id={`${id}-${key}`} className={INPUT_CLASS} value={values[key]} onChange={(e) => onChange({ ...values, [key]: e.target.value })} {...props} />
    </div>
  );

  return (
    <>
      {field("name", "Nombre *", { autoComplete: "name", maxLength: 120 })}
      {field("email", "Correo *", { type: "email", autoComplete: "email", maxLength: 254 })}
      {field("phone", "Teléfono (opcional)", { type: "tel", autoComplete: "tel", placeholder: "+56 9 1234 5678" })}
      {needsAddress ? field("address", "Dirección de entrega *", { autoComplete: "street-address", maxLength: 300 }) : null}
      <div>
        <label htmlFor={`${id}-nota`} className="mb-1 block text-sm font-medium text-[var(--site-color-foreground)]">
          Comentario (opcional)
        </label>
        <textarea id={`${id}-nota`} className={INPUT_CLASS} rows={2} maxLength={500} value={values.note} onChange={(e) => onChange({ ...values, note: e.target.value })} />
      </div>
      {/* Trampa antispam: invisible para personas, la completan los bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-web`}>Sitio web</label>
        <input id={`${id}-web`} tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => onChange({ ...values, website: e.target.value })} />
      </div>
      <label className="flex items-start gap-2 text-sm text-[var(--site-color-foreground)]">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--site-color-primary)]" checked={values.consent} onChange={(e) => onChange({ ...values, consent: e.target.checked })} />
        <span>Acepto que este negocio guarde mis datos para gestionar mi pedido. *</span>
      </label>
      <label className="flex items-start gap-2 text-sm text-[var(--site-color-foreground)]">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--site-color-primary)]" checked={values.marketing} onChange={(e) => onChange({ ...values, marketing: e.target.checked })} />
        <span>{MARKETING_CONSENT_LABEL}</span>
      </label>
    </>
  );
}
