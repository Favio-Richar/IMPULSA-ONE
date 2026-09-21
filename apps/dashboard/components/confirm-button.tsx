"use client";

import { Button, type ButtonProps } from "@impulza/ui";
import { useState } from "react";

interface ConfirmButtonProps extends Omit<ButtonProps, "onClick"> {
  /** Texto de la pregunta que reemplaza al botón mientras espera confirmación. */
  confirmLabel: string;
  onConfirm: () => void;
}

/**
 * Confirmación en la propia pantalla, no `window.confirm()`: un diálogo nativo del navegador
 * bloquea todo el hilo de render hasta que alguien lo cierra a mano — inaceptable para una acción
 * destructiva en un panel real, y además rompe cualquier prueba automatizada de la pantalla (un
 * diálogo nativo deja el resto de la página sin responder). Esto es solo dos botones que aparecen
 * y desaparecen, sin bloquear nada.
 */
export function ConfirmButton({ confirmLabel, onConfirm, children, variant, size, loading, ...rest }: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);

  if (armed) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{confirmLabel}</span>
        <Button variant="destructive" size={size} loading={loading} onClick={onConfirm}>
          Sí
        </Button>
        <Button variant="ghost" size={size} onClick={() => setArmed(false)}>
          No
        </Button>
      </span>
    );
  }

  return (
    <Button variant={variant} size={size} onClick={() => setArmed(true)} {...rest}>
      {children}
    </Button>
  );
}
