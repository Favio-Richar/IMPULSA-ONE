"use client";

import { Button, type ButtonProps } from "@impulza/ui";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

/** Copia un valor al portapapeles y lo confirma en el mismo botón (anunciado a lectores de pantalla). */
export function CopyButton({ value, label = "Copiar", ...rest }: { value: string; label?: string } & Omit<ButtonProps, "onClick" | "children">): React.JSX.Element {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2_000);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      {...rest}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("copied");
        } catch {
          setState("failed");
        }
      }}
    >
      {state === "copied" ? <Check className="size-4 text-success" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      <span aria-live="polite">{state === "copied" ? "Copiado" : state === "failed" ? "Cópialo a mano" : label}</span>
    </Button>
  );
}
